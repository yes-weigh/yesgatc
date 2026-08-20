using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

internal sealed class WorkerPresenceService
{
    public const string Collection = "emaapEnginePresence";
    public static readonly TimeSpan LiveTtl = TimeSpan.FromSeconds(90);

    private readonly FirestoreDocumentClient _documents;

    public WorkerPresenceService(FirebaseSettings settings)
    {
        _documents = new FirestoreDocumentClient(settings);
    }

    public async Task HeartbeatAsync(
        FirebaseSignInResult session,
        string idToken,
        string statusMessage,
        CancellationToken cancellationToken = default)
    {
        var workerId = CertificateWorkerIdentity.WorkerId(session);
        var fields = new Dictionary<string, object?>
        {
            ["kind"] = CertificateWorkerIdentity.Kind(session),
            ["rcId"] = CertificateWorkerIdentity.IsEmaapEngine(session) ? session.UserId : string.Empty,
            ["rcName"] = session.DisplayName,
            ["ownerUid"] = session.UserId,
            ["machineName"] = Environment.MachineName,
            ["workerVersion"] = typeof(WorkerPresenceService).Assembly.GetName().Version?.ToString() ?? "unknown",
            ["statusMessage"] = statusMessage.Length > 400 ? statusMessage[..400] : statusMessage,
            ["lastHeartbeatAt"] = DateTimeOffset.UtcNow,
        };

        try
        {
            await _documents.PatchFieldsAsync(Collection, workerId, fields, idToken, cancellationToken);
        }
        catch (InvalidOperationException)
        {
            await _documents.CreateDocumentWithIdAsync(
                Collection,
                workerId,
                fields,
                idToken,
                cancellationToken);
        }
    }

    public async Task ClearAsync(FirebaseSignInResult session, CancellationToken cancellationToken = default)
    {
        try
        {
            await _documents.DeleteDocumentAsync(
                Collection,
                CertificateWorkerIdentity.WorkerId(session),
                session.IdToken,
                cancellationToken);
        }
        catch
        {
            // Best-effort.
        }
    }

    public async Task<bool> AnyLiveEmaapEngineAsync(
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var rows = await _documents.ListCollectionAsync(Collection, idToken, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        foreach (var (_, fields) in rows)
        {
            var kind = FirestoreFieldReader.ReadString(fields, "kind");
            if (!string.Equals(kind, CertificateWorkerIdentity.KindEmaapEngine, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var beat = FirestoreFieldReader.ReadTimestamp(fields, "lastHeartbeatAt");
            if (beat is { } at && now - at < LiveTtl)
            {
                return true;
            }
        }

        return false;
    }
}
