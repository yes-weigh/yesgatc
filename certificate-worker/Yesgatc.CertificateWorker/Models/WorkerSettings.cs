namespace Yesgatc.CertificateWorker.Models;

public sealed class WorkerSettings
{
    public FirebaseSettings Firebase { get; init; } = new();
    public AutomationSettings Automation { get; init; } = new();
    public CredentialSettings Credentials { get; init; } = new();
}

public sealed class FirebaseSettings
{
    public string ProjectId { get; init; } = "yesgatc";
    public string ApiKey { get; init; } = string.Empty;
    public string AuthEmailDomain { get; init; } = "yesgatc.auth";
    public string StorageBucket { get; init; } = "yesgatc.firebasestorage.app";
}

public sealed class AutomationSettings
{
    public string DocaLoginUrl { get; init; } = "https://doca.gov.in/user/login";
    /// <summary>Checked first — if session is still valid, DOCA redirects away from login.</summary>
    public string DocaHomeUrl { get; init; } = "https://doca.gov.in/user/dashboard";
    public string DocaCreateIcVerificationUrl { get; init; } = "https://doca.gov.in/user/create-ic-verification";
    public string DocaViewIcVerificationUrl { get; init; } = "https://doca.gov.in/user/view-ic-verification";
    /// <summary>Optional override. Default: %LOCALAPPDATA%\YesGATC\CertificateWorker\doca-browser</summary>
    public string BrowserProfilePath { get; init; } = string.Empty;
    /// <summary>Use installed browser instead of Playwright Chromium. Leave empty for default.</summary>
    public string BrowserChannel { get; init; } = string.Empty;
    /// <summary>When pending job count exceeds this, batch processing uses multiple browser windows.</summary>
    public int ParallelBrowserThreshold { get; init; } = 40;
    /// <summary>Number of parallel Chrome windows for large batches.</summary>
    public int ParallelBrowserCount { get; init; } = 4;
    /// <summary>Max machine photo size sent to DOCA after compression (bytes).</summary>
    public long DocaUploadImageMaxBytes { get; init; } = 350 * 1024;
    /// <summary>Longest edge in pixels for machine photos uploaded to DOCA.</summary>
    public int DocaUploadImageMaxEdgePx { get; init; } = 1600;
    public DocaCredentialSettings DocaCredentials { get; init; } = new();
    public CertificateStampSettings CertificateStamp { get; init; } = new();
}

public sealed class CertificateStampSettings
{
    public string PrincipalOfficerName { get; init; } = "HARISH RAMANKUTTY";
    public string TimeZoneId { get; init; } = "India Standard Time";
    public string TimeZoneOffsetLabel { get; init; } = "+05'30'";
    public double NameFontSize { get; init; } = 11;
    public double DetailFontSize { get; init; } = 7.5;
    /// <summary>Inset from the drawable page right edge to the stamp block right edge, in PDF points.</summary>
    public double RightMargin { get; init; } = 14;
    /// <summary>Move stamp left (negative) or right (positive) in PDF points.</summary>
    public double OffsetX { get; init; } = 0;
    /// <summary>Move stamp up (negative) or down (positive) in PDF points.</summary>
    public double OffsetY { get; init; } = 14;
    /// <summary>Gap between stamp block and the Signature of Principal Officer line.</summary>
    public double GapAboveSignatureLabel { get; init; } = 14;
    /// <summary>Move the large left name down (positive) or up (negative) in PDF points.</summary>
    public double NameOffsetY { get; init; } = 4;
    public string WatermarkPath { get; init; } = "adobelogo.png";
    public double WatermarkHeight { get; init; } = 42;
    public double WatermarkOpacity { get; init; } = 0.32;
    /// <summary>Move watermark up (negative) or down (positive) in PDF points.</summary>
    public double WatermarkOffsetY { get; init; } = -5;
}

public sealed class DocaCredentialSettings
{
    public string Email { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}

public sealed class CredentialSettings
{
    public string Aadhar { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}
