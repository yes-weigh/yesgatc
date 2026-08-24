using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public enum DocaSessionState
{
    LoggedIn,
    LoginRequired,
    /// <summary>eMAAP login succeeded through captcha; waiting for email OTP.</summary>
    OtpRequired,
}

public sealed class DocaSessionProbeResult
{
    public DocaSessionState State { get; init; }
    public bool AttemptedAutoLogin { get; init; }
}

public sealed record DocaOpenResult(
    DocaSessionState State,
    string Message,
    bool VerificationApproved = false,
    bool DuplicateOnDoca = false,
    bool FillOnlyCompleted = false);

public sealed class AutomationService : IAsyncDisposable
{
    private readonly AutomationSettings _settings;
    private readonly FirestoreService _firestoreService;
    private readonly SemaphoreSlim _browserLock = new(1, 1);
    private readonly HashSet<string> _claimedEmaapCertNumbers = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _claimedCertLock = new();
    private IPlaywright? _playwright;
    private IBrowserContext? _context;
    private bool _pageHandlersAttached;
    private bool _initialManualCaptchaWaitDone;

    public AutomationService(AutomationSettings settings, FirestoreService firestoreService)
    {
        _settings = settings;
        _firestoreService = firestoreService;
        DocaCredentials = CloneCredentials(settings.DocaCredentials);
    }

    private static DocaCredentialSettings CloneCredentials(DocaCredentialSettings source) => new()
    {
        Email = source.Email?.Trim() ?? string.Empty,
        Password = source.Password ?? string.Empty,
    };

    private DocaCredentialSettings EffectiveDocaCredentials()
    {
        if (!string.IsNullOrWhiteSpace(DocaCredentials.Email)
            && !string.IsNullOrWhiteSpace(DocaCredentials.Password))
        {
            return DocaCredentials;
        }

        return CloneCredentials(_settings.DocaCredentials);
    }

    /// <summary>-1 = default single browser profile; 0+ = parallel worker slot.</summary>
    public int WorkerIndex { get; set; } = -1;

    public bool IsRunning => IsBrowserConnected;

    public IBrowserContext? BrowserContext => _context;

    public bool IsBrowserConnected
    {
        get
        {
            if (_context is null)
            {
                return false;
            }

            try
            {
                var browser = _context.Browser;
                return browser is not null && browser.IsConnected;
            }
            catch
            {
                return false;
            }
        }
    }

