namespace Yesgatc.CertificateWorker.Models;

public sealed class WorkerRemoteControlState
{
    public int CommandRevision { get; init; }
    public int CredentialsRevision { get; init; }
    public bool? AutoWorkerEnabled { get; init; }
    public bool? DocaFillOnly { get; init; }
    public bool PauseWorker { get; init; }
    public string? SuperAdminAadhar { get; init; }
    public string? SuperAdminPassword { get; init; }
    public string? DocaEmail { get; init; }
    public string? DocaPassword { get; init; }
    public string? CaptchaApiKey { get; init; }
    public int ScrapeCommandRevision { get; init; }
    public bool ScrapePause { get; init; }
}

public sealed class WorkerStatusSnapshot
{
    public string State { get; init; } = "idle";
    public string StatusMessage { get; init; } = string.Empty;
    public bool AutoWorkerEnabled { get; init; }
    public bool RemotePaused { get; init; }
    public bool DocaFillOnly { get; init; }
    public string DocaSessionState { get; init; } = "unknown";
    public int QueueTotal { get; init; }
    public int QueueEligible { get; init; }
    public int QueueSubmitted { get; init; }
    public int QueueApproved { get; init; }
    public int JobsCompletedSession { get; init; }
    public int JobsFailedSession { get; init; }
    public string LastSessionProbeAt { get; init; } = string.Empty;
    public string LastSessionProbeResult { get; init; } = string.Empty;
    public int DocaSessionAgeSeconds { get; init; }
}
