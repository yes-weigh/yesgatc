using System.IO;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public enum DocaSessionState
{
    LoggedIn,
    LoginRequired,
}

public sealed record DocaOpenResult(DocaSessionState State, string Message, bool VerificationApproved = false);

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

    public bool IsRunning => _context is not null;

    public string BrowserProfileDirectory =>
        string.IsNullOrWhiteSpace(_settings.BrowserProfilePath)
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "YesGATC",
                "CertificateWorker",
                "doca-browser")
            : Environment.ExpandEnvironmentVariables(_settings.BrowserProfilePath);

    public DocaCredentialSettings DocaCredentials { get; set; } = new();

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

        await EnsureContextAsync(cancellationToken);
        var page = await GetPageAsync();

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
            await TryPrefillLoginAsync(page);
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

        await DocaFormFiller.FillMachinePhotoSectionAsync(page, instrument, stampingImage.LocalPath);
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
            $"{firebaseNote} Stamping plate: {stampingImage.LocalPath} ({sizeKb} KB).",
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

        await EnsureContextAsync(cancellationToken);
        var page = await GetPageAsync();

        await page.GotoAsync(_settings.DocaViewIcVerificationUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load,
            Timeout = 60_000,
        });

        if (await IsLoginPageAsync(page))
        {
            await TryPrefillLoginAsync(page);
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

        await DocaViewVerificationService.UploadStampedCertificateAsync(
            page,
            _settings.DocaViewIcVerificationUrl,
            job.SerialNumber,
            stampResult.OutputPath,
            instrumentPhoto.LocalPath,
            instrument.Remarks,
            cancellationToken);

        var match = downloadResult.Match;
        await _firestoreService.MarkCertifiedWithSignedPdfAsync(
            job.Id,
            stampResult.OutputPath,
            firebaseIdToken,
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
            $"Signed PDF: {stampResult.OutputPath}. Instrument photo: {instrumentPhoto.LocalPath}.",
            VerificationApproved: true);
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

    private async Task EnsureContextAsync(CancellationToken cancellationToken)
    {
        _playwright ??= await Playwright.CreateAsync();

        if (_context is not null)
        {
            return;
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
