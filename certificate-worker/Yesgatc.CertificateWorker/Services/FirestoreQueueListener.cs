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
    private readonly Dictionary<string, SiteCalibrationRecord> _signedUploads = new(StringComparer.Ordinal);
    private readonly Dictionary<string, SiteCalibrationRecord> _certified = new(StringComparer.Ordinal);

    private FirestoreDb? _db;
    private FirestoreChangeListener? _submittedListener;
    private FirestoreChangeListener? _signedUploadListener;
    private FirestoreChangeListener? _certifiedListener;
    private FirestoreChangeListener? _usersListener;
    private Dictionary<string, string> _rcNames = new(StringComparer.Ordinal);
    private HashSet<string> _pdfSignerRcIds = new(StringComparer.Ordinal);
    private CancellationTokenSource? _debounceCts;
    private CancellationTokenSource? _lifetimeCts;
    private Task? _tokenRefreshTask;

    public FirestoreQueueListener(FirebaseSettings settings, int tokenRefreshMinutes = 45)
    {
        _settings = settings;
        _tokenRefreshMinutes = Math.Max(15, tokenRefreshMinutes);
    }

    public Func<Task<string>>? ResolveIdToken { get; set; }

    /// <summary>RC emaapengine scopes the snapshot query to this centre.</summary>
    public string? ScopeRcId { get; set; }

    public event Action<IReadOnlyList<SiteCalibrationRecord>>? QueueUpdated;

    public event Action<IReadOnlyList<SiteCalibrationRecord>>? SignedUploadQueueUpdated;

    public event Action<IReadOnlyList<SiteCalibrationRecord>>? PdfSignerQueueUpdated;

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
            _signedUploads.Clear();
            _certified.Clear();
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

        var directory = await LoadRcDirectoryAsync(_db, ScopeRcId, cancellationToken);
        lock (_gate)
        {
            _rcNames = directory.Names;
            _pdfSignerRcIds = directory.PdfSignerRcIds;
            _submitted.Clear();
            _signedUploads.Clear();
            _certified.Clear();
        }

        Query submittedQuery = _db.Collection("siteCalibrations")
            .WhereEqualTo("status", VerificationStatuses.Submitted);
        if (!string.IsNullOrWhiteSpace(ScopeRcId))
        {
            submittedQuery = submittedQuery.WhereEqualTo("rcId", ScopeRcId);
        }

        _submittedListener = submittedQuery.Listen((snapshot, _) =>
        {
            HandleSnapshot(snapshot, _submitted);
            return Task.CompletedTask;
        });

        if (WorkerProduct.IsEmaapEngineBuild)
        {
            return;
        }

        Query usersQuery = _db.Collection("users").WhereEqualTo("role", "rc_admin");
        _usersListener = usersQuery.Listen((snapshot, _) =>
        {
            HandleUsersSnapshot(snapshot);
            return Task.CompletedTask;
        });

        Query signedQuery = _db.Collection("siteCalibrations")
            .WhereNotEqualTo("signedCertificatePdfUrl", "");
        if (!string.IsNullOrWhiteSpace(ScopeRcId))
        {
            signedQuery = signedQuery.WhereEqualTo("rcId", ScopeRcId);
        }

        _signedUploadListener = signedQuery.Listen((snapshot, _) =>
        {
            HandleSnapshot(snapshot, _signedUploads);
            return Task.CompletedTask;
        });

        Query certifiedQuery = _db.Collection("siteCalibrations")
            .WhereEqualTo("status", VerificationStatuses.Certified);
        if (!string.IsNullOrWhiteSpace(ScopeRcId))
        {
            certifiedQuery = certifiedQuery.WhereEqualTo("rcId", ScopeRcId);
        }

        _certifiedListener = certifiedQuery.Listen((snapshot, _) =>
        {
            HandleSnapshot(snapshot, _certified);
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

    private void HandleUsersSnapshot(QuerySnapshot snapshot)
    {
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        var pdfSignerRcIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var document in snapshot.Documents)
        {
            AddRcDocument(document, names, pdfSignerRcIds);
        }

        lock (_gate)
        {
            _rcNames = names;
            _pdfSignerRcIds = pdfSignerRcIds;
        }

        ScheduleQueueNotify();
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
                QueueUpdated?.Invoke(BuildGenerateQueue());
                SignedUploadQueueUpdated?.Invoke(BuildSignedUploadQueue());
                PdfSignerQueueUpdated?.Invoke(BuildPdfSignerQueue());
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

    private IReadOnlyList<SiteCalibrationRecord> BuildGenerateQueue()
    {
        lock (_gate)
        {
            return CertificationQueueFilter.Apply(_submitted.Values, ScopeRcId);
        }
    }

    private IReadOnlyList<SiteCalibrationRecord> BuildSignedUploadQueue()
    {
        lock (_gate)
        {
            return EmaapSignedPdfUploadFilter.Apply(_signedUploads.Values, ScopeRcId);
        }
    }

    private IReadOnlyList<SiteCalibrationRecord> BuildPdfSignerQueue()
    {
        lock (_gate)
        {
            return PdfSignerQueueFilter.Apply(_certified.Values, _pdfSignerRcIds, ScopeRcId);
        }
    }

    private sealed record RcDirectory(
        Dictionary<string, string> Names,
        HashSet<string> PdfSignerRcIds);

    private static async Task<RcDirectory> LoadRcDirectoryAsync(
        FirestoreDb db,
        string? scopeRcId,
        CancellationToken cancellationToken)
    {
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        var pdfSignerRcIds = new HashSet<string>(StringComparer.Ordinal);
        if (!string.IsNullOrWhiteSpace(scopeRcId))
        {
            var document = await db.Collection("users").Document(scopeRcId).GetSnapshotAsync(cancellationToken);
            if (document.Exists)
            {
                AddRcDocument(document, names, pdfSignerRcIds);
            }

            return new RcDirectory(names, pdfSignerRcIds);
        }

        try
        {
            var snapshot = await db.Collection("users")
                .WhereEqualTo("role", "rc_admin")
                .GetSnapshotAsync(cancellationToken);

            foreach (var document in snapshot.Documents)
            {
                AddRcDocument(document, names, pdfSignerRcIds);
            }
        }
        catch (Exception)
        {
            return new RcDirectory(names, pdfSignerRcIds);
        }

        return new RcDirectory(names, pdfSignerRcIds);
    }

    private static void AddRcDocument(
        DocumentSnapshot document,
        Dictionary<string, string> names,
        HashSet<string> pdfSignerRcIds)
    {
        document.TryGetValue<string>("companyName", out var companyName);
        document.TryGetValue<string>("username", out var username);
        document.TryGetValue<string>("certificationMethod", out var method);
        names[document.Id] = FirstNonEmpty(companyName, username, document.Id);
        if (RcCertificationMethods.IsPdfSigner(method))
        {
            pdfSignerRcIds.Add(document.Id);
        }
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

        if (_signedUploadListener is not null)
        {
            await _signedUploadListener.StopAsync(CancellationToken.None);
            _signedUploadListener = null;
        }

        if (_certifiedListener is not null)
        {
            await _certifiedListener.StopAsync(CancellationToken.None);
            _certifiedListener = null;
        }

        if (_usersListener is not null)
        {
            await _usersListener.StopAsync(CancellationToken.None);
            _usersListener = null;
        }

        _db = null;
    }
}
