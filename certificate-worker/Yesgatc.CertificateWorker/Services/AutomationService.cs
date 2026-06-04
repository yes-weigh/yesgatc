using System.IO;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public enum DocaSessionState
{
    LoggedIn,
    LoginRequired,
}

public sealed record DocaOpenResult(
    DocaSessionState State,
    string Message,
    bool VerificationApproved = false,
    bool DuplicateOnDoca = false);

public sealed class AutomationService : IAsyncDisposable
{
    private readonly AutomationSettings _settings;
    private readonly FirestoreService _firestoreService;
    private readonly SemaphoreSlim _browserLock = new(1, 1);
    private IPlaywright? _playwright;
    private IBrowserContext? _context;
    private bool _pageHandlersAttached;

    public AutomationService(AutomationSettings settings, FirestoreService firestoreService)
    {
        _settings = settings;
        _firestoreService = firestoreService;
    }

    /// <summary>-1 = default single browser profile; 0+ = parallel worker slot with its own profile.</summary>
    public int WorkerIndex { get; set; } = -1;

    public bool IsRunning => IsBrowserConnected;

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
                return _context.Browser.IsConnected;
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
            await ConsolidateToSingleDocaPageAsync();
        }
        finally
        {
            _browserLock.Release();
        }
    }

    /// <summary>Before processing a job: launch Chrome if needed and confirm DOCA session is usable.</summary>
    public async Task<DocaOpenResult?> EnsureDocaSessionForJobAsync(CancellationToken cancellationToken = default)
    {
        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();

        if (IsBlankBrowserPage(page.Url))
        {
            await page.GotoAsync(_settings.DocaHomeUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 60_000,
            });
        }

        if (await IsLoginPageAsync(page))
        {
            return await TryEnsureLoggedInOrReturnLoginRequiredAsync(
                page,
                "retry the job",
                cancellationToken);
        }

        return null;
    }

    public async Task<DocaSessionState> ProbeDocaSessionAsync(CancellationToken cancellationToken = default)
    {
        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();

        if (ManualDocaLoginWait)
        {
            await page.BringToFrontAsync();
            if (IsBlankBrowserPage(page.Url))
            {
                await page.GotoAsync(_settings.DocaLoginUrl, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.Load,
                    Timeout = 60_000,
                });
            }
        }
        else
        {
            await page.GotoAsync(_settings.DocaHomeUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 60_000,
            });
        }

        if (await IsLoginPageAsync(page))
        {
            // During periodic probe, always retry AI auto-login even when paused for a prior failure.
            var loginState = await EnsureDocaLoggedInAsync(page, cancellationToken, forceAutoLogin: true);
            await page.BringToFrontAsync();
            return loginState;
        }

        await page.BringToFrontAsync();
        return DocaSessionState.LoggedIn;
    }

    /// <summary>When true, do not navigate away from the DOCA login page while the operator enters a new password.</summary>
    public bool ManualDocaLoginWait { get; set; }

    public string BrowserProfileDirectory
    {
        get
        {
            var root = string.IsNullOrWhiteSpace(_settings.BrowserProfilePath)
                ? Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "YesGATC",
                    "CertificateWorker",
                    "doca-browser")
                : Environment.ExpandEnvironmentVariables(_settings.BrowserProfilePath);

            return WorkerIndex >= 0
                ? Path.Combine(root, $"worker-{WorkerIndex + 1}")
                : root;
        }
    }

    public DocaCredentialSettings DocaCredentials { get; set; } = new();

    public Func<CancellationToken, Task<string>>? ResolveFirebaseIdToken { get; set; }

    /// <summary>Phase 2 — open OV form, select instrument type, fill party section.</summary>
    public async Task<DocaOpenResult> RunOvStarterAsync(
        SiteCalibrationRecord job,
        PartyContactDetails party,
        InstrumentDetails instrument,
        string firebaseIdToken,
        DocaCredentialSettings? docaCredentials = null,
        bool continueOnSamePage = false,
        CancellationToken cancellationToken = default)
    {
        if (docaCredentials is not null)
        {
            DocaCredentials = docaCredentials;
        }

        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();

        var serial = instrument.SerialNumber.Trim();
        if (string.IsNullOrWhiteSpace(serial))
        {
            throw new InvalidOperationException("Serial number is required before submitting on DOCA.");
        }

        if (!continueOnSamePage)
        {
            await page.GotoAsync(_settings.DocaCreateIcVerificationUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 60_000,
            });
        }
        else if (!await IsOnIcVerificationFormAsync(page))
        {
            await page.GotoAsync(_settings.DocaCreateIcVerificationUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 60_000,
            });
        }
        else
        {
            await DocaFormFiller.PrepareForNextJobAsync(page);
        }

        if (await IsLoginPageAsync(page))
        {
            var loginFailure = await TryEnsureLoggedInOrReturnLoginRequiredAsync(
                page,
                "run automation again",
                cancellationToken);
            if (loginFailure is not null)
            {
                return loginFailure;
            }
        }

        await page.GetByText("Instrument Generate Certificate", new PageGetByTextOptions { Exact = false })
            .WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });

        await DocaFormFiller.EnsurePageInstrumentTypeSelectedAsync(page);

        await DocaFormFiller.FillPartySectionAsync(page, party);
        await DocaFormFiller.FillInstrumentSectionAsync(page, instrument);

        var imageDownload = new FirebaseStorageDownloadService();
        var stampingImage = await imageDownload.DownloadStampingImageAsync(
            job.Id,
            instrument.SerialNumber,
            instrument.StampingImageUrl,
            instrument.StampingImageName,
            instrument.StampingImageContentType,
            cancellationToken);

        var preparedPhoto = DocaUploadImagePreparer.PrepareMachinePhotoForUpload(
            stampingImage.LocalPath,
            Path.GetDirectoryName(stampingImage.LocalPath)!,
            _settings.DocaUploadImageMaxBytes,
            _settings.DocaUploadImageMaxEdgePx);

        await DocaFormFiller.FillMachinePhotoSectionAsync(page, instrument, preparedPhoto.Path);
        await DocaFormFiller.WaitForDocaSubmissionSuccessAsync(page);

        var postSubmitLogin = await TryEnsureLoggedInOnPageAsync(page, "run automation again", cancellationToken);
        if (postSubmitLogin is not null)
        {
            return postSubmitLogin;
        }

        if (string.Equals(job.Status, "submitted", StringComparison.OrdinalIgnoreCase))
        {
            await _firestoreService.ApproveVerificationAsync(job.Id, firebaseIdToken, cancellationToken);
        }
        else
        {
            await _firestoreService.TouchCertificationAsync(job.Id, firebaseIdToken, cancellationToken);
        }

        await page.BringToFrontAsync();

        var sizeKb = Math.Max(1, stampingImage.SizeBytes / 1024);
        var firebaseNote = job.IsSubmitted
            ? "Firebase status updated to approved."
            : "DOCA certification recorded (already approved in Firebase).";
        return new DocaOpenResult(
            DocaSessionState.LoggedIn,
            $"DOCA certificate generated for {party.BelongToName}. Serial {instrument.SerialNumber}. " +
            $"{firebaseNote} {preparedPhoto.Summary}. Stamping plate: {stampingImage.LocalPath} ({sizeKb} KB original).",
            VerificationApproved: true);
    }

    /// <summary>
    /// Opens View IC Verification, searches by serial, opens Details, downloads the certificate PDF,
    /// stamps it, and uploads the signed PDF back to DOCA.
    /// </summary>
    public async Task<DocaOpenResult> RunCertificationLookupAsync(
        SiteCalibrationRecord job,
        InstrumentDetails instrument,
        string firebaseIdToken,
        DocaCredentialSettings? docaCredentials = null,
        bool continueOnSamePage = false,
        CancellationToken cancellationToken = default)
    {
        if (docaCredentials is not null)
        {
            DocaCredentials = docaCredentials;
        }

        if (string.IsNullOrWhiteSpace(job.SerialNumber))
        {
            throw new InvalidOperationException("Serial number is required for View IC Verification lookup.");
        }

        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();

        if (!continueOnSamePage)
        {
            await page.GotoAsync(_settings.DocaViewIcVerificationUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 60_000,
            });
        }
        else
        {
            await page.BringToFrontAsync();
        }

        if (await IsLoginPageAsync(page))
        {
            var loginFailure = await TryEnsureLoggedInOrReturnLoginRequiredAsync(
                page,
                "run certification again",
                cancellationToken);
            if (loginFailure is not null)
            {
                return loginFailure;
            }
        }

        var downloadDirectory = WorkerDataPaths.CertificatePdfDirectory(job.Id);
        var downloadResult = await DocaViewVerificationService.FindDetailsAndDownloadPdfAsync(
            page,
            _settings.DocaViewIcVerificationUrl,
            job.SerialNumber,
            downloadDirectory,
            cancellationToken);

        var postDownloadLogin = await TryEnsureLoggedInOnPageAsync(page, "run certification again", cancellationToken);
        if (postDownloadLogin is not null)
        {
            return postDownloadLogin;
        }

        var stampResult = CertificatePdfStampService.StampPrincipalOfficerSignature(
            downloadResult.LocalPdfPath,
            _settings.CertificateStamp);

        var imageDownload = new FirebaseStorageDownloadService();
        var scaleImage = await imageDownload.DownloadScaleImageAsync(
            job.Id,
            instrument.SerialNumber,
            instrument.ScaleImageUrl,
            instrument.ScaleImageName,
            instrument.ScaleImageContentType,
            cancellationToken);

        var preparedPhoto = DocaUploadImagePreparer.PrepareMachinePhotoForUpload(
            scaleImage.LocalPath,
            Path.GetDirectoryName(scaleImage.LocalPath)!,
            _settings.DocaUploadImageMaxBytes,
            _settings.DocaUploadImageMaxEdgePx);

        await DocaViewVerificationService.UploadStampedCertificateAsync(
            page,
            _settings.DocaViewIcVerificationUrl,
            job.SerialNumber,
            stampResult.OutputPath,
            preparedPhoto.Path,
            instrument.Remarks,
            cancellationToken);

        var postUploadLogin = await TryEnsureLoggedInOnPageAsync(page, "run certification again", cancellationToken);
        if (postUploadLogin is not null)
        {
            return postUploadLogin;
        }

        var match = downloadResult.Match;
        var firebaseToken = ResolveFirebaseIdToken is not null
            ? await ResolveFirebaseIdToken(cancellationToken)
            : firebaseIdToken;

        await _firestoreService.MarkCertifiedWithSignedPdfAsync(
            job.Id,
            stampResult.OutputPath,
            firebaseToken,
            match.CertificateNumber,
            cancellationToken);

        var details = new List<string> { $"Serial {match.SerialNumber}" };
        if (!string.IsNullOrWhiteSpace(match.ApplicationNumber))
        {
            details.Add($"Application {match.ApplicationNumber}");
        }

        if (!string.IsNullOrWhiteSpace(match.CertificateNumber))
        {
            details.Add($"Certificate {match.CertificateNumber}");
        }

        var instrumentPhotoNote = instrument.ScaleImageUsesStampingFallback
            ? "Instrument photo (stamping plate fallback)"
            : "Instrument photo (scale)";

        return new DocaOpenResult(
            DocaSessionState.LoggedIn,
            $"Certificate uploaded to DOCA, saved to Firebase Storage, and marked certified — {string.Join(" · ", details)}. " +
            $"Signed PDF: {stampResult.OutputPath}. {instrumentPhotoNote}: {preparedPhoto.Summary}.",
            VerificationApproved: true);
    }

    /// <summary>
    /// Opens (or focuses) the DOCA browser window so the operator can confirm login before bulk runs.
    /// </summary>
    public async Task<DocaSessionState> OpenDocaWorkspaceAsync(
        int chromeNumber = 1,
        CancellationToken cancellationToken = default)
    {
        await EnsureBrowserReadyAsync(cancellationToken);
        var page = await GetPageAsync();

        await page.GotoAsync(_settings.DocaLoginUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load,
            Timeout = 60_000,
        });

        page = await ConsolidateToSingleDocaPageAsync();

        try
        {
            await page.EvaluateAsync(
                "document.title = " + System.Text.Json.JsonSerializer.Serialize($"YesGATC Chrome {chromeNumber} - DOCA"));
        }
        catch (PlaywrightException)
        {
            // Title tweak is optional; navigation is enough for login verification.
        }

        if (await IsLoginPageAsync(page))
        {
            return await EnsureDocaLoggedInAsync(page, cancellationToken);
        }

        return DocaSessionState.LoggedIn;
    }

    public async Task ClearSavedSessionAsync()
    {
        await DisposeAsync();

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

    /// <summary>Keep one work tab — prefer DOCA and close every blank/extra tab.</summary>
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

            var hasDocaOrLoadedPage = pages.Any(page => IsDocaPage(page.Url) || !IsBlankBrowserPage(page.Url));

            foreach (var page in pages)
            {
                if (hasDocaOrLoadedPage && IsBlankBrowserPage(page.Url))
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

            var keeper = pages.FirstOrDefault(page => IsDocaPage(page.Url))
                ?? pages.FirstOrDefault(page => !IsBlankBrowserPage(page.Url))
                ?? pages[0];

            foreach (var page in pages)
            {
                if (ReferenceEquals(page, keeper))
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

        var primary = remaining.FirstOrDefault(page => IsDocaPage(page.Url))
            ?? remaining.FirstOrDefault(page => !IsBlankBrowserPage(page.Url))
            ?? remaining[0];
        await primary.BringToFrontAsync();
        return primary;
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

        foreach (var lockName in new[] { "SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile" })
        {
            var lockPath = Path.Combine(profileDirectory, lockName);
            if (!File.Exists(lockPath))
            {
                continue;
            }

            try
            {
                File.Delete(lockPath);
            }
            catch (IOException)
            {
            }
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

        Directory.CreateDirectory(BrowserProfileDirectory);
        var downloadsPath = Path.Combine(WorkerDataPaths.RootDirectory, "browser-downloads");
        Directory.CreateDirectory(downloadsPath);

        var launchOptions = new BrowserTypeLaunchPersistentContextOptions
        {
            Headless = false,
            ViewportSize = ViewportSize.NoViewport,
            AcceptDownloads = true,
            DownloadsPath = downloadsPath,
            Args =
            [
                "--disable-session-crashed-bubble",
                "--disable-restore-session-state",
                "--no-first-run",
                "--no-default-browser-check",
            ],
        };

        if (!string.IsNullOrWhiteSpace(_settings.BrowserChannel))
        {
            launchOptions.Channel = _settings.BrowserChannel.Trim();
        }

        try
        {
            _context = await LaunchPersistentContextAsync(launchOptions);
            AttachPageHandlers();
            await ConsolidateToSingleDocaPageAsync();
        }
        catch (PlaywrightException ex) when (!string.IsNullOrWhiteSpace(launchOptions.Channel))
        {
            throw new InvalidOperationException(
                $"Could not launch {_settings.BrowserChannel} for DOCA automation. " +
                "Install Google Chrome or set Automation:BrowserChannel to empty in appsettings.json. " +
                $"Playwright error: {ex.Message}",
                ex);
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

    private async Task<bool> IsOnIcVerificationFormAsync(IPage page)
    {
        if (await IsLoginPageAsync(page))
        {
            return false;
        }

        var url = page.Url;
        if (url.Contains("create-ic-verification", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var formHeading = page.GetByText("Instrument Generate Certificate", new PageGetByTextOptions { Exact = false });
        return await formHeading.CountAsync() > 0;
    }

    private async Task<DocaSessionState> EnsureDocaLoggedInAsync(
        IPage page,
        CancellationToken cancellationToken = default,
        bool forceAutoLogin = false)
    {
        if (!await IsLoginPageAsync(page))
        {
            return DocaSessionState.LoggedIn;
        }

        if (!forceAutoLogin && ManualDocaLoginWait)
        {
            await page.BringToFrontAsync();
            return DocaSessionState.LoginRequired;
        }

        return await DocaLoginAutomation.TryLoginAsync(page, _settings, DocaCredentials, cancellationToken);
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
        var loginState = await EnsureDocaLoggedInAsync(page, cancellationToken);
        if (loginState == DocaSessionState.LoggedIn)
        {
            return null;
        }

        await page.BringToFrontAsync();

        var captured = await CaptureDocaCredentialsFromBrowserAsync(page);
        if (captured is not null)
        {
            DocaCredentials = captured;
        }

        var message = _settings.AutoSolveCaptcha
            ? $"DOCA auto-login failed after {_settings.CaptchaMaxAttempts} AI captcha attempt(s). Worker will keep retrying; check DOCA email/password if this persists."
            : $"DOCA login required — complete login, then {retryHint}.";

        return new DocaOpenResult(DocaSessionState.LoginRequired, message);
    }

    private async Task<bool> IsLoginPageAsync(IPage page)
    {
        var url = page.Url;
        if (url.Contains("/login", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var captcha = page.Locator("input[placeholder*='Captcha' i], input[name*='captcha' i]");
        if (await captcha.CountAsync() > 0)
        {
            return true;
        }

        var loginButton = page.GetByRole(AriaRole.Button, new() { Name = "Login Now" });
        return await loginButton.CountAsync() > 0;
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

        var emailField = page.Locator("input[type='email'], input[name*='email' i], input[id*='email' i]").First;
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