    public static bool IsBrowserDisconnectedError(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            var message = current.Message;
            if (message.Contains("Target page, context or browser has been closed", StringComparison.OrdinalIgnoreCase)
                || message.Contains("Browser has been closed", StringComparison.OrdinalIgnoreCase)
                || message.Contains("Session closed", StringComparison.OrdinalIgnoreCase)
                || message.Contains("browser has been disconnected", StringComparison.OrdinalIgnoreCase)
                || message.Contains("context was destroyed", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    public async Task EnsureBrowserReadyAsync(CancellationToken cancellationToken = default)
    {
        await _browserLock.WaitAsync(cancellationToken);
        try
        {
            await ResetContextIfDisconnectedAsync();
            await EnsureContextAsync(cancellationToken);
            if (!UsesSystemChromeProfile)
            {
                await ConsolidateToSingleDocaPageAsync();
            }
        }
        finally
        {
            _browserLock.Release();
        }
    }

    /// <summary>Before processing a job: launch Chrome if needed and confirm eMAAP session is usable.</summary>
    public async Task<DocaOpenResult?> EnsureDocaSessionForJobAsync(CancellationToken cancellationToken = default)
    {
        // Always attempt auto-login when processing jobs (credentials + captcha + OTP).
        var probe = await ProbeDocaSessionAtProtectedRouteAsync(
            cancellationToken,
            forceAutoLogin: true);
        if (probe.State == DocaSessionState.LoggedIn)
        {
            return null;
        }

        if (probe.AttemptedAutoLogin)
        {
            var msg = probe.State == DocaSessionState.OtpRequired
                ? "eMAAP OTP required after auto-login — waiting Firebase / master OTP."
                : "eMAAP auto-login did not finish — will retry captcha + OTP.";
            return new DocaOpenResult(probe.State, msg);
        }

        var page = await GetPageAsync();
        return await TryEnsureLoggedInOrReturnLoginRequiredAsync(
            page,
            "retry the job",
            cancellationToken);
    }

    /// <summary>
    /// Probe session on a protected route. eMAAP login → eMAAP dashboard (never doca.gov.in).
    /// </summary>
    public async Task<DocaSessionProbeResult> ProbeDocaSessionAtProtectedRouteAsync(
        CancellationToken cancellationToken = default,
        bool forceAutoLogin = false)
    {
        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();

        await page.GotoAsync(_settings.DocaHomeUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.DOMContentLoaded,
            Timeout = 60_000,
        });

        if (await EmaapLoginAutomation.IsLoggedInAsync(page))
        {
            await page.BringToFrontAsync();
            return new DocaSessionProbeResult { State = DocaSessionState.LoggedIn };
        }

        // Manual password entry — do not steal focus / auto-submit.
        if (ManualDocaLoginWait && !forceAutoLogin)
        {
            await page.BringToFrontAsync();
            return new DocaSessionProbeResult
            {
                State = await EmaapLoginAutomation.IsOtpStepAsync(page)
                    ? DocaSessionState.OtpRequired
                    : DocaSessionState.LoginRequired,
            };
        }

        if (!forceAutoLogin)
        {
            await page.BringToFrontAsync();
            return new DocaSessionProbeResult
            {
                State = await EmaapLoginAutomation.IsOtpStepAsync(page)
                    ? DocaSessionState.OtpRequired
                    : DocaSessionState.LoginRequired,
            };
        }

        // forceAutoLogin: complete captcha + OTP (incl. already-on-OTP-step) via Firebase/master.
        var emaapState = await EnsureDocaLoggedInAsync(page, cancellationToken, forceAutoLogin: true);
        await page.BringToFrontAsync();
        return new DocaSessionProbeResult
        {
            State = emaapState,
            AttemptedAutoLogin = true,
        };
    }

    public async Task<DocaSessionState> ProbeDocaSessionAsync(CancellationToken cancellationToken = default)
    {
        var probe = await ProbeDocaSessionAtProtectedRouteAsync(cancellationToken, forceAutoLogin: true);
        return probe.State;
    }

    /// <summary>When true, do not navigate away from the DOCA login page while the operator enters a new password.</summary>
    public bool ManualDocaLoginWait { get; set; }

    public string BrowserProfileDirectory
    {
        get
        {
            // Mirror of system Chrome — real User Data cannot be automated (Chrome policy).
            if (_settings.UseSystemChromeProfile && WorkerIndex < 0 && WorkerIndex != -2)
            {
                return ChromeProfileMirror.MirrorUserDataDir;
            }

            var root = string.IsNullOrWhiteSpace(_settings.BrowserProfilePath)
                ? Path.Combine(WorkerProduct.DataRoot, "doca-browser")
                : Environment.ExpandEnvironmentVariables(_settings.BrowserProfilePath);

            return WorkerIndex switch
            {
                >= 0 => Path.Combine(root, $"worker-{WorkerIndex + 1}"),
                -2 => Path.Combine(root, "scraper"),
                _ => root,
            };
        }
    }

    public bool UsesSystemChromeProfile =>
        _settings.UseSystemChromeProfile && WorkerIndex < 0 && WorkerIndex != -2;

    public static string ResolveSystemChromeUserDataDir()
    {
        if (OperatingSystem.IsMacOS())
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Library",
                "Application Support",
                "Google",
                "Chrome");
        }

        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Google",
            "Chrome",
            "User Data");
    }

    public string SystemChromeProfileDirectoryName =>
        ChromeProfilePreference.ResolveDirectory(_settings.ChromeProfileDirectory);

    public string SystemChromeSourceProfileDir =>
        Path.Combine(ResolveSystemChromeUserDataDir(), SystemChromeProfileDirectoryName);

    public DocaCredentialSettings DocaCredentials { get; set; } = new();

    /// <summary>Run captcha OCR login on the current page when DOCA shows the login form.</summary>
    public Task<DocaSessionState> EnsureLoggedInOnPageAsync(
        IPage page,
        CancellationToken cancellationToken = default,
        bool forceAutoLogin = true) =>
        EnsureDocaLoggedInAsync(page, cancellationToken, forceAutoLogin);

    public Func<CancellationToken, Task<string>>? ResolveFirebaseIdToken { get; set; }

    public FirebaseSettings Firebase { get; set; } = new();

    public Func<CaptchaAttemptReport, Task>? CaptchaAttemptReporter { get; set; }

    /// <summary>Raised when email/password are read from the DOCA login form after a failed auto-login.</summary>
    public Action<DocaCredentialSettings>? DocaCredentialsCaptured { get; set; }

    /// <summary>
    /// Opens (or focuses) the DOCA browser window so the operator can confirm login before bulk runs.
    /// </summary>
    public async Task<DocaSessionState> OpenDocaWorkspaceAsync(
        int chromeNumber = 1,
        bool attemptAutoLogin = true,
        CancellationToken cancellationToken = default)
    {
        await EnsureBrowserReadyAsync(cancellationToken);

        IPage page;
        if (UsesSystemChromeProfile)
        {
            page = await GetPageAsync();
            if (!IsEmaapPage(page.Url) && !IsDocaPage(page.Url))
            {
                page = await ResetToFreshWorkPageAsync();
            }
        }
        else
        {
            page = await GetPageAsync();
        }

        if (!IsEmaapPage(page.Url)
            || !page.Url.Contains("/login", StringComparison.OrdinalIgnoreCase))
        {
            await page.GotoAsync(_settings.DocaLoginUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.DOMContentLoaded,
                Timeout = 60_000,
            });
        }

        await page.BringToFrontAsync();

        if (!UsesSystemChromeProfile)
        {
            page = await ConsolidateToSingleDocaPageAsync();
        }

        // React SPA — wait for login shell before probing / auto-login.
        if (EmaapLoginAutomation.IsEmaapUrl(_settings.DocaLoginUrl))
        {
            try
            {
                await page.WaitForSelectorAsync(
                    "input[name='email'], input[type='email'], .captcha-canvas",
                    new PageWaitForSelectorOptions
                    {
                        State = WaitForSelectorState.Visible,
                        Timeout = 45_000,
                    });
            }
            catch (TimeoutException)
            {
                await page.BringToFrontAsync();
                return DocaSessionState.LoginRequired;
            }
        }

        try
        {
            await page.EvaluateAsync(
                "document.title = " + System.Text.Json.JsonSerializer.Serialize($"YesGATC Chrome {chromeNumber} - eMAAP"));
        }
        catch (PlaywrightException)
        {
            // Title tweak is optional; navigation is enough for login verification.
        }

        if (await IsLoginPageAsync(page))
        {
            if (!attemptAutoLogin)
            {
                await page.BringToFrontAsync();
                return DocaSessionState.LoginRequired;
            }

            // Re-bind settings credentials if UI sync was skipped.
            var effective = EffectiveDocaCredentials();
            if (!string.IsNullOrWhiteSpace(effective.Email)
                && !string.IsNullOrWhiteSpace(effective.Password))
            {
                DocaCredentials = effective;
            }

            var loginState = await EnsureDocaLoggedInAsync(page, cancellationToken, forceAutoLogin: true);
            await page.BringToFrontAsync();
            return loginState;
        }

        return DocaSessionState.LoggedIn;
    }

    /// <summary>
    /// Legacy: first-launch 1-minute manual captcha pause. Disabled for eMAAP (AI captcha + OTP).
    /// </summary>
    private async Task ApplyInitialManualCaptchaWindowAsync(CancellationToken cancellationToken)
    {
        if (_initialManualCaptchaWaitDone || _context is null)
        {
            return;
        }

        _initialManualCaptchaWaitDone = true;

        // eMAAP uses canvas captcha OCR + email OTP — do not idle for a minute on an empty form.
        if (EmaapLoginAutomation.IsEmaapUrl(_settings.DocaLoginUrl))
        {
            return;
        }

        var page = await ConsolidateToSingleDocaPageAsync();
        await page.GotoAsync(_settings.DocaLoginUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load,
            Timeout = 60_000,
        });
        await page.BringToFrontAsync();
        await Task.Delay(TimeSpan.FromMinutes(1), cancellationToken);
    }

    public async Task ClearSavedSessionAsync()
    {
        await DisposeAsync();

        // Never wipe the real Chrome User Data; mirror is safe to delete.
        if (UsesSystemChromeProfile)
        {
            var mirror = ChromeProfileMirror.MirrorUserDataDir;
            if (Directory.Exists(mirror))
            {
                Directory.Delete(mirror, recursive: true);
            }

            return;
        }

        if (Directory.Exists(BrowserProfileDirectory))
        {
            Directory.Delete(BrowserProfileDirectory, recursive: true);
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _browserLock.WaitAsync();
        try
        {
            if (_context is not null)
            {
                DetachPageHandlers();
                await _context.CloseAsync();
                _context = null;
            }

            _playwright?.Dispose();
            _playwright = null;
        }
        finally
        {
            _browserLock.Release();
        }
    }

    private async Task ResetContextIfDisconnectedAsync()
    {
        if (_context is null)
        {
            return;
        }

        if (IsBrowserConnected)
        {
            return;
        }

        try
        {
            await _context.CloseAsync();
        }
        catch
        {
        }

        _context = null;
    }

    private static bool IsBlankBrowserPage(string url) =>
        string.IsNullOrWhiteSpace(url) || url.Equals("about:blank", StringComparison.OrdinalIgnoreCase);

    private static bool IsDocaPage(string url) =>
        url.Contains("doca.gov.in", StringComparison.OrdinalIgnoreCase);

    private static bool IsEmaapPage(string url) =>
        url.Contains("emaap.gov.in", StringComparison.OrdinalIgnoreCase);

    private static bool IsDeepSeekPage(string url) =>
        url.Contains("chat.deepseek.com", StringComparison.OrdinalIgnoreCase);

    /// <summary>eMAAP / DOCA work tabs — never prefer random restored Chrome tabs over these.</summary>
    private static bool IsAutomationPortalPage(string url) =>
        IsEmaapPage(url) || IsDocaPage(url);

    /// <summary>Keep one work tab — prefer eMAAP/DOCA and close every blank/extra tab.</summary>
    private async Task<IPage> ConsolidateToSingleDocaPageAsync()
    {
        if (_context is null)
        {
            throw new InvalidOperationException("Browser context is not initialized.");
        }

        for (var pass = 0; pass < 4; pass++)
        {
            var pages = _context.Pages.ToList();
            if (pages.Count == 0)
            {
                break;
            }

            if (pages.Count == 1)
            {
                return pages[0];
            }

            var hasPortalOrLoadedPage = pages.Any(page =>
                IsAutomationPortalPage(page.Url) || !IsBlankBrowserPage(page.Url));

            foreach (var page in pages)
            {
                if (hasPortalOrLoadedPage && IsBlankBrowserPage(page.Url))
                {
                    try
                    {
                        await page.CloseAsync();
                    }
                    catch (PlaywrightException)
                    {
                    }
                }
            }

            pages = _context.Pages.ToList();
            if (pages.Count <= 1)
            {
                break;
            }

            var keeper = pages.FirstOrDefault(page => IsAutomationPortalPage(page.Url))
                ?? pages.FirstOrDefault(page => !IsBlankBrowserPage(page.Url))
                ?? pages[0];

            foreach (var page in pages)
            {
                if (ReferenceEquals(page, keeper))
                {
                    continue;
                }

                // Keep DeepSeek OCR tab — reopening it every captcha breaks OTP Login focus.
                if (IsDeepSeekPage(page.Url))
                {
                    continue;
                }

                try
                {
                    await page.CloseAsync();
                }
                catch (PlaywrightException)
                {
                }
            }

            await Task.Delay(150);
        }

        var remaining = _context.Pages.ToList();
        if (remaining.Count == 0)
        {
            return await _context.NewPageAsync();
        }

        var primary = remaining.FirstOrDefault(page => IsAutomationPortalPage(page.Url))
            ?? remaining.FirstOrDefault(page => !IsBlankBrowserPage(page.Url))
            ?? remaining[0];
        await primary.BringToFrontAsync();
        return primary;
    }

    /// <summary>
    /// System Chrome restores previous tabs (Gmail, Zoho, …). Drop them and keep one fresh work tab.
    /// </summary>
    private async Task<IPage> ResetToFreshWorkPageAsync()
    {
        if (_context is null)
        {
            throw new InvalidOperationException("Browser context is not initialized.");
        }

        using var allowBlank = BrowserPageGuard.AllowTransientBlankPages();
        var fresh = await _context.NewPageAsync();
        foreach (var page in _context.Pages.ToList())
        {
            if (ReferenceEquals(page, fresh))
            {
                continue;
            }

            try
            {
                await page.CloseAsync();
            }
            catch (PlaywrightException)
            {
            }
        }

        await fresh.BringToFrontAsync();
        return fresh;
    }

    private void AttachPageHandlers()
    {
        if (_context is null || _pageHandlersAttached)
        {
            return;
        }

        _context.Page += OnBrowserContextPage;
        _pageHandlersAttached = true;
    }

    private void DetachPageHandlers()
    {
        if (_context is null || !_pageHandlersAttached)
        {
            return;
        }

        _context.Page -= OnBrowserContextPage;
        _pageHandlersAttached = false;
    }

    private async void OnBrowserContextPage(object? sender, IPage page)
    {
        if (_context is null)
        {
            return;
        }

        try
        {
            await Task.Delay(100);
            if (_context.Pages.Count <= 1)
            {
                return;
            }

            // DeepSeek OCR opens a blank tab then navigates — do not kill it.
            if (BrowserPageGuard.AllowsTransientBlankPages)
            {
                return;
            }

            if (IsBlankBrowserPage(page.Url))
            {
                await page.CloseAsync();
            }
        }
        catch (PlaywrightException)
        {
        }
    }

    private static void ClearStaleProfileLocks(string profileDirectory)
    {
        if (!Directory.Exists(profileDirectory))
        {
            return;
        }

        foreach (var name in new[] { "SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile" })
        {
            var path = Path.Combine(profileDirectory, name);
            try
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
            catch
            {
                // ignore
            }
        }
    }

    /// <summary>
    /// Turn off Chrome password manager prompts ("Save password?") in the worker profile.
    /// Creds are filled by automation — never offer to store them.
    /// </summary>
    private static void DisableChromePasswordSavingPrompts(string userDataDir)
    {
        try
        {
            var defaultDir = Path.Combine(userDataDir, "Default");
            Directory.CreateDirectory(defaultDir);
            var prefsPath = Path.Combine(defaultDir, "Preferences");

            JsonObject root;
            if (File.Exists(prefsPath))
            {
                var text = File.ReadAllText(prefsPath);
                root = JsonNode.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text) as JsonObject
                    ?? new JsonObject();
            }
            else
            {
                root = new JsonObject();
            }

            root["credentials_enable_service"] = false;

            var profile = root["profile"] as JsonObject ?? new JsonObject();
            profile["password_manager_enabled"] = false;
            profile["password_manager_leak_detection"] = false;
            root["profile"] = profile;

            File.WriteAllText(
                prefsPath,
                root.ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
        }
        catch
        {
            // Best-effort — launch args still reduce bubbles.
        }
    }

    private async Task<IBrowserContext> LaunchPersistentContextAsync(
        BrowserTypeLaunchPersistentContextOptions launchOptions)
    {
        if (_playwright is null)
        {
            throw new InvalidOperationException("Playwright is not initialized.");
        }

        try
        {
            return await _playwright.Chromium.LaunchPersistentContextAsync(
                BrowserProfileDirectory,
                launchOptions);
        }
        catch (PlaywrightException ex) when (IsExistingBrowserSessionError(ex))
        {
            ClearStaleProfileLocks(BrowserProfileDirectory);
            return await _playwright.Chromium.LaunchPersistentContextAsync(
                BrowserProfileDirectory,
                launchOptions);
        }
    }

    private static bool IsExistingBrowserSessionError(PlaywrightException exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current.Message.Contains("existing browser session", StringComparison.OrdinalIgnoreCase)
                || current.Message.Contains("Opening in", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private async Task EnsureContextAsync(CancellationToken cancellationToken)
    {
        _playwright ??= await Playwright.CreateAsync();

        if (_context is not null && IsBrowserConnected)
        {
            await ConsolidateToSingleDocaPageAsync();
            return;
        }

        if (_context is not null)
        {
            try
            {
                await _context.CloseAsync();
            }
            catch
            {
            }

            _context = null;
        }

        if (UsesSystemChromeProfile)
        {
            EnsureSystemChromeReadyToLaunch();
        }
        else
        {
            Directory.CreateDirectory(BrowserProfileDirectory);
        }

        var downloadsPath = Path.Combine(WorkerDataPaths.RootDirectory, "browser-downloads");
        Directory.CreateDirectory(downloadsPath);

        var args = new List<string>
        {
            "--disable-session-crashed-bubble",
            "--disable-restore-session-state",
            "--no-first-run",
            "--no-default-browser-check",
            "--hide-crash-restore-bubble",
            // Block Chrome "Save password?" bubble after eMAAP login.
            "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection,PasswordCheck",
            "--password-store=basic",
        };

        // Mirror always uses Default profile folder inside chrome-system-mirror.
        if (UsesSystemChromeProfile)
        {
            args.Add("--profile-directory=Default");
        }

        DisableChromePasswordSavingPrompts(BrowserProfileDirectory);

        var launchOptions = new BrowserTypeLaunchPersistentContextOptions
        {
            Headless = false,
            ViewportSize = ViewportSize.NoViewport,
            AcceptDownloads = true,
            DownloadsPath = downloadsPath,
            Args = args.ToArray(),
            IgnoreDefaultArgs = ["--enable-automation", "--no-sandbox"],
        };

        if (UsesSystemChromeProfile || !string.IsNullOrWhiteSpace(_settings.BrowserChannel))
        {
            launchOptions.Channel = UsesSystemChromeProfile
                ? "chrome"
                : _settings.BrowserChannel.Trim();
        }

        try
        {
            _context = await LaunchPersistentContextAsync(launchOptions);
            AttachPageHandlers();
            var workPage = UsesSystemChromeProfile
                ? await ResetToFreshWorkPageAsync()
                : await ConsolidateToSingleDocaPageAsync();

            // Navigate immediately so we never leave a black about:blank window.
            if (EmaapLoginAutomation.IsEmaapUrl(_settings.DocaLoginUrl)
                || !string.IsNullOrWhiteSpace(_settings.DocaLoginUrl))
            {
                await workPage.GotoAsync(_settings.DocaLoginUrl, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 90_000,
                });
                await workPage.BringToFrontAsync();
            }

            await ApplyInitialManualCaptchaWindowAsync(cancellationToken);
        }
        catch (PlaywrightException ex) when (UsesSystemChromeProfile || !string.IsNullOrWhiteSpace(launchOptions.Channel))
        {
            if (UsesSystemChromeProfile)
            {
                throw new InvalidOperationException(
                    $"Could not launch Chrome mirror of profile '{SystemChromeProfileDirectoryName}'. " +
                    "Close Chrome, set ResyncChromeProfile=true once if needed, then retry. " +
                    $"Playwright error: {ex.Message}",
                    ex);
            }

            throw new InvalidOperationException(
                $"Could not launch {launchOptions.Channel} for DOCA automation. " +
                "Install Google Chrome or set Automation:BrowserChannel to empty in appsettings.json. " +
                $"Playwright error: {ex.Message}",
                ex);
        }
    }

    private void EnsureSystemChromeReadyToLaunch()
    {
        if (!ChromeProfilePreference.HasSelection)
        {
            throw new InvalidOperationException(
                "No Chrome profile selected. Pick one in Account → Save profile, then retry.");
        }

        var source = SystemChromeSourceProfileDir;
        if (!Directory.Exists(ResolveSystemChromeUserDataDir()))
        {
            throw new InvalidOperationException(
                $"Chrome User Data not found at {ResolveSystemChromeUserDataDir()}. Install Google Chrome or disable UseSystemChromeProfile.");
        }

        if (!Directory.Exists(source))
        {
            throw new InvalidOperationException(
                $"Chrome profile '{SystemChromeProfileDirectoryName}' not found under {ResolveSystemChromeUserDataDir()}. " +
                "Set Automation:ChromeProfileDirectory to Default or Profile 1, etc.");
        }

        // Prefer Chrome closed so cookies copy cleanly; still try if open.
        var chromeRunning = IsChromeProcessRunning();
        try
        {
            ChromeProfileMirror.SyncFromSystemProfile(source, force: _settings.ResyncChromeProfile);
        }
        catch (Exception ex) when (chromeRunning)
        {
            throw new InvalidOperationException(
                "Could not sync Chrome profile while Chrome is running. Close all Chrome windows, then retry.",
                ex);
        }

        ClearStaleProfileLocks(ChromeProfileMirror.MirrorUserDataDir);
    }

    private static bool IsChromeProcessRunning()
    {
        try
        {
            return Process.GetProcessesByName("chrome").Length > 0;
        }
        catch
        {
            return false;
        }
    }

    private async Task<IPage> GetPageAsync()
    {
        if (_context is null)
        {
            throw new InvalidOperationException("Browser context is not initialized.");
        }

        return await ConsolidateToSingleDocaPageAsync();
    }

    private async Task<DocaSessionState> EnsureDocaLoggedInAsync(
        IPage page,
        CancellationToken cancellationToken = default,
        bool forceAutoLogin = false)
    {
        if (!await IsLoginPageAsync(page) && await EmaapLoginAutomation.IsLoggedInAsync(page))
        {
            return DocaSessionState.LoggedIn;
        }

        if (!forceAutoLogin && ManualDocaLoginWait)
        {
            await page.BringToFrontAsync();
            return DocaSessionState.LoginRequired;
        }

        if (!forceAutoLogin)
        {
            await page.BringToFrontAsync();
            return await IsLoginPageAsync(page) || await EmaapLoginAutomation.IsOtpStepAsync(page)
                ? (await EmaapLoginAutomation.IsOtpStepAsync(page)
                    ? DocaSessionState.OtpRequired
                    : DocaSessionState.LoginRequired)
                : DocaSessionState.LoginRequired;
        }

        // Signed out / OTP step / unknown — full captcha + OTP gate.
        if (!await IsLoginPageAsync(page) && !await EmaapLoginAutomation.IsOtpStepAsync(page))
        {
            if (!string.IsNullOrWhiteSpace(_settings.DocaLoginUrl))
            {
                await page.GotoAsync(_settings.DocaLoginUrl, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 60_000,
                });
            }
            else if (!string.IsNullOrWhiteSpace(_settings.DocaHomeUrl))
            {
                await page.GotoAsync(_settings.DocaHomeUrl, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 60_000,
                });
            }
        }

        return await DocaLoginAutomation.TryLoginAsync(
            page,
            _settings,
            EffectiveDocaCredentials(),
            cancellationToken,
            CaptchaAttemptReporter is null
                ? null
                : report => CaptchaAttemptReporter(report),
            Firebase,
            ResolveFirebaseIdToken);
    }

    /// <summary>Complete eMAAP email OTP step (after Send OTP). Uses existing captcha OCR.</summary>
    public async Task<DocaSessionState> SubmitEmaapOtpAsync(
        string otp,
        CancellationToken cancellationToken = default)
    {
        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();
        await page.BringToFrontAsync();
        return await EmaapLoginAutomation.SubmitOtpAsync(
            page,
            _settings,
            otp,
            cancellationToken,
            CaptchaAttemptReporter is null
                ? null
                : report => CaptchaAttemptReporter(report));
    }

    /// <summary>Click eMAAP "Resend OTP" when the 5‑min countdown finishes.</summary>
    public async Task<bool> TryResendEmaapOtpIfEnabledAsync(
        CancellationToken cancellationToken = default)
    {
        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();
        return await EmaapLoginAutomation.TryClickResendOtpIfEnabledAsync(page);
    }

    /// <summary>
    /// Logged-in eMAAP: fill form → Submit Certificate Details → OK → Certificates Issued
    /// (Download once to generate, wait 3s, Download again to open PDF) → mark certified in Firebase.
    /// When <paramref name="fillOnly"/> is true: fill through Name of Principal Officer, then stop.
    /// </summary>
    public async Task<string> FillEmaapCertificateGenerationAsync(
        SiteCalibrationRecord job,
        PartyContactDetails party,
        InstrumentDetails instrument,
        string firebaseIdToken,
        bool fillOnly = false,
        CancellationToken cancellationToken = default)
    {
        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();
        await page.BringToFrontAsync();

        await EnsureEmaapLoggedInForWorkAsync(page, cancellationToken);

        var imageDownload = new FirebaseStorageDownloadService();
        var photoDir = WorkerDataPaths.StampingImagesDirectory;
        var preparedPaths = new List<string>();

        var token = ResolveFirebaseIdToken is not null
            ? await ResolveFirebaseIdToken(cancellationToken)
            : firebaseIdToken;

        var pendingCert = FirstNonEmpty(
            job.EmaapIssuedCertificateNumber,
            FirestoreService.TryExtractEmaapCertificateNumber(job.PipelineFailureMessage));

        // Matcher HALT lists other parties' certs as "Visible sample" — never resume those.
        if (FirestoreService.IsUnmatchedIssuedRowHalt(job.PipelineFailureMessage))
        {
            pendingCert = null;
        }

        // Resume: eMAAP already generated this cert — download PDF only (do not re-submit).
        // Fill-only tests never resume into certify.
        if (!fillOnly && !string.IsNullOrWhiteSpace(pendingCert))
        {
            return await DownloadIssuedPdfAndMarkCertifiedAsync(
                page,
                job,
                party,
                instrument,
                token,
                pendingCert,
                filledPhotoCount: 0,
                minExclusiveSequence: null,
                cancellationToken);
        }

        int? minExclusiveSequence = null;
        if (!fillOnly)
        {
            minExclusiveSequence = await EmaapCertificatesIssuedAutomation.PeekHighestMatchingSequenceAsync(
                page,
                party,
                cancellationToken);
        }

        // Submit already saved; issued row may still have an empty cert number. Download only.
        if (!fillOnly && FirestoreService.IsPostSubmitPdfHalt(job.PipelineFailureMessage))
        {
            return await DownloadIssuedPdfAndMarkCertifiedAsync(
                page,
                job,
                party,
                instrument,
                token,
                preferCertificateNumber: null,
                filledPhotoCount: 0,
                minExclusiveSequence,
                cancellationToken);
        }

        var slots = new (string Url, string Name, string ContentType, string Kind, string Label, string OutFile)[]
        {
            (instrument.StampingImageUrl, instrument.StampingImageName, instrument.StampingImageContentType,
                "stamping", "Serial number plate photo", "emaap-photo-1-stamping.jpg"),
            (instrument.ScaleImageUrl, instrument.ScaleImageName, instrument.ScaleImageContentType,
                "scale", "Instrument photo", "emaap-photo-2-scale.jpg"),
            (instrument.InstrumentRearImageUrl, instrument.InstrumentRearImageName, instrument.InstrumentRearImageContentType,
                "rear", "Instrument rear photo", "emaap-photo-3-rear.jpg"),
            (instrument.StandardWeightImageUrl, instrument.StandardWeightImageName, instrument.StandardWeightImageContentType,
                "weights", "Standard weight photo", "emaap-photo-4-weights.jpg"),
            (instrument.VerificationSealImageUrl, instrument.VerificationSealImageName, instrument.VerificationSealImageContentType,
                "seal", "Verification seal photo", "emaap-photo-5-seal.jpg"),
        };

        foreach (var slot in slots)
        {
            var downloaded = await imageDownload.TryDownloadVerificationImageAsync(
                job.Id,
                instrument.SerialNumber,
                slot.Url,
                slot.Name,
                slot.ContentType,
                slot.Kind,
                slot.Label,
                cancellationToken);

            if (downloaded is null)
            {
                preparedPaths.Add(string.Empty);
                continue;
            }

            var prepared = DocaUploadImagePreparer.PrepareMachinePhotoForUpload(
                downloaded.LocalPath,
                Path.GetDirectoryName(downloaded.LocalPath) ?? photoDir,
                _settings.DocaUploadImageMaxBytes,
                _settings.DocaUploadImageMaxEdgePx,
                outputFileName: slot.OutFile);
            preparedPaths.Add(prepared.Path);
        }

        if (string.IsNullOrWhiteSpace(preparedPaths[0]) || !File.Exists(preparedPaths[0]))
        {
            throw new InvalidOperationException(
                "Serial number plate photo is required for eMAAP machine photo upload.");
        }

        var filledCount = preparedPaths.Count(p => !string.IsNullOrWhiteSpace(p) && File.Exists(p));
        var weightsPath = preparedPaths.Count > 3 ? preparedPaths[3] : string.Empty;

        // Weights photo → Instrument Certificate Upload (visible on generate form before submit).
        if (string.IsNullOrWhiteSpace(weightsPath) || !File.Exists(weightsPath))
        {
            throw new InvalidOperationException(
                "Standard weight photo is missing on the verification record (needed for eMAAP Upload).");
        }

        await FillStarterFormWithSessionRetryAsync(
            page,
            party,
            instrument,
            preparedPaths,
            weightsPath,
            fillOnly,
            cancellationToken);

        if (fillOnly)
        {
            return $"eMAAP fill-only complete for {instrument.SerialNumber} " +
                   $"({filledCount} photo slot(s) prepared). Filled through Principal Officer — Submit Certificate Details not clicked.";
        }

        return await DownloadIssuedPdfAndMarkCertifiedAsync(
            page,
            job,
            party,
            instrument,
            token,
            preferCertificateNumber: null,
            filledPhotoCount: filledCount,
            minExclusiveSequence,
            cancellationToken);
    }

    /// <summary>Navigate home if needed; auto captcha+OTP when signed out.</summary>
    private async Task EnsureEmaapLoggedInForWorkAsync(IPage page, CancellationToken cancellationToken)
    {
        if (!EmaapLoginAutomation.IsEmaapUrl(page.Url) || await IsLoginPageAsync(page))
        {
            if (!string.IsNullOrWhiteSpace(_settings.DocaHomeUrl))
            {
                await page.GotoAsync(_settings.DocaHomeUrl, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 60_000,
                });
            }
        }

        if (await EmaapLoginAutomation.IsLoggedInAsync(page) && !await IsLoginPageAsync(page))
        {
            return;
        }

        var state = await EnsureDocaLoggedInAsync(page, cancellationToken, forceAutoLogin: true);
        if (state == DocaSessionState.LoggedIn)
        {
            return;
        }

        if (state == DocaSessionState.OtpRequired)
        {
            throw new InvalidOperationException(
                "eMAAP OTP required — waiting for Firebase OTP / master OTP. Worker will retry after login.");
        }

        throw new InvalidOperationException(
            "eMAAP browser is on the login page. Sign in to eMAAP first, then retry Fill up in eMAAP.");
    }

    private async Task FillStarterFormWithSessionRetryAsync(
        IPage page,
        PartyContactDetails party,
        InstrumentDetails instrument,
        IReadOnlyList<string> preparedPaths,
        string weightsPath,
        bool fillOnly,
        CancellationToken cancellationToken)
    {
        try
        {
            await EmaapCertificateGenerationAutomation.FillStarterFormAsync(
                page,
                party,
                instrument,
                preparedPaths,
                weightsPath,
                fillOnly,
                cancellationToken: cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not EmaapMandatoryStepException)
        {
            // Session often dies mid-batch: form field timeouts or redirect to login.
            if (!await IsLoginPageAsync(page) && !LooksLikeSessionLoss(ex))
            {
                throw;
            }

            // Bounce through home so eMAAP re-auth redirect is visible, then full auto-login.
            if (!string.IsNullOrWhiteSpace(_settings.DocaHomeUrl))
            {
                try
                {
                    await page.GotoAsync(_settings.DocaHomeUrl, new PageGotoOptions
                    {
                        WaitUntil = WaitUntilState.DOMContentLoaded,
                        Timeout = 60_000,
                    });
                }
                catch (PlaywrightException)
                {
                    // Browser may be mid-crash — EnsureEmaapLoggedIn will surface it.
                }
            }

            await EnsureEmaapLoggedInForWorkAsync(page, cancellationToken);
            await EmaapCertificateGenerationAutomation.FillStarterFormAsync(
                page,
                party,
                instrument,
                preparedPaths,
                weightsPath,
                fillOnly,
                cancellationToken: cancellationToken);
        }
    }

    private static bool LooksLikeSessionLoss(Exception ex)
    {
        var msg = ex.Message ?? string.Empty;
        return msg.Contains("Timeout", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("type_of_instrument", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("instrument_type", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("login", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("navigat", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("Target closed", StringComparison.OrdinalIgnoreCase)
            || msg.Contains("Execution context was destroyed", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<string> DownloadIssuedPdfAndMarkCertifiedAsync(
        IPage page,
        SiteCalibrationRecord job,
        PartyContactDetails party,
        InstrumentDetails instrument,
        string firebaseIdToken,
        string? preferCertificateNumber,
        int filledPhotoCount,
        int? minExclusiveSequence,
        CancellationToken cancellationToken)
    {
        EmaapCertificateDownloadResult download;
        try
        {
            download = await EmaapCertificatesIssuedAutomation.DownloadHighestMatchingAsync(
                page,
                party,
                WorkerDataPaths.CertificatePdfDirectory(job.Id),
                cancellationToken,
                preferCertificateNumber,
                onCertificateMatchedAsync: async cert =>
                {
                    try
                    {
                        var fresh = ResolveFirebaseIdToken is not null
                            ? await ResolveFirebaseIdToken(cancellationToken)
                            : firebaseIdToken;
                        await _firestoreService.SetEmaapIssuedCertificateNumberAsync(
                            job.Id,
                            cert,
                            fresh,
                            cancellationToken);
                    }
                    catch
                    {
                        // Best-effort — resume still works from HALT message later.
                    }
                },
                excludeCertificateNumbers: SnapshotClaimedEmaapCerts(),
                minExclusiveSequence: preferCertificateNumber is null ? minExclusiveSequence : null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new EmaapMandatoryStepException(
                $"HALT — eMAAP submit succeeded for serial {instrument.SerialNumber}, but PDF download failed: {ex.Message}",
                ex);
        }

        if (string.IsNullOrWhiteSpace(download.CertificateNumber)
            || string.IsNullOrWhiteSpace(download.LocalPdfPath)
            || !File.Exists(download.LocalPdfPath))
        {
            throw new EmaapMandatoryStepException(
                $"HALT — eMAAP submit succeeded for serial {instrument.SerialNumber}, but certificate PDF is missing on disk.");
        }

        var pdfBytes = await File.ReadAllBytesAsync(download.LocalPdfPath, cancellationToken);
        if (pdfBytes.Length < 5
            || pdfBytes[0] != (byte)'%'
            || pdfBytes[1] != (byte)'P'
            || pdfBytes[2] != (byte)'D'
            || pdfBytes[3] != (byte)'F')
        {
            throw new EmaapMandatoryStepException(
                $"HALT — eMAAP submit succeeded for serial {instrument.SerialNumber}, but downloaded file is not a valid PDF.");
        }

        RememberClaimedEmaapCert(download.CertificateNumber);

        try
        {
            await _firestoreService.MarkCertifiedWithSignedPdfAsync(
                job.Id,
                download.LocalPdfPath,
                firebaseIdToken,
                download.CertificateNumber,
                download.EmaapPdfUrl,
                cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new EmaapMandatoryStepException(
                $"HALT — PDF downloaded ({download.CertificateNumber}) for serial {instrument.SerialNumber}, but mark certified / Firebase upload failed: {ex.Message}",
                ex);
        }

        var photoNote = filledPhotoCount > 0
            ? $" · uploaded {filledPhotoCount} photo(s)"
            : " · PDF resume (no re-submit)";

        return
            $"eMAAP certified {party.BelongToName} · serial {instrument.SerialNumber} · " +
            $"{download.CertificateNumber}{photoNote} · PDF synced to Firebase.";
    }

    private string[] SnapshotClaimedEmaapCerts()
    {
        lock (_claimedCertLock)
        {
            return _claimedEmaapCertNumbers.ToArray();
        }
    }

    private void RememberClaimedEmaapCert(string? certificateNumber)
    {
        if (string.IsNullOrWhiteSpace(certificateNumber))
        {
            return;
        }

        lock (_claimedCertLock)
        {
            _claimedEmaapCertNumbers.Add(certificateNumber.Trim());
        }
    }

    private static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return null;
    }

    /// <summary>Try Automation:EmaapMasterOtp once (then caller may fall back to Firebase).</summary>
    public async Task<DocaSessionState> TrySubmitMasterEmaapOtpAsync(
        CancellationToken cancellationToken = default)
    {
        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();
        await page.BringToFrontAsync();
        return await EmaapLoginAutomation.TrySubmitMasterOtpAsync(
            page,
            _settings,
            cancellationToken,
            CaptchaAttemptReporter is null
                ? null
                : report => CaptchaAttemptReporter(report));
    }

    private async Task<DocaOpenResult?> TryEnsureLoggedInOnPageAsync(
        IPage page,
        string retryHint,
        CancellationToken cancellationToken)
    {
        if (!await IsLoginPageAsync(page))
        {
            return null;
        }

        return await TryEnsureLoggedInOrReturnLoginRequiredAsync(page, retryHint, cancellationToken);
    }

    private async Task<DocaOpenResult?> TryEnsureLoggedInOrReturnLoginRequiredAsync(
        IPage page,
        string retryHint,
        CancellationToken cancellationToken)
    {
        var loginState = await EnsureDocaLoggedInAsync(page, cancellationToken, forceAutoLogin: true);
        if (loginState == DocaSessionState.LoggedIn)
        {
            return null;
        }

        await page.BringToFrontAsync();

        var captured = await CaptureDocaCredentialsFromBrowserAsync(page);
        if (captured is not null
            && !string.IsNullOrWhiteSpace(captured.Email)
            && !string.IsNullOrWhiteSpace(captured.Password))
        {
            DocaCredentials = captured;
            DocaCredentialsCaptured?.Invoke(captured);
        }

        var effective = EffectiveDocaCredentials();
        var missingCreds = string.IsNullOrWhiteSpace(effective.Email)
            || string.IsNullOrWhiteSpace(effective.Password);
        var message = missingCreds
            ? "eMAAP email/password missing — set Account fields or appsettings.local.json, Save Credentials, retry."
            : _settings.AutoSolveCaptcha
                ? $"eMAAP auto-login failed after {_settings.CaptchaMaxAttempts} captcha attempt(s). Check email/password / captcha; worker will retry."
                : $"eMAAP login required — complete login, then {retryHint}.";

        return new DocaOpenResult(DocaSessionState.LoginRequired, message);
    }

    private async Task<bool> IsLoginPageAsync(IPage page)
    {
        var url = page.Url;
        if (url.Contains("/login", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (await EmaapLoginAutomation.IsLoggedInAsync(page))
        {
            return false;
        }

        var captcha = page.Locator(
            "input[placeholder*='Captcha' i], input[name*='captcha' i], input.captcha-input, .captcha-canvas");
        if (await captcha.CountAsync() > 0)
        {
            return true;
        }

        var loginButton = page.GetByRole(AriaRole.Button, new() { Name = "Login Now" });
        if (await loginButton.CountAsync() > 0)
        {
            return true;
        }

        var sendOtp = page.GetByRole(AriaRole.Button, new() { Name = "Send OTP" });
        return await sendOtp.CountAsync() > 0;
    }

    public async Task<DocaCredentialSettings?> CaptureDocaCredentialsFromBrowserAsync(IPage? page = null)
    {
        if (page is null && _context is not null)
        {
            page = await GetPageAsync();
        }

        if (page is null)
        {
            return null;
        }

        var emailField = page.Locator(
            "input[type='email'], input[name*='email' i], input[id*='email' i], input[name*='user' i], input[id*='user' i], input[autocomplete='username']")
            .First;
        var passwordField = page.Locator("input[type='password']").First;

        if (await emailField.CountAsync() == 0 && await passwordField.CountAsync() == 0)
        {
            return null;
        }

        var email = await emailField.CountAsync() > 0 ? await emailField.InputValueAsync() : string.Empty;
        var password = await passwordField.CountAsync() > 0 ? await passwordField.InputValueAsync() : string.Empty;

        if (string.IsNullOrWhiteSpace(email) && string.IsNullOrWhiteSpace(password))
        {
            return null;
        }

        return new DocaCredentialSettings
        {
            Email = email.Trim(),
            Password = password,
        };
    }
}
