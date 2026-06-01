using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Firestore real-time listener (same idea as web onSnapshot) for the certification queue.
/// </summary>
public sealed class FirestoreQueueListener : IAsyncDisposable
{
    private readonly FirebaseSettings _settings;
    private readonly int _tokenRefreshMinutes;
    private readonly object _gate = new();
    private readonly Dictionary<string, SiteCalibrationRecord> _submitted = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SiteCalibrationRecord> _approved = new(StringComparer.Ordinal);

    private FirestoreDb? _db;
    private FirestoreChangeListener? _submittedListener;
    private FirestoreChangeListener? _approvedListener;
    private Dictionary<string, string> _rcNames = new(StringComparer.Ordinal);
    private CancellationTokenSource? _debounceCts;
    private CancellationTokenSource? _lifetimeCts;
    private Task? _tokenRefreshTask;

    public FirestoreQueueListener(FirebaseSettings settings, int tokenRefreshMinutes = 45)
    {
        _settings = settings;
        _tokenRefreshMinutes = Math.Max(15, tokenRefreshMinutes);
    }

    public Func<Task<string>>? ResolveIdToken { get; set; }

    public event Action<IReadOnlyList<SiteCalibrationRecord>>? QueueUpdated;

    public event Action<string>? ListenerError;

    public bool IsRunning { get; private set; }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        await StopAsync();
        if (ResolveIdToken is null)
        {
            throw new InvalidOperationException("ResolveIdToken must be set before starting the listener.");
        }

        _lifetimeCts = new CancellationTokenSource();
        await ConnectAsync(cancellationToken);
        _tokenRefreshTask = RunTokenRefreshLoopAsync(_lifetimeCts.Token);
        IsRunning = true;
    }

    public async Task StopAsync()
    {
        IsRunning = false;
        if (_lifetimeCts is not null)
        {
            await _lifetimeCts.CancelAsync();
            _lifetimeCts.Dispose();
            _lifetimeCts = null;
        }

        if (_tokenRefreshTask is not null)
        {
            try
            {
                await _tokenRefreshTask;
            }
            catch (OperationCanceledException)
            {
            }

            _tokenRefreshTask = null;
        }

        await StopListenersAsync();
        lock (_gate)
        {
            _submitted.Clear();
            _approved.Clear();
        }

        CancelDebounce();
    }

    public async ValueTask DisposeAsync() => await StopAsync();

    private async Task ConnectAsync(CancellationToken cancellationToken)
    {
        await StopListenersAsync();

        var idToken = await ResolveIdToken!();
        var credential = GoogleCredential.FromAccessToken(idToken);
        var builder = new FirestoreDbBuilder
        {
            ProjectId = _settings.ProjectId,
            Credential = credential,
        };
        _db = await builder.BuildAsync(cancellationToken);

        _rcNames = await LoadRcCenterNamesAsync(_db, cancellationToken);

        lock (_gate)
        {
            _submitted.Clear();
            _approved.Clear();
        }

        var submittedQuery = _db.Collection("siteCalibrations")
            .WhereEqualTo("status", VerificationStatuses.Submitted);
        var approvedQuery = _db.Collection("siteCalibrations")
            .WhereEqualTo("status", VerificationStatuses.Approved);

        _submittedListener = submittedQuery.Listen((snapshot, _) =>
        {
            HandleSnapshot(snapshot, _submitted);
            return Task.CompletedTask;
        });
        _approvedListener = approvedQuery.Listen((snapshot, _) =>
        {
            HandleSnapshot(snapshot, _approved);
            return Task.CompletedTask;
        });
    }

    private async Task RunTokenRefreshLoopAsync(CancellationToken cancellationToken)
    {
        var refreshMinutes = _tokenRefreshMinutes;
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(refreshMinutes));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                try
                {
                    await ConnectAsync(cancellationToken);
                    ScheduleQueueNotify();
                }
                catch (Exception ex)
                {
                    ListenerError?.Invoke($"Firestore listener refresh failed — {ex.Message}");
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void HandleSnapshot(QuerySnapshot snapshot, Dictionary<string, SiteCalibrationRecord> bucket)
    {
        Dictionary<string, string> rcNames;
        lock (_gate)
        {
            rcNames = new Dictionary<string, string>(_rcNames, StringComparer.Ordinal);
        }

        lock (_gate)
        {
            foreach (var change in snapshot.Changes)
            {
                var id = change.Document.Id;
                switch (change.ChangeType)
                {
                    case DocumentChange.Type.Added:
                    case DocumentChange.Type.Modified:
                        bucket[id] = SiteCalibrationMapper.FromSnapshot(change.Document, rcNames);
                        break;
                    case DocumentChange.Type.Removed:
                        bucket.Remove(id);
                        break;
                }
            }
        }

        ScheduleQueueNotify();
    }

    private void ScheduleQueueNotify()
    {
        CancelDebounce();
        _debounceCts = new CancellationTokenSource();
        var token = _debounceCts.Token;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(250, token);
                var merged = BuildMergedQueue();
                QueueUpdated?.Invoke(merged);
            }
            catch (OperationCanceledException)
            {
            }
        }, token);
    }

    private void CancelDebounce()
    {
        if (_debounceCts is null)
        {
            return;
        }

        _debounceCts.Cancel();
        _debounceCts.Dispose();
        _debounceCts = null;
    }

    private IReadOnlyList<SiteCalibrationRecord> BuildMergedQueue()
    {
        lock (_gate)
        {
            return _submitted.Values
                .Concat(_approved.Values)
                .OrderBy(record => record.IsSubmitted ? 0 : 1)
                .ThenByDescending(record => record.IsSubmitted
                    ? record.SubmittedAt ?? record.Id
                    : record.ApprovedAt ?? record.SubmittedAt ?? record.Id)
                .ToList();
        }
    }

    private static async Task<Dictionary<string, string>> LoadRcCenterNamesAsync(
        FirestoreDb db,
        CancellationToken cancellationToken)
    {
        var snapshot = await db.Collection("users")
            .WhereEqualTo("role", "rc_admin")
            .GetSnapshotAsync(cancellationToken);

        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var document in snapshot.Documents)
        {
            document.TryGetValue<string>("companyName", out var companyName);
            document.TryGetValue<string>("username", out var username);
            var label = FirstNonEmpty(companyName, username, document.Id);
            names[document.Id] = label;
        }

        return names;
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }

    private async Task StopListenersAsync()
    {
        if (_submittedListener is not null)
        {
            await _submittedListener.StopAsync(CancellationToken.None);
            _submittedListener = null;
        }

        if (_approvedListener is not null)
        {
            await _approvedListener.StopAsync(CancellationToken.None);
            _approvedListener = null;
        }

        _db = null;
    }
}
