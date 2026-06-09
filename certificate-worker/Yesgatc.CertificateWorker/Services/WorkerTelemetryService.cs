using System.Text.Json;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class WorkerTelemetryService
{
    private const string StatusCollection = "automationWorker";
    private const string StatusDocId = "status";
    private const string RemoteDocId = "remote";
    private const string LogsCollection = "automationWorkerLogs";
    private const string CaptchaCollection = "automationWorkerCaptchaAttempts";
    private const string SessionsCollection = "automationWorkerSessions";

    private readonly FirebaseSettings _settings;
    private readonly FirestoreDocumentClient _documents;
    private readonly FirebaseStorageUploadService _storage;
    private readonly SemaphoreSlim _syncLock = new(1, 1);

    private int _lastAppliedCommandRevision;
    private int _lastAppliedCredentialsRevision;
    private DateTimeOffset? _docaLoggedInAt;
    private DateTimeOffset? _lastSessionProbeAt;
    private string _lastSessionProbeResult = string.Empty;
    private int _jobsCompletedSession;
    private int _jobsFailedSession;
    private string? _lastActivityMessage;
    private DateTimeOffset _startedAt = DateTimeOffset.UtcNow;

    public WorkerTelemetryService(FirebaseSettings settings)
    {
        _settings = settings;
        _documents = new FirestoreDocumentClient(settings);
        _storage = new FirebaseStorageUploadService(settings);
    }

    public int JobsCompletedSession => _jobsCompletedSession;
    public int JobsFailedSession => _jobsFailedSession;

    public void RecordJobCompleted() => Interlocked.Increment(ref _jobsCompletedSession);

    public void RecordJobFailed() => Interlocked.Increment(ref _jobsFailedSession);

    public void MarkDocaLoggedIn()
    {
        _docaLoggedInAt = DateTimeOffset.UtcNow;
    }

    public DateTimeOffset? DocaLoggedInAt => _docaLoggedInAt;

    public DateTimeOffset? LastSessionProbeAt => _lastSessionProbeAt;

    public string LastSessionProbeResult => _lastSessionProbeResult;

    public void RecordSessionProbe(string result)
    {
        _lastSessionProbeAt = DateTimeOffset.UtcNow;
        _lastSessionProbeResult = result;
    }

    public async Task MarkDocaLoggedOutAsync(
        Func<Task<string>> resolveIdToken,
        string logoutReason = "unknown",
        CancellationToken cancellationToken = default)
    {
        if (_docaLoggedInAt is null)
        {
            return;
        }

        var loggedInAt = _docaLoggedInAt.Value;
        var loggedOutAt = DateTimeOffset.UtcNow;
        var durationSeconds = (int)Math.Max(0, (loggedOutAt - loggedInAt).TotalSeconds);
        _docaLoggedInAt = null;

        try
        {
            var idToken = await resolveIdToken();
            await _documents.CreateDocumentAsync(
                SessionsCollection,
                new Dictionary<string, object?>
                {
                    ["loggedInAt"] = loggedInAt.ToString("O"),
                    ["loggedOutAt"] = loggedOutAt.ToString("O"),
                    ["durationSeconds"] = durationSeconds,
                    ["logoutReason"] = logoutReason,
                    ["machineName"] = Environment.MachineName,
                },
                idToken,
                cancellationToken);
        }
        catch
        {
            // Telemetry must not break the worker.
        }
    }

    public Action<string>? LogDiagnostic { get; set; }

    public async Task ReportCaptchaAttemptAsync(
        CaptchaAttemptReport report,
        Func<Task<string>> resolveIdToken,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var idToken = await resolveIdToken();
            string imageUrl = string.Empty;
            string imagePath = string.Empty;

            if (report.ImageBytes.Length > 0)
            {
                try
                {
                    var storagePath =
                        $"automationWorker/captcha/{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_{Guid.NewGuid():N}.png";
                    var upload = await _storage.UploadImageBytesAsync(
                        storagePath,
                        report.ImageBytes,
                        "image/png",
                        idToken,
                        cancellationToken);
                    imageUrl = upload.DownloadUrl;
                    imagePath = upload.StoragePath;
                }
                catch (Exception ex)
                {
                    LogDiagnostic?.Invoke(
                        $"Captcha image upload failed (attempt {report.AttemptNumber}): {ex.Message}");
                }
            }

            await _documents.CreateDocumentAsync(
                CaptchaCollection,
                new Dictionary<string, object?>
                {
                    ["createdAt"] = DateTimeOffset.UtcNow.ToString("O"),
                    ["resolvedText"] = report.ResolvedText,
                    ["ocrProvider"] = report.OcrProvider,
                    ["attemptNumber"] = report.AttemptNumber,
                    ["success"] = report.Success,
                    ["outcome"] = report.Outcome,
                    ["imageUrl"] = imageUrl,
                    ["imagePath"] = imagePath,
                    ["machineName"] = Environment.MachineName,
                },
                idToken,
                cancellationToken);
        }
        catch (Exception ex)
        {
            LogDiagnostic?.Invoke(
                $"Captcha telemetry write failed (attempt {report.AttemptNumber}, {report.Outcome}): {ex.Message}");
        }
    }

    public async Task ReportActivityAsync(
        string message,
        string level,
        Func<Task<string>> resolveIdToken,
        CancellationToken cancellationToken = default)
    {
        if (string.Equals(_lastActivityMessage, message, StringComparison.Ordinal))
        {
            return;
        }

        _lastActivityMessage = message;

        try
        {
            var idToken = await resolveIdToken();
            await _documents.CreateDocumentAsync(
                LogsCollection,
                new Dictionary<string, object?>
                {
                    ["createdAt"] = DateTimeOffset.UtcNow.ToString("O"),
                    ["message"] = message.Length > 500 ? message[..500] : message,
                    ["level"] = level,
                    ["category"] = "activity",
                    ["machineName"] = Environment.MachineName,
                },
                idToken,
                cancellationToken);
        }
        catch
        {
            // Ignore logging failures.
        }
    }

    public async Task PublishStatusAsync(
        WorkerStatusSnapshot snapshot,
        Func<Task<string>> resolveIdToken,
        CancellationToken cancellationToken = default)
    {
        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            var idToken = await resolveIdToken();
            await _documents.PatchFieldsAsync(
                StatusCollection,
                StatusDocId,
                new Dictionary<string, object?>
                {
                    ["lastHeartbeatAt"] = DateTimeOffset.UtcNow.ToString("O"),
                    ["startedAt"] = _startedAt.ToString("O"),
                    ["machineName"] = Environment.MachineName,
                    ["workerVersion"] = typeof(WorkerTelemetryService).Assembly.GetName().Version?.ToString() ?? "unknown",
                    ["state"] = snapshot.State,
                    ["statusMessage"] = snapshot.StatusMessage.Length > 500
                        ? snapshot.StatusMessage[..500]
                        : snapshot.StatusMessage,
                    ["autoWorkerEnabled"] = snapshot.AutoWorkerEnabled,
                    ["remotePaused"] = snapshot.RemotePaused,
                    ["docaFillOnly"] = snapshot.DocaFillOnly,
                    ["docaSessionState"] = snapshot.DocaSessionState,
                    ["queueTotal"] = snapshot.QueueTotal,
                    ["queueEligible"] = snapshot.QueueEligible,
                    ["queueSubmitted"] = snapshot.QueueSubmitted,
                    ["queueApproved"] = snapshot.QueueApproved,
                    ["jobsCompletedSession"] = snapshot.JobsCompletedSession,
                    ["jobsFailedSession"] = snapshot.JobsFailedSession,
                    ["docaLoggedInAt"] = _docaLoggedInAt?.ToString("O") ?? string.Empty,
                    ["docaSessionAgeSeconds"] = snapshot.DocaSessionAgeSeconds,
                    ["lastSessionProbeAt"] = snapshot.LastSessionProbeAt,
                    ["lastSessionProbeResult"] = snapshot.LastSessionProbeResult,
                },
                idToken,
                cancellationToken);
        }
        catch (Exception ex)
        {
            LogDiagnostic?.Invoke($"Worker status heartbeat failed: {ex.Message}");
        }
        finally
        {
            _syncLock.Release();
        }
    }

    public async Task<WorkerRemoteControlState?> PollRemoteControlAsync(
        Func<Task<string>> resolveIdToken,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var idToken = await resolveIdToken();
            var fields = await _documents.TryGetFieldsAsync(StatusCollection, RemoteDocId, idToken, cancellationToken);
            if (fields.Count == 0)
            {
                return null;
            }

            return new WorkerRemoteControlState
            {
                CommandRevision = FirestoreDocumentClient.ReadInt(fields, "commandRevision"),
                CredentialsRevision = FirestoreDocumentClient.ReadInt(fields, "credentialsRevision"),
                AutoWorkerEnabled = fields.ContainsKey("autoWorkerEnabled")
                    ? FirestoreDocumentClient.ReadBool(fields, "autoWorkerEnabled")
                    : null,
                DocaFillOnly = fields.ContainsKey("docaFillOnly")
                    ? FirestoreDocumentClient.ReadBool(fields, "docaFillOnly")
                    : null,
                PauseWorker = FirestoreDocumentClient.ReadBool(fields, "pauseWorker"),
                SuperAdminAadhar = FirestoreDocumentClient.ReadString(fields, "superAdminAadhar"),
                SuperAdminPassword = FirestoreDocumentClient.ReadString(fields, "superAdminPassword"),
                DocaEmail = FirestoreDocumentClient.ReadString(fields, "docaEmail"),
                DocaPassword = FirestoreDocumentClient.ReadString(fields, "docaPassword"),
                CaptchaApiKey = FirestoreDocumentClient.ReadString(fields, "captchaApiKey"),
            };
        }
        catch
        {
            return null;
        }
    }

    public bool ShouldApplyCommand(WorkerRemoteControlState remote) =>
        remote.CommandRevision > _lastAppliedCommandRevision;

    public bool ShouldApplyCredentials(WorkerRemoteControlState remote) =>
        remote.CredentialsRevision > _lastAppliedCredentialsRevision;

    public void MarkCommandApplied(int revision) => _lastAppliedCommandRevision = revision;

    public void MarkCredentialsApplied(int revision) => _lastAppliedCredentialsRevision = revision;

    public async Task ClearAppliedCredentialsAsync(
        int credentialsRevision,
        Func<Task<string>> resolveIdToken,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var idToken = await resolveIdToken();
            await _documents.PatchFieldsAsync(
                StatusCollection,
                RemoteDocId,
                new Dictionary<string, object?>
                {
                    ["superAdminPassword"] = string.Empty,
                    ["docaPassword"] = string.Empty,
                    ["captchaApiKey"] = string.Empty,
                    ["credentialsAppliedAt"] = DateTimeOffset.UtcNow.ToString("O"),
                    ["credentialsAppliedRevision"] = credentialsRevision,
                },
                idToken,
                cancellationToken);
        }
        catch
        {
            // Non-fatal.
        }
    }
}
