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
    public bool Enabled { get; init; } = false;
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
    /// Max retries for the single production stage: Submitted → eMAAP fill+certify.
    /// After this, worker stops and marks pipelineFailedPhase=submit. Status stays submitted.
    /// </summary>
    public int MaxSubmitRetries { get; init; } = 3;
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
    public string DocaLoginUrl { get; init; } = "https://emaap.gov.in/gatc/login";
    /// <summary>Checked first — if session is still valid, portal redirects away from login.</summary>
    public string DocaHomeUrl { get; init; } = "https://emaap.gov.in/gatc/dashboard";
    /// <summary>Optional override. Default: %LOCALAPPDATA%\YesGATC\CertificateWorker\doca-browser</summary>
    public string BrowserProfilePath { get; init; } = string.Empty;
    /// <summary>
    /// When true, seed a YesGATC Chrome mirror from your Chrome profile (cookies/DeepSeek login).
    /// Chrome blocks automating the real Default profile directly (stays on about:blank).
    /// Close Chrome once to sync; after that the worker uses the mirror.
    /// </summary>
    public bool UseSystemChromeProfile { get; init; }
    /// <summary>Chrome profile folder under User Data, e.g. Default or Profile 1.</summary>
    public string ChromeProfileDirectory { get; init; } = "Default";
    /// <summary>Force a full re-copy of the Chrome profile into the worker mirror on next launch.</summary>
    public bool ResyncChromeProfile { get; init; }
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
    /// <summary>Poll Firebase emaapOtpInbox after Send OTP (webhook / Apps Script).</summary>
    public bool EmaapOtpUseFirestore { get; init; } = true;
    /// <summary>Seconds to wait for a Firestore OTP before falling back / idle.</summary>
    public int EmaapOtpPollSeconds { get; init; } = 180;
    /// <summary>Legacy Gmail tab scrape — off by default (Google blocks automation).</summary>
    public bool EmaapOtpUseGmailFallback { get; init; }
    /// <summary>Try this OTP first after Send OTP; on failure fall back to Firebase inbox.</summary>
    public string EmaapMasterOtp { get; init; } = string.Empty;
    public CaptchaOcrSettings CaptchaOcr { get; init; } = new();
    public DocaCredentialSettings DocaCredentials { get; init; } = new();
}

public sealed class DocaCredentialSettings
{
    public string Email { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}

/// <summary>Captcha OCR — DeepSeek chat (default), Gemini, OpenAI, or local Tesseract.</summary>
public sealed class CaptchaOcrSettings
{
    /// <summary>DeepSeek | Gemini | OpenAI | Tesseract.</summary>
    public string Provider { get; init; } = "DeepSeek";

    /// <summary>API key for Gemini/OpenAI. DeepSeek uses browser login (no key).</summary>
    public string ApiKey { get; init; } = string.Empty;

    /// <summary>Vision model for Gemini/OpenAI. Ignored for DeepSeek chat.</summary>
    public string Model { get; init; } = string.Empty;

    /// <summary>API base (Gemini/OpenAI) or chat URL hint (DeepSeek).</summary>
    public string ApiBaseUrl { get; init; } = "https://chat.deepseek.com/";

    /// <summary>If the AI provider fails or returns garbage, retry with local Tesseract.</summary>
    public bool FallbackToTesseract { get; init; }

    /// <summary>OpenAI only: merge with Tesseract. Ignored for case-sensitive eMAAP captchas.</summary>
    public bool CombineWithTesseract { get; init; }
}

public sealed class CredentialSettings
{
    public string Aadhar { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
}
