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
    private IPlaywright? _playwright;
    private IBrowserContext? _context;

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
        await ResetContextIfDisconnectedAsync();
        await EnsureContextAsync(cancellationToken);
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
            if (!ManualDocaLoginWait)
            {
                await TryPrefillLoginAsync(page);
            }

            await page.BringToFrontAsync();
            return DocaSessionState.LoginRequired;
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

        var duplicateCheck = await DocaViewVerificationService.CheckExistingBySerialAsync(
            page,
            _settings.DocaViewIcVerificationUrl,
            serial,
            cancellationToken);

        if (await IsLoginPageAsync(page))
        {
            if (!ManualDocaLoginWait)
            {
                await TryPrefillLoginAsync(page);
            }

            await page.BringToFrontAsync();

            var capturedLogin = await CaptureDocaCredentialsFromBrowserAsync(page);
            if (capturedLogin is not null)
            {
                DocaCredentials = capturedLogin;
            }

            return new DocaOpenResult(
                DocaSessionState.LoginRequired,
                "DOCA login required — complete login, then run automation again.");
        }

        if (duplicateCheck.Exists && duplicateCheck.Match is not null)
        {
            var existing = duplicateCheck.Match;
            var details = new List<string> { $"Serial {existing.SerialNumber}" };
            if (!string.IsNullOrWhiteSpace(existing.ApplicationNumber))
            {
                details.Add($"Application {existing.ApplicationNumber}");
            }

            if (!string.IsNullOrWhiteSpace(existing.CertificateNumber))
            {
                details.Add($"Certificate {existing.CertificateNumber}");
            }

            return new DocaOpenResult(
                DocaSessionState.LoggedIn,
                $"Duplicate blocked — serial {serial} already exists on DOCA View IC Verification. " +
                "Skipped create IC verification to prevent a duplicate application. " +
                string.Join(" · ", details),
                DuplicateOnDoca: true);
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
            if (!ManualDocaLoginWait)
            {
                await TryPrefillLoginAsync(page);
            }

            await page.BringToFrontAsync();

            var captured = await CaptureDocaCredentialsFromBrowserAsync(page);
            if (captured is not null)
            {
                DocaCredentials = captured;
            }

            return new DocaOpenResult(
                DocaSessionState.LoginRequired,
                "DOCA login required — complete login, then run automation again.");
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
            if (!ManualDocaLoginWait)
            {
                await TryPrefillLoginAsync(page);
            }

            await page.BringToFrontAsync();

            var captured = await CaptureDocaCredentialsFromBrowserAsync(page);
            if (captured is not null)
            {
                DocaCredentials = captured;
            }

            return new DocaOpenResult(
                DocaSessionState.LoginRequired,
                "DOCA login required — complete login, then run certification again.");
        }

        var downloadDirectory = WorkerDataPaths.CertificatePdfDirectory(job.Id);
        var downloadResult = await DocaViewVerificationService.FindDetailsAndDownloadPdfAsync(
            page,
            _settings.DocaViewIcVerificationUrl,
            job.SerialNumber,
            downloadDirectory,
            cancellationToken);

        var stampResult = CertificatePdfStampService.StampPrincipalOfficerSignature(
            downloadResult.LocalPdfPath,
            _settings.CertificateStamp);

        var imageDownload = new FirebaseStorageDownloadService();
        var instrumentPhoto = await imageDownload.DownloadStampingImageAsync(
            job.Id,
            instrument.SerialNumber,
            instrument.StampingImageUrl,
            instrument.StampingImageName,
            instrument.StampingImageContentType,
            cancellationToken);

        var preparedPhoto = DocaUploadImagePreparer.PrepareMachinePhotoForUpload(
            instrumentPhoto.LocalPath,
            Path.GetDirectoryName(instrumentPhoto.LocalPath)!,
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

        return new DocaOpenResult(
            DocaSessionState.LoggedIn,
            $"Certificate uploaded to DOCA, saved to Firebase Storage, and marked certified — {string.Join(" · ", details)}. " +
            $"Signed PDF: {stampResult.OutputPath}. Instrument photo: {preparedPhoto.Summary}.",
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

        await page.GotoAsync(_settings.DocaHomeUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load,
            Timeout = 60_000,
        });

        try
        {
            await page.EvaluateAsync(
                "document.title = " + System.Text.Json.JsonSerializer.Serialize($"YesGATC Chrome {chromeNumber} — DOCA"));
        }
        catch (PlaywrightException)
        {
            // Title tweak is optional; navigation is enough for login verification.
        }

        if (await IsLoginPageAsync(page))
        {
            if (!ManualDocaLoginWait)
            {
                await TryPrefillLoginAsync(page);
            }

            await page.BringToFrontAsync();
            return DocaSessionState.LoginRequired;
        }

        await page.BringToFrontAsync();
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
        if (_context is not null)
        {
            await _context.CloseAsync();
            _context = null;
        }

        _playwright?.Dispose();
        _playwright = null;
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

    private async Task EnsureContextAsync(CancellationToken cancellationToken)
    {
        _playwright ??= await Playwright.CreateAsync();

        if (_context is not null && IsBrowserConnected)
        {
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
        };

        if (!string.IsNullOrWhiteSpace(_settings.BrowserChannel))
        {
            launchOptions.Channel = _settings.BrowserChannel.Trim();
        }

        try
        {
            _context = await _playwright.Chromium.LaunchPersistentContextAsync(
                BrowserProfileDirectory,
                launchOptions);
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

        return _context.Pages.FirstOrDefault() ?? await _context.NewPageAsync();
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
        page ??= _context?.Pages.FirstOrDefault();
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

    private async Task TryPrefillLoginAsync(IPage page)
    {
        if (ManualDocaLoginWait)
        {
            return;
        }

        var email = DocaCredentials.Email.Trim();
        var password = DocaCredentials.Password;

        if (string.IsNullOrWhiteSpace(email) && string.IsNullOrWhiteSpace(password))
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(email))
        {
            var emailField = page.Locator("input[type='email'], input[name*='email' i], input[id*='email' i]").First;
            if (await emailField.CountAsync() > 0)
            {
                await emailField.FillAsync(email);
            }
        }

        if (!string.IsNullOrWhiteSpace(password))
        {
            var passwordField = page.Locator("input[type='password']").First;
            if (await passwordField.CountAsync() > 0)
            {
                await passwordField.FillAsync(password);
            }
        }
    }
}
