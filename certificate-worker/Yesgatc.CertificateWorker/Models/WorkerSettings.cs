namespace Yesgatc.CertificateWorker.Models;

public sealed class WorkerSettings
{
    public FirebaseSettings Firebase { get; init; } = new();
    public AutomationSettings Automation { get; init; } = new();
    public AutoWorkerSettings AutoWorker { get; init; } = new();
    public CredentialSettings Credentials { get; init; } = new();
}

public sealed class AutoWorkerSettings
{
    /// <summary>When true, the worker polls Firebase and processes jobs without manual clicks.</summary>
    public bool Enabled { get; init; } = true;
    /// <summary>
    /// When true, subscribe to Firestore snapshot listeners (onSnapshot-style) instead of polling.
    /// </summary>
    public bool UseRealtimeListener { get; init; } = true;
    /// <summary>Restart the Firestore listener before the auth token expires (minutes).</summary>
    public int ListenerTokenRefreshMinutes { get; init; } = 45;
    /// <summary>Fallback poll interval when UseRealtimeListener is false (seconds).</summary>
    public int PollIntervalSeconds { get; init; } = 5;
    /// <summary>Wait time before retrying a failed job (seconds).</summary>
    public int RetryDelaySeconds { get; init; } = 15;
    /// <summary>
    /// Max retries for approved jobs (Phase 2 signed PDF upload to DOCA / Firebase).
    /// Submitted jobs (Phase 1) retry without this cap. Firebase status stays approved during retries.
    /// </summary>
    public int MaxPostApprovalRetries { get; init; } = 3;
    /// <summary>How often to refresh retry countdown badges in the queue (seconds).</summary>
    public int RetryBadgeRefreshSeconds { get; init; } = 15;
    /// <summary>When true, skip the confirmation dialog for Process all jobs.</summary>
    public bool SkipBatchConfirmation { get; init; } = true;
    /// <summary>When waiting for DOCA captcha/login, probe this often (seconds).</summary>
    public int DocaLoginProbeSeconds { get; init; } = 30;
    /// <summary>
    /// While logged in and idle, navigate to a protected DOCA page this often (minutes) to detect silent logout.
    /// Set to 0 to disable.
    /// </summary>
    public int DocaSessionProbeMinutes { get; init; } = 10;
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
    public string DocaGatcUploadCertificateUrl { get; init; } = "https://doca.gov.in/user/view-gn-uploadcertificate";
    public DocaScrapeSettings DocaScrape { get; init; } = new();
    public DocaEnrichSettings DocaEnrich { get; init; } = new();
    /// <summary>Optional override. Default: %LOCALAPPDATA%\YesGATC\CertificateWorker\doca-browser</summary>
    public string BrowserProfilePath { get; init; } = string.Empty;
    /// <summary>Use installed browser instead of Playwright Chromium. Leave empty for default.</summary>
    public string BrowserChannel { get; init; } = string.Empty;
    /// <summary>When pending job count exceeds this, batch processing uses multiple browser windows.</summary>
    public int ParallelBrowserThreshold { get; init; } = 40;
    /// <summary>Number of parallel Chrome windows for large batches.</summary>
    public int ParallelBrowserCount { get; init; } = 4;
    /// <summary>Max machine photo size for DOCA create-ic-verification form (bytes).</summary>
    public long DocaUploadImageMaxBytes { get; init; } = 350 * 1024;
    /// <summary>Longest edge in pixels for machine photos uploaded to DOCA.</summary>
    public int DocaUploadImageMaxEdgePx { get; init; } = 1600;
    /// <summary>OCR the DOCA login captcha and submit the form automatically.</summary>
    public bool AutoSolveCaptcha { get; init; } = true;
    /// <summary>Captcha OCR + login retries before pausing for manual login.</summary>
    public int CaptchaMaxAttempts { get; init; } = 5;
    public CaptchaOcrSettings CaptchaOcr { get; init; } = new();
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

/// <summary>Captcha OCR — local Tesseract or OpenAI-compatible vision API.</summary>
public sealed class CaptchaOcrSettings
{
    /// <summary>OpenAI (vision API) or Tesseract (local).</summary>
    public string Provider { get; init; } = "OpenAI";

    /// <summary>API key for OpenAI or any OpenAI-compatible endpoint. Env: OPENAI_API_KEY.</summary>
    public string ApiKey { get; init; } = string.Empty;

    /// <summary>Chat model with vision support, e.g. gpt-4o.</summary>
    public string Model { get; init; } = "gpt-4o";

    /// <summary>Default OpenAI. Set to https://openrouter.ai/api/v1 for OpenRouter, etc.</summary>
    public string ApiBaseUrl { get; init; } = "https://api.openai.com/v1";

    /// <summary>If the AI provider fails or returns garbage, retry with local Tesseract.</summary>
    public bool FallbackToTesseract { get; init; } = true;

    /// <summary>Run Tesseract alongside AI and merge — fixes S/5-style single-char mistakes.</summary>
    public bool CombineWithTesseract { get; init; } = true;
}

public sealed class CredentialSettings
{
    public string Aadhar { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}

public sealed class DocaScrapeSettings
{
    /// <summary>
    /// When false, the worker never opens Chrome 2 (GATC list scraper). Certification uses Chrome 1 only.
    /// </summary>
    public bool Enabled { get; init; }
    public int PageSize { get; init; } = 100;
    public int DelayBetweenRowsMs { get; init; } = 400;
    public int DelayBetweenPagesMs { get; init; } = 1200;
}

public sealed class DocaEnrichSettings
{
    public int DelayBetweenDocsMs { get; init; } = 300;
}
