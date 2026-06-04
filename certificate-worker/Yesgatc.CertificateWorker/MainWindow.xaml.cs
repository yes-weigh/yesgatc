using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;

namespace Yesgatc.CertificateWorker;

public partial class MainWindow : Window
{
    private enum StatusKind
    {
        Idle,
        Info,
        Working,
        Success,
        Error,
    }

    private sealed record JobPipelineResult(
        bool Completed,
        bool LoginRequired,
        string Message,
        bool BrowserDisconnected = false);

    private sealed class ParallelBatchStats
    {
        public int Completed;
        public int Failed;
        public int LoginRequiredWorkers;
        public string? LastError;
    }

    private readonly ObservableCollection<CertificationQueueItem> _jobs = [];
    private readonly ObservableCollection<string> _activityLog = [];
    private readonly FirebaseAuthService _authService;
    private readonly FirestoreService _firestoreService;
    private readonly FirestoreQueueListener _queueListener;
    private readonly PartyDetailsService _partyDetailsService;
    private readonly InstrumentDetailsService _instrumentDetailsService;
    private readonly AutomationService _automationService;
    private readonly LocalCredentialsStore _credentialStore = new();
    private readonly JobRetryTracker _jobRetries = new();
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private readonly List<AutomationService> _preparedBulkWorkers = [];

    private FirebaseSignInResult? _session;
    private CertificationQueueItem? _selectedQueueItem;
    private bool _isBusy;
    private bool _autoWorkerEnabled;
    private bool _autoWorkerPausedForDoca;
    private bool _useRealtimeListener;
    private bool _realtimeListenerActive;
    private DispatcherTimer? _pollFallbackTimer;
    private DispatcherTimer? _retryBadgeTimer;
    private DispatcherTimer? _docaProbeTimer;
    private bool _autoWorkerCyclePending;

    public MainWindow()
    {
        InitializeComponent();

        var settings = App.Settings;
        _authService = new FirebaseAuthService(settings.Firebase);
        _firestoreService = new FirestoreService(settings.Firebase);
        _queueListener = new FirestoreQueueListener(
            settings.Firebase,
            settings.AutoWorker.ListenerTokenRefreshMinutes);
        _queueListener.ResolveIdToken = () => GetFreshIdTokenAsync();
        _queueListener.QueueUpdated += OnQueueListenerUpdated;
        _queueListener.ListenerError += OnQueueListenerError;
        _useRealtimeListener = settings.AutoWorker.UseRealtimeListener;
        _partyDetailsService = new PartyDetailsService(settings.Firebase);
        _instrumentDetailsService = new InstrumentDetailsService(settings.Firebase);
        _automationService = new AutomationService(settings.Automation, _firestoreService);
        _automationService.ResolveFirebaseIdToken = GetFreshIdTokenAsync;
        App.AutomationService = _automationService;

        JobsGrid.ItemsSource = _jobs;
        ActivityLogList.ItemsSource = _activityLog;
        LoadSavedCredentials(settings);
        ConfigureAutoWorkerFromSettings();

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private SiteCalibrationRecord? SelectedJob => _selectedQueueItem?.Record;

    private void SetSelectedQueueItem(CertificationQueueItem? item) => _selectedQueueItem = item;

    private void LoadSavedCredentials(WorkerSettings settings)
    {
        var saved = _credentialStore.Load();

        AadharBox.Text = FirstNonEmpty(
            saved.SuperAdmin.Aadhar,
            settings.Credentials.Aadhar);
        PasswordBox.Text = FirstNonEmpty(
            saved.SuperAdmin.Password,
            settings.Credentials.Password);
        DocaEmailBox.Text = FirstNonEmpty(
            saved.Doca.Email,
            settings.Automation.DocaCredentials.Email);
        DocaPasswordBox.Text = FirstNonEmpty(
            saved.Doca.Password,
            settings.Automation.DocaCredentials.Password);

        // Load captcha API key: saved store wins, then appsettings, then env var.
        var captchaKey = FirstNonEmpty(
            saved.CaptchaApiKey,
            FirstNonEmpty(
                settings.Automation.CaptchaOcr.ApiKey,
                Environment.GetEnvironmentVariable("OPENAI_API_KEY") ?? string.Empty));
        CaptchaApiKeyBox.Text = captchaKey;
        OpenAiCaptchaOcr.RuntimeApiKeyOverride = string.IsNullOrWhiteSpace(captchaKey) ? null : captchaKey;
        UpdateCaptchaApiKeyHint();

        _automationService.DocaCredentials = CurrentDocaCredentials();
        UpdateSignInSummary();
    }

    private static string FirstNonEmpty(string primary, string fallback) =>
        string.IsNullOrWhiteSpace(primary) ? fallback : primary;

    private DocaCredentialSettings CurrentDocaCredentials() => new()
    {
        Email = DocaEmailBox.Text.Trim(),
        Password = DocaPasswordBox.Text,
    };

    private void PersistCredentials()
    {
        _credentialStore.SaveAll(
            AadharBox.Text,
            PasswordBox.Text,
            DocaEmailBox.Text,
            DocaPasswordBox.Text,
            CaptchaApiKeyBox.Text);
    }

    /// <summary>
    /// Shows the last 6 characters of the active key (e.g. "…8GcA") so the user
    /// can confirm which key is in use without exposing the full secret.
    /// </summary>
    private void UpdateCaptchaApiKeyHint()
    {
        var active = OpenAiCaptchaOcr.ResolveApiKey(App.Settings.Automation.CaptchaOcr);
        if (string.IsNullOrWhiteSpace(active))
        {
            CaptchaApiKeyHint.Text = "not set";
            return;
        }

        var tail = active.Length > 6 ? active[^6..] : active;
        CaptchaApiKeyHint.Text = $"active: …{tail}";
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await StartDocaBrowserAsync();

        if (!string.IsNullOrWhiteSpace(AadharBox.Text) && !string.IsNullOrWhiteSpace(PasswordBox.Text))
        {
            await SignInAndLoadAsync();
            return;
        }

        SignInExpander.IsExpanded = true;
        SetStatus(
            _automationService.IsBrowserConnected
                ? "DOCA browser is open. Enter Super Admin credentials and sign in."
                : "Enter Super Admin credentials and sign in to load the queue.",
            StatusKind.Idle);
    }

    private async Task StartDocaBrowserAsync()
    {
        try
        {
            _automationService.DocaCredentials = CurrentDocaCredentials();
            SetStatus("Opening DOCA browser...", StatusKind.Working);
            var state = await _automationService.OpenDocaWorkspaceAsync();

            if (state == DocaSessionState.LoginRequired)
            {
                if (_autoWorkerEnabled)
                {
                    SetDocaLoginPaused(true);
                }

                SetStatus("DOCA auto-login failed — worker will retry with AI captcha. Check DOCA email/password in the app.", StatusKind.Info);
                return;
            }

            SetStatus("DOCA browser open and logged in to DOCA.", StatusKind.Success);
        }
        catch (Exception ex)
        {
            SetStatus($"Could not open DOCA browser: {ex.Message}", StatusKind.Error);
        }
    }

    private async void MainWindow_Closed(object? sender, EventArgs e)
    {
        StopAutoWorkerTimers();
        await _queueListener.StopAsync();
        await DisposePreparedBulkWorkersAsync();
        await _automationService.DisposeAsync();
        _tokenLock.Dispose();
    }

    private void ConfigureAutoWorkerFromSettings()
    {
        var settings = App.Settings.AutoWorker;
        _autoWorkerEnabled = settings.Enabled;
        _useRealtimeListener = settings.UseRealtimeListener;
        UpdateAutoWorkerStatusText();
    }

    private async Task StartQueueListenerAsync()
    {
        if (_session is null || !_useRealtimeListener)
        {
            return;
        }

        try
        {
            await _queueListener.StartAsync();
            _realtimeListenerActive = true;
            SetStatus("Watching Firestore for queue changes in real time.", StatusKind.Info);
        }
        catch (Exception ex)
        {
            _realtimeListenerActive = false;
            SetStatus(
                $"Real-time listener unavailable ({ex.Message}). Falling back to polling every {App.Settings.AutoWorker.PollIntervalSeconds}s.",
                StatusKind.Error);
            StartPollFallbackTimer();
        }
    }

    private async Task StopQueueListenerAsync()
    {
        _realtimeListenerActive = false;
        await _queueListener.StopAsync();
    }

    private void OnQueueListenerUpdated(IReadOnlyList<SiteCalibrationRecord> records)
    {
        _ = Dispatcher.InvokeAsync(async () =>
        {
            ApplyQueueRecords(records, "Queue updated from Firestore.");
            if (!_autoWorkerEnabled || _autoWorkerPausedForDoca)
            {
                return;
            }

            if (_isBusy)
            {
                _autoWorkerCyclePending = true;
                return;
            }

            await RunAutoWorkerCycleAsync();
        });
    }

    private void OnQueueListenerError(string message)
    {
        _ = Dispatcher.InvokeAsync(() => SetStatus(message, StatusKind.Info));
    }

    private void StartAutoWorkerTimers()
    {
        StopAutoWorkerTimers();

        if (!_autoWorkerEnabled || _session is null)
        {
            return;
        }

        if (!_useRealtimeListener || !_realtimeListenerActive)
        {
            StartPollFallbackTimer();
        }

        StartRetryBadgeTimer();
        UpdateAutoWorkerStatusText();
    }

    private void StartPollFallbackTimer()
    {
        if (_pollFallbackTimer is not null)
        {
            return;
        }

        var settings = App.Settings.AutoWorker;
        _pollFallbackTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(Math.Max(1, settings.PollIntervalSeconds)),
        };
        _pollFallbackTimer.Tick += PollFallbackTimer_Tick;
        _pollFallbackTimer.Start();
    }

    private void StartRetryBadgeTimer()
    {
        if (_retryBadgeTimer is not null)
        {
            return;
        }

        var settings = App.Settings.AutoWorker;
        _retryBadgeTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(Math.Max(5, settings.RetryBadgeRefreshSeconds)),
        };
        _retryBadgeTimer.Tick += RetryBadgeTimer_Tick;
        _retryBadgeTimer.Start();
    }

    private void StopAutoWorkerTimers()
    {
        if (_pollFallbackTimer is not null)
        {
            _pollFallbackTimer.Tick -= PollFallbackTimer_Tick;
            _pollFallbackTimer.Stop();
            _pollFallbackTimer = null;
        }

        if (_retryBadgeTimer is not null)
        {
            _retryBadgeTimer.Tick -= RetryBadgeTimer_Tick;
            _retryBadgeTimer.Stop();
            _retryBadgeTimer = null;
        }

        StopDocaProbeTimer();
    }

    private void SetDocaLoginPaused(bool paused)
    {
        _autoWorkerPausedForDoca = paused;
        ApplyManualDocaLoginWaitToAllAutomation(paused);

        if (paused)
        {
            StartDocaProbeTimer();
        }
        else
        {
            StopDocaProbeTimer();
        }

        UpdateAutoWorkerStatusText();
    }

    private void ApplyManualDocaLoginWaitToAllAutomation(bool paused)
    {
        _automationService.ManualDocaLoginWait = paused;
        foreach (var worker in _preparedBulkWorkers)
        {
            worker.ManualDocaLoginWait = paused;
        }
    }

    private void StartDocaProbeTimer()
    {
        if (_docaProbeTimer is not null)
        {
            return;
        }

        var seconds = Math.Max(15, App.Settings.AutoWorker.DocaLoginProbeSeconds);
        _docaProbeTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(seconds),
        };
        _docaProbeTimer.Tick += DocaProbeTimer_Tick;
        _docaProbeTimer.Start();
    }

    private void StopDocaProbeTimer()
    {
        if (_docaProbeTimer is null)
        {
            return;
        }

        _docaProbeTimer.Tick -= DocaProbeTimer_Tick;
        _docaProbeTimer.Stop();
        _docaProbeTimer = null;
    }

    private async void DocaProbeTimer_Tick(object? sender, EventArgs e)
    {
        if (!_autoWorkerPausedForDoca || _session is null)
        {
            return;
        }

        await TryResumeAutoWorkerAfterDocaLoginAsync();
    }

    private async void PollFallbackTimer_Tick(object? sender, EventArgs e)
    {
        if (!_autoWorkerEnabled || _session is null)
        {
            return;
        }

        if (_autoWorkerPausedForDoca)
        {
            await TryResumeAutoWorkerAfterDocaLoginAsync();
            return;
        }

        if (_isBusy)
        {
            return;
        }

        await LoadQueueAsync();
        await RunAutoWorkerCycleAsync();
    }

    private async void RetryBadgeTimer_Tick(object? sender, EventArgs e)
    {
        RefreshRetryBadges();

        if (!_autoWorkerEnabled || _session is null || _isBusy || _autoWorkerPausedForDoca)
        {
            return;
        }

        await RunAutoWorkerCycleAsync();
    }

    private async Task TryResumeAutoWorkerAfterDocaLoginAsync()
    {
        try
        {
            var state = await _automationService.ProbeDocaSessionAsync();
            if (state != DocaSessionState.LoggedIn)
            {
                UpdateAutoWorkerStatusText();
                return;
            }

            SetDocaLoginPaused(false);
            SetStatus("DOCA session restored — auto worker resuming.", StatusKind.Success);
            UpdateAutoWorkerStatusText();
            await RunAutoWorkerCycleAsync();
        }
        catch (Exception ex)
        {
            SetStatus($"Waiting for DOCA auto-login — {ex.Message}", StatusKind.Info);
            UpdateAutoWorkerStatusText();
        }
    }

    private async Task RunAutoWorkerCycleAsync()
    {
        if (!_autoWorkerEnabled || _session is null || _autoWorkerPausedForDoca)
        {
            return;
        }

        if (_isBusy)
        {
            _autoWorkerCyclePending = true;
            return;
        }

        if (!_realtimeListenerActive)
        {
            await LoadQueueAsync();
        }

        var queue = _jobs
            .Where(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id))
            .Select(item => item.Record)
            .ToList();

        if (queue.Count == 0)
        {
            UpdateAutoWorkerStatusText();
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            SetStatus($"Auto worker — processing {queue.Count} eligible job(s)…", StatusKind.Working);
            await ProcessQueueInternalAsync(queue, sequentialOnly: true, fromAutoWorker: true);
            UpdateAutoWorkerStatusText();
        });
    }

    private void RefreshRetryBadges()
    {
        foreach (var item in _jobs)
        {
            item.RetryBadge = _jobRetries.BadgeFor(item.Id);
        }

        JobsGrid.Items.Refresh();
        UpdateAutoWorkerStatusText();
    }

    private void UpdateAutoWorkerStatusText()
    {
        if (!_autoWorkerEnabled)
        {
            AutoWorkerStatusText.Text = "Disabled in appsettings.json.";
            return;
        }

        if (_session is null)
        {
            AutoWorkerStatusText.Text = "Sign in to start unattended processing.";
            return;
        }

        if (_autoWorkerPausedForDoca)
        {
            AutoWorkerStatusText.Text =
                "Paused for DOCA login — retrying AI auto-login every few seconds until session is restored.";
            return;
        }

        var waitingRetries = _jobRetries.Snapshot().Count(pair => DateTimeOffset.Now < pair.Value.RetryAt);
        var eligible = _jobs.Count(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id));
        var watchMode = _realtimeListenerActive
            ? "watching Firestore live"
            : $"polling every {App.Settings.AutoWorker.PollIntervalSeconds}s";
        AutoWorkerStatusText.Text = waitingRetries > 0
            ? $"Running — {eligible} job(s) ready, {waitingRetries} waiting for retry ({watchMode})."
            : $"Running — {watchMode} · {eligible} job(s) ready.";
    }

    private async void SignInButton_Click(object sender, RoutedEventArgs e)
    {
        await SignInAndLoadAsync();
    }

    private void SaveCredsButton_Click(object sender, RoutedEventArgs e)
    {
        PersistCredentials();
        _automationService.DocaCredentials = CurrentDocaCredentials();

        // Apply captcha key immediately so auto-login uses it without restart.
        var apiKey = CaptchaApiKeyBox.Text.Trim();
        OpenAiCaptchaOcr.RuntimeApiKeyOverride = string.IsNullOrWhiteSpace(apiKey) ? null : apiKey;
        UpdateCaptchaApiKeyHint();

        SetStatus("Credentials saved locally.", StatusKind.Success);
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first to refresh.", StatusKind.Info);
            SignInExpander.IsExpanded = true;
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            SetStatus("Refreshing queue…", StatusKind.Working);
            await LoadQueueAsync();
        });
    }

    private async Task HandleJobPipelineResultAsync(
        SiteCalibrationRecord job,
        int jobIndex,
        JobPipelineResult result,
        bool fromAutoWorker)
    {
        if (result.LoginRequired)
        {
            if (fromAutoWorker || _autoWorkerEnabled)
            {
                SetDocaLoginPaused(true);
            }

            SetStatus(result.Message, StatusKind.Error);
            return;
        }

        if (result.BrowserDisconnected)
        {
            SetStatus(result.Message, StatusKind.Info);
            if (fromAutoWorker || _autoWorkerEnabled)
            {
                _jobRetries.Schedule(
                    job.Id,
                    result.Message,
                    TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
                RefreshRetryBadges();
            }

            await LoadQueueAsync();
            SelectJobById(job.Id);
            return;
        }

        if (result.Completed)
        {
            _jobRetries.Clear(job.Id);
            SetStatus(result.Message, StatusKind.Success);
            await LoadQueueAsync();
            SelectJobAtIndexAfterRemoval(jobIndex);
            return;
        }

        _jobRetries.Schedule(
            job.Id,
            result.Message,
            TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
        RefreshRetryBadges();
        SetStatus(result.Message, StatusKind.Info);
        await LoadQueueAsync();
        SelectJobById(job.Id);
    }

    private async Task<JobPipelineResult> ProcessJobWithRecoveryAsync(
        SiteCalibrationRecord job,
        AutomationService automation,
        bool continueBrowserSession)
    {
        try
        {
            await automation.EnsureBrowserReadyAsync();

            var sessionGate = await automation.EnsureDocaSessionForJobAsync();
            if (sessionGate is not null)
            {
                return new JobPipelineResult(false, true, sessionGate.Message);
            }

            return await ProcessJobThroughPipelineAsync(job, automation, continueBrowserSession);
        }
        catch (Exception ex) when (AutomationService.IsBrowserDisconnectedError(ex))
        {
            try
            {
                await automation.EnsureBrowserReadyAsync();
            }
            catch
            {
                // Fall through with a friendly retry message.
            }

            return new JobPipelineResult(
                false,
                false,
                "DOCA browser was closed or disconnected. Reopening Chrome on the next attempt.",
                BrowserDisconnected: true);
        }
    }

    private async Task ProcessQueueInternalAsync(
        IReadOnlyList<SiteCalibrationRecord> queue,
        bool sequentialOnly,
        bool fromAutoWorker)
    {
        var settings = App.Settings.Automation;
        var useParallel = !sequentialOnly
            && queue.Count > settings.ParallelBrowserThreshold
            && settings.ParallelBrowserCount > 1;

        if (useParallel)
        {
            await ProcessAllJobsInParallelAsync(queue, settings.ParallelBrowserCount, fromAutoWorker);
        }
        else
        {
            await ProcessAllJobsSequentiallyAsync(queue, fromAutoWorker);
        }
    }

    private async Task ProcessAllJobsSequentiallyAsync(IReadOnlyList<SiteCalibrationRecord> queue, bool fromAutoWorker)
    {
        var completed = 0;
        var failed = 0;
        string? lastError = null;
        var continueSession = _automationService.IsBrowserConnected;

        for (var i = 0; i < queue.Count; i++)
        {
            var job = queue[i];
            var batchLabel = $"Job {i + 1} of {queue.Count}";

            SelectJobOnUiThread(job.Id);
            SetStatusSafe($"{batchLabel} · Serial {job.SerialNumber} ({job.NextStepLabel})…", StatusKind.Working);

            try
            {
                var result = await ProcessJobWithRecoveryAsync(
                    job,
                    _automationService,
                    continueBrowserSession: continueSession || i > 0);

                continueSession = _automationService.IsBrowserConnected;

                if (TryHandleSequentialJobResult(
                        job,
                        i,
                        result,
                        fromAutoWorker,
                        batchLabel,
                        ref completed,
                        ref failed,
                        ref lastError,
                        out var stopBatch))
                {
                    if (stopBatch)
                    {
                        await LoadQueueAsync();
                        ReportBatchSummary(queue.Count, completed, failed, lastError, loginStopped: result.LoginRequired);
                        return;
                    }
                }
            }
            catch (Exception ex)
            {
                failed++;
                lastError = ex.Message;
                _jobRetries.Schedule(
                    job.Id,
                    ex.Message,
                    TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
                RefreshRetryBadges();
                SetStatusSafe($"{batchLabel} failed · {ex.Message}", StatusKind.Error);

                if (AutomationService.IsBrowserDisconnectedError(ex))
                {
                    SetStatusSafe(
                        $"{batchLabel} — browser disconnected. Stopping batch; will retry on the next auto-worker cycle.",
                        StatusKind.Info);
                    await LoadQueueAsync();
                    ReportBatchSummary(queue.Count, completed, failed, lastError, loginStopped: false);
                    return;
                }
            }
        }

        await LoadQueueAsync();
        ReportBatchSummary(queue.Count, completed, failed, lastError, loginStopped: false);
    }

    private bool TryHandleSequentialJobResult(
        SiteCalibrationRecord job,
        int jobIndex,
        JobPipelineResult result,
        bool fromAutoWorker,
        string batchLabel,
        ref int completed,
        ref int failed,
        ref string? lastError,
        out bool stopBatch)
    {
        stopBatch = false;

        if (result.LoginRequired)
        {
            if (fromAutoWorker || _autoWorkerEnabled)
            {
                SetDocaLoginPaused(true);
            }

            lastError = result.Message;
            SetStatusSafe(
                $"{batchLabel} paused — DOCA auto-login required. Worker will retry until logged in.",
                StatusKind.Error);
            stopBatch = true;
            return true;
        }

        if (result.BrowserDisconnected)
        {
            failed++;
            lastError = result.Message;
            _jobRetries.Schedule(
                job.Id,
                result.Message,
                TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
            RefreshRetryBadges();
            SetStatusSafe(
                $"{batchLabel} — browser disconnected. Stopping batch; Chrome will reopen on the next cycle.",
                StatusKind.Info);
            stopBatch = true;
            return true;
        }

        if (result.Completed)
        {
            completed++;
            _jobRetries.Clear(job.Id);
            SetStatusSafe($"{batchLabel} · {result.Message}", StatusKind.Success);
            return true;
        }

        failed++;
        lastError = result.Message;
        _jobRetries.Schedule(
            job.Id,
            result.Message,
            TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
        RefreshRetryBadges();
        SetStatusSafe($"{batchLabel} · {result.Message}", StatusKind.Info);
        return true;
    }

    private async Task ProcessAllJobsInParallelAsync(
        IReadOnlyList<SiteCalibrationRecord> queue,
        int parallelBrowserCount,
        bool fromAutoWorker)
    {
        var workerCount = Math.Min(parallelBrowserCount, queue.Count);
        var buckets = Enumerable.Range(0, workerCount)
            .Select(_ => new List<SiteCalibrationRecord>())
            .ToList();

        for (var i = 0; i < queue.Count; i++)
        {
            buckets[i % workerCount].Add(queue[i]);
        }

        SetStatusSafe(
            $"Starting {workerCount} Chrome windows for {queue.Count} jobs…",
            StatusKind.Working);

        var stats = new ParallelBatchStats();
        var (workers, keepBrowsersOpen) = await AcquireBulkWorkersAsync(workerCount);
        var workerTasks = new List<Task>();

        for (var workerIndex = 0; workerIndex < workerCount; workerIndex++)
        {
            var workerJobs = buckets[workerIndex];
            if (workerJobs.Count == 0)
            {
                continue;
            }

            workerTasks.Add(ProcessWorkerQueueAsync(
                workers[workerIndex],
                workerJobs,
                workerIndex,
                workerCount,
                stats,
                keepBrowsersOpen));
        }

        await Task.WhenAll(workerTasks);
        await LoadQueueAsync();
        ReportBatchSummary(
            queue.Count,
            stats.Completed,
            stats.Failed,
            stats.LastError,
            loginStopped: stats.LoginRequiredWorkers > 0);
    }

    private async Task ProcessWorkerQueueAsync(
        AutomationService automation,
        IReadOnlyList<SiteCalibrationRecord> jobs,
        int workerIndex,
        int workerCount,
        ParallelBatchStats stats,
        bool keepBrowserOpen)
    {
        try
        {
            for (var i = 0; i < jobs.Count; i++)
            {
                var job = jobs[i];
                var label =
                    $"Chrome {workerIndex + 1}/{workerCount} · job {i + 1}/{jobs.Count} · serial {job.SerialNumber}";

                SelectJobOnUiThread(job.Id);
                SetStatusSafe($"{label} ({job.NextStepLabel})…", StatusKind.Working);

                try
                {
                    var result = await ProcessJobWithRecoveryAsync(
                        job,
                        automation,
                        continueBrowserSession: i > 0);

                    if (result.LoginRequired)
                    {
                        Interlocked.Increment(ref stats.LoginRequiredWorkers);
                        lock (stats)
                        {
                            stats.LastError = result.Message;
                        }
                        if (_autoWorkerEnabled)
                        {
                            SetDocaLoginPaused(true);
                        }

                        SetStatusSafe($"{label} — DOCA login required in Chrome {workerIndex + 1}.", StatusKind.Error);
                        return;
                    }

                    if (result.BrowserDisconnected)
                    {
                        Interlocked.Increment(ref stats.Failed);
                        _jobRetries.Schedule(
                            job.Id,
                            result.Message,
                            TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
                        lock (stats)
                        {
                            stats.LastError = result.Message;
                        }
                        RefreshRetryBadges();
                        SetStatusSafe(
                            $"{label} — browser disconnected. Stopping Chrome {workerIndex + 1}; will retry on the next cycle.",
                            StatusKind.Info);
                        return;
                    }

                    if (result.Completed)
                    {
                        Interlocked.Increment(ref stats.Completed);
                        _jobRetries.Clear(job.Id);
                        SetStatusSafe($"{label} · done", StatusKind.Success);
                    }
                    else
                    {
                        Interlocked.Increment(ref stats.Failed);
                        _jobRetries.Schedule(
                            job.Id,
                            result.Message,
                            TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
                        lock (stats)
                        {
                            stats.LastError = result.Message;
                        }
                        SetStatusSafe($"{label} · {result.Message}", StatusKind.Info);
                    }
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref stats.Failed);
                    _jobRetries.Schedule(
                        job.Id,
                        ex.Message,
                        TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
                    lock (stats)
                    {
                        stats.LastError = ex.Message;
                    }
                    RefreshRetryBadges();
                    SetStatusSafe($"{label} failed · {ex.Message}", StatusKind.Error);

                    if (AutomationService.IsBrowserDisconnectedError(ex))
                    {
                        SetStatusSafe(
                            $"{label} — browser disconnected. Stopping Chrome {workerIndex + 1}; will retry on the next cycle.",
                            StatusKind.Info);
                        return;
                    }
                }
            }
        }
        finally
        {
            if (!keepBrowserOpen)
            {
                await automation.DisposeAsync();
            }
        }
    }

    private async Task<(List<AutomationService> Workers, bool KeepBrowsersOpen)> AcquireBulkWorkersAsync(int workerCount)
    {
        _preparedBulkWorkers.RemoveAll(worker => !worker.IsBrowserConnected);

        if (_preparedBulkWorkers.Count >= workerCount
            && _preparedBulkWorkers.Take(workerCount).All(worker => worker.IsBrowserConnected))
        {
            for (var i = 0; i < workerCount; i++)
            {
                _preparedBulkWorkers[i].DocaCredentials = CurrentDocaCredentials();
                _preparedBulkWorkers[i].ResolveFirebaseIdToken = GetFreshIdTokenAsync;
                _preparedBulkWorkers[i].ManualDocaLoginWait = _autoWorkerPausedForDoca;
            }

            SetStatusSafe(
                $"Using {workerCount} prepared Chrome session(s) for parallel batch…",
                StatusKind.Info);
            return (_preparedBulkWorkers.Take(workerCount).ToList(), true);
        }

        var workers = new List<AutomationService>();
        for (var i = 0; i < workerCount; i++)
        {
            workers.Add(CreateAutomationWorker(i));
        }

        return (workers, false);
    }

    private async Task DisposePreparedBulkWorkersAsync()
    {
        foreach (var worker in _preparedBulkWorkers)
        {
            await worker.DisposeAsync();
        }

        _preparedBulkWorkers.Clear();
    }

    private AutomationService CreateAutomationWorker(int workerIndex)
    {
        var automation = new AutomationService(App.Settings.Automation, _firestoreService)
        {
            WorkerIndex = workerIndex,
            DocaCredentials = CurrentDocaCredentials(),
            ResolveFirebaseIdToken = GetFreshIdTokenAsync,
            ManualDocaLoginWait = _autoWorkerPausedForDoca,
        };
        return automation;
    }

    private void ReportBatchSummary(int total, int completed, int failed, string? lastError, bool loginStopped)
    {
        if (loginStopped)
        {
            SetStatusSafe(
                $"Batch paused — DOCA auto-login in progress. {completed} completed so far. {lastError}",
                StatusKind.Error);
            return;
        }

        if (completed == total)
        {
            SetStatusSafe($"Batch complete — {completed} job(s) certified.", StatusKind.Success);
        }
        else if (completed > 0)
        {
            SetStatusSafe($"Batch finished — {completed} completed, {failed} incomplete. {lastError}", StatusKind.Info);
        }
        else if (failed > 0)
        {
            SetStatusSafe($"Batch finished — all {failed} job(s) incomplete. {lastError}", StatusKind.Error);
        }
    }

    private void SetStatusSafe(string message, StatusKind kind)
    {
        if (Dispatcher.CheckAccess())
        {
            SetStatus(message, kind);
            return;
        }

        Dispatcher.Invoke(() => SetStatus(message, kind));
    }

    private void SelectJobOnUiThread(string jobId)
    {
        if (Dispatcher.CheckAccess())
        {
            SelectJobById(jobId);
            return;
        }

        Dispatcher.Invoke(() => SelectJobById(jobId));
    }

    private async Task<JobPipelineResult> ProcessJobThroughPipelineAsync(
        SiteCalibrationRecord job,
        AutomationService automation,
        bool continueBrowserSession)
    {
        if (_session is null)
        {
            throw new InvalidOperationException("Sign in as Super Admin first.");
        }

        if (!job.NeedsPipelineWork)
        {
            return new JobPipelineResult(false, false, "No pending pipeline steps for this job.");
        }

        automation.DocaCredentials = CurrentDocaCredentials();

        var current = job;
        var ranPhase1 = false;

        if (current.IsSubmitted)
        {
            SetStatusSafe($"Phase 1 · Checking DOCA and submitting serial {current.SerialNumber}…", StatusKind.Working);
            var submitResult = await SubmitJobToDocaAsync(current, automation, continueBrowserSession);

            if (submitResult.State == DocaSessionState.LoginRequired)
            {
                return new JobPipelineResult(false, true, submitResult.Message);
            }

            if (submitResult.DuplicateOnDoca)
            {
                var token = await GetFreshIdTokenAsync();
                await _firestoreService.ApproveVerificationAsync(current.Id, token);
                SetStatusSafe(
                    $"Serial {current.SerialNumber} already on DOCA — synced Firebase to approved, continuing to certify…",
                    StatusKind.Info);
            }
            else if (!submitResult.VerificationApproved)
            {
                return new JobPipelineResult(false, false, submitResult.Message);
            }

            ranPhase1 = true;
            current = await ReloadJobAsync(current.Id) ?? current;
        }

        if (current.NeedsCertificatePdfUpload && !current.IsReadyToCertify)
        {
            var pdfPath = WorkerDataPaths.FindLatestStampedPdf(current.Id);
            if (string.IsNullOrWhiteSpace(pdfPath))
            {
                return new JobPipelineResult(
                    false,
                    false,
                    $"Serial {current.SerialNumber} needs a Firebase PDF upload but no local stamped PDF was found.");
            }

            SetStatusSafe($"Uploading signed PDF to Firebase for serial {current.SerialNumber}…", StatusKind.Working);
            var token = await GetFreshIdTokenAsync();
            await _firestoreService.MarkCertifiedWithSignedPdfAsync(
                current.Id,
                pdfPath,
                token,
                cancellationToken: CancellationToken.None);

            return new JobPipelineResult(
                true,
                false,
                $"Serial {current.SerialNumber} — certificate PDF uploaded to Firebase.");
        }

        if (current.IsReadyToCertify)
        {
            var existingStampedPdf = WorkerDataPaths.FindLatestStampedPdf(current.Id);
            if (!string.IsNullOrWhiteSpace(existingStampedPdf))
            {
                SetStatusSafe(
                    $"Serial {current.SerialNumber} — local stamped PDF found, uploading to Firebase (skipping DOCA re-certify)…",
                    StatusKind.Working);
                var token = await GetFreshIdTokenAsync();
                await _firestoreService.MarkCertifiedWithSignedPdfAsync(
                    current.Id,
                    existingStampedPdf,
                    token,
                    cancellationToken: CancellationToken.None);

                return new JobPipelineResult(
                    true,
                    false,
                    $"Serial {current.SerialNumber} — recovered from saved stamped PDF and marked certified in Firebase.");
            }

            SetStatusSafe($"Phase 2 · Certifying serial {current.SerialNumber} on DOCA…", StatusKind.Working);
            var certifyResult = await CertifyJobAsync(
                current,
                automation,
                continueOnSamePage: ranPhase1 || continueBrowserSession);

            if (certifyResult.State == DocaSessionState.LoginRequired)
            {
                return new JobPipelineResult(false, true, certifyResult.Message);
            }

            if (certifyResult.VerificationApproved)
            {
                return new JobPipelineResult(true, false, certifyResult.Message);
            }

            return new JobPipelineResult(false, false, certifyResult.Message);
        }

        return new JobPipelineResult(false, false, "No pipeline steps matched this job status.");
    }

    private async Task<DocaOpenResult> SubmitJobToDocaAsync(
        SiteCalibrationRecord job,
        AutomationService automation,
        bool continueOnSamePage)
    {
        if (_session is null)
        {
            throw new InvalidOperationException("Sign in as Super Admin first.");
        }

        if (!job.IsSubmitted)
        {
            throw new InvalidOperationException("Only submitted jobs can be sent to DOCA.");
        }

        if (string.IsNullOrWhiteSpace(job.RcId))
        {
            throw new InvalidOperationException("RC id is missing for this job.");
        }

        var docaCredentials = CurrentDocaCredentials();
        automation.DocaCredentials = docaCredentials;

        var party = await _partyDetailsService.ResolveForJobAsync(job, job.RcId, _session.IdToken);
        var instrument = await _instrumentDetailsService.ResolveForJobAsync(job, job.RcId, _session.IdToken);

        var result = await automation.RunOvStarterAsync(
            job,
            party,
            instrument,
            _session.IdToken,
            docaCredentials,
            continueOnSamePage);

        CaptureDocaCredentialsFromAutomation(automation);
        return result;
    }

    private async Task<DocaOpenResult> CertifyJobAsync(
        SiteCalibrationRecord job,
        AutomationService automation,
        bool continueOnSamePage)
    {
        if (_session is null)
        {
            throw new InvalidOperationException("Sign in as Super Admin first.");
        }

        if (string.IsNullOrWhiteSpace(job.SerialNumber))
        {
            throw new InvalidOperationException("Serial number is required for DOCA certification lookup.");
        }

        if (!job.IsApproved)
        {
            throw new InvalidOperationException("Only approved jobs can be certified on DOCA.");
        }

        if (string.IsNullOrWhiteSpace(job.RcId))
        {
            throw new InvalidOperationException("RC id is missing for this job.");
        }

        var docaCredentials = CurrentDocaCredentials();
        automation.DocaCredentials = docaCredentials;

        var instrument = await _instrumentDetailsService.ResolveForJobAsync(job, job.RcId, _session.IdToken);
        var token = await GetFreshIdTokenAsync();

        var result = await automation.RunCertificationLookupAsync(
            job,
            instrument,
            token,
            docaCredentials,
            continueOnSamePage);

        CaptureDocaCredentialsFromAutomation(automation);
        return result;
    }

    private void CaptureDocaCredentialsFromAutomation(AutomationService automation)
    {
        var captured = automation.DocaCredentials;
        if (string.IsNullOrWhiteSpace(captured.Email) && string.IsNullOrWhiteSpace(captured.Password))
        {
            return;
        }

        DocaEmailBox.Text = captured.Email;
        if (!string.IsNullOrWhiteSpace(captured.Password))
        {
            DocaPasswordBox.Text = captured.Password;
        }

        PersistCredentials();
    }

    private async Task<string> GetFreshIdTokenAsync(CancellationToken cancellationToken = default)
    {
        if (_session is null)
        {
            throw new InvalidOperationException("Sign in as Super Admin first.");
        }

        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            _session = await _authService.RefreshIdTokenAsync(_session, cancellationToken);
            return _session.IdToken;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    private async Task<SiteCalibrationRecord?> ReloadJobAsync(string jobId)
    {
        if (_session is null)
        {
            return null;
        }

        return await _firestoreService.GetVerificationByIdAsync(jobId, _session.IdToken);
    }

    private void SelectJobById(string jobId)
    {
        for (var i = 0; i < _jobs.Count; i++)
        {
            if (string.Equals(_jobs[i].Id, jobId, StringComparison.Ordinal))
            {
                SelectJobAtIndex(i);
                return;
            }
        }
    }

    private async Task SignInAndLoadAsync()
    {
        await RunWithBusyStateAsync(async () =>
        {
            SetStatus("Signing in as Super Admin…", StatusKind.Working);
            _session = await _authService.SignInAsSuperAdminAsync(AadharBox.Text, PasswordBox.Text);

            PersistCredentials();
            _automationService.DocaCredentials = CurrentDocaCredentials();
            UpdateSignInSummary();
            SignInExpander.IsExpanded = false;

            SetStatus("Signed in. Loading certification queue...", StatusKind.Working);
            if (_useRealtimeListener)
            {
                await StartQueueListenerAsync();
            }
            else
            {
                await LoadQueueAsync();
            }

            StartAutoWorkerTimers();
            if (_autoWorkerEnabled)
            {
                if (_autoWorkerPausedForDoca)
                {
                    _ = TryResumeAutoWorkerAfterDocaLoginAsync();
                }
                else
                {
                    _ = RunAutoWorkerCycleAsync();
                }
            }
        });
    }

    private async Task LoadQueueAsync()
    {
        if (_session is null)
        {
            return;
        }

        var records = await _firestoreService.GetPendingCertificationQueueAsync(_session.IdToken);
        ApplyQueueRecords(records, $"Loaded {records.Count} job(s) from Firestore.");
    }

    private void ApplyQueueRecords(IReadOnlyList<SiteCalibrationRecord> records, string statusMessage)
    {
        var previousId = _selectedQueueItem?.Id;

        _jobs.Clear();
        foreach (var record in records)
        {
            var item = new CertificationQueueItem(record)
            {
                RetryBadge = _jobRetries.BadgeFor(record.Id),
            };
            _jobs.Add(item);
        }

        RestoreSelection(previousId);
        UpdateQueueSummary();
        UpdateEmptyState();

        var pending = _jobs.Count(job => job.NeedsPipelineWork);
        var eligible = _jobs.Count(job => job.NeedsPipelineWork && _jobRetries.IsEligible(job.Id));
        SetStatus($"{statusMessage} ({eligible}/{pending} ready in pipeline).", StatusKind.Success);
        UpdateAutoWorkerStatusText();
    }

    private void RestoreSelection(string? previousId)
    {
        _selectedQueueItem = previousId is null
            ? null
            : _jobs.FirstOrDefault(job => job.Id == previousId);

        JobsGrid.SelectedItem = _selectedQueueItem ?? (_jobs.Count > 0 ? _jobs[0] : null);
        _selectedQueueItem = JobsGrid.SelectedItem as CertificationQueueItem;
    }

    private void UpdateQueueSummary()
    {
        var submitted = _jobs.Count(job => job.Record.IsSubmitted);
        var approved = _jobs.Count(job => job.Record.IsReadyToCertify);
        QueueCountText.Text = _jobs.Count == 0
            ? "0 jobs pending"
            : $"{_jobs.Count} jobs · {submitted} to submit · {approved} to certify";
    }

    private void UpdateEmptyState()
    {
        var count = _jobs.Count;
        EmptyStateText.Visibility = count == 0 ? Visibility.Visible : Visibility.Collapsed;
        JobsGrid.Visibility = count == 0 ? Visibility.Collapsed : Visibility.Visible;

        EmptyStateTitleText.Text = "No pending verifications";
        EmptyStateBodyText.Text = _session is null
            ? "Sign in and refresh to load jobs from all RCs."
            : "All submitted and approved jobs are certified.";
    }

    private int SelectedJobIndex()
    {
        var selected = SelectedJob;
        if (selected is null)
        {
            return -1;
        }

        for (var i = 0; i < _jobs.Count; i++)
        {
            if (_jobs[i].Id == selected.Id)
            {
                return i;
            }
        }

        return -1;
    }

    private void SelectJobAtIndex(int index)
    {
        if (index < 0 || index >= _jobs.Count)
        {
            SetSelectedQueueItem(null);
            JobsGrid.SelectedItem = null;
            return;
        }

        var job = _jobs[index];
        JobsGrid.SelectedItem = job;
        JobsGrid.ScrollIntoView(job);
        SetSelectedQueueItem(job);
    }

    private void SelectJobAtIndexAfterRemoval(int removedIndex)
    {
        if (_jobs.Count == 0)
        {
            SelectJobAtIndex(-1);
            return;
        }

        SelectJobAtIndex(Math.Min(removedIndex, _jobs.Count - 1));
    }

    private void UpdateSignInSummary()
    {
        if (_session is null)
        {
            SignInSummaryText.Text = "Not signed in";
            SignInStatusDot.Fill = (Brush)FindResource("TextMutedBrush");
            return;
        }

        var summary = string.IsNullOrWhiteSpace(_session.DisplayName)
            ? _session.Email
            : $"{_session.DisplayName} · Super Admin";
        SignInSummaryText.Text = summary;
        SignInStatusDot.Fill = (Brush)FindResource("AccentGreenBrush");
    }

    private async Task RunWithBusyStateAsync(Func<Task> action)
    {
        if (_isBusy)
        {
            return;
        }

        _isBusy = true;
        SignInButton.IsEnabled = false;
        RefreshButton.IsEnabled = false;

        try
        {
            await action();
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message, StatusKind.Error);
            MessageBox.Show(this, ex.Message, "Certificate Worker", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally
        {
            _isBusy = false;
            SignInButton.IsEnabled = true;
            RefreshButton.IsEnabled = true;

            if (_autoWorkerCyclePending && _autoWorkerEnabled && !_autoWorkerPausedForDoca && _session is not null)
            {
                _autoWorkerCyclePending = false;
                _ = RunAutoWorkerCycleAsync();
            }
        }
    }

    private void SetStatus(string message, StatusKind kind = StatusKind.Info)
    {
        StatusText.Text = message;
        StatusTimestampText.Text = DateTime.Now.ToString("HH:mm:ss");

        switch (kind)
        {
            case StatusKind.Idle:
                StatusStateText.Text = "Idle";
                StatusStateDot.Fill = (Brush)FindResource("TextMutedBrush");
                break;
            case StatusKind.Working:
                StatusStateText.Text = "Working";
                StatusStateDot.Fill = (Brush)FindResource("AccentPrimaryBrush");
                break;
            case StatusKind.Success:
                StatusStateText.Text = "Done";
                StatusStateDot.Fill = (Brush)FindResource("AccentGreenBrush");
                break;
            case StatusKind.Error:
                StatusStateText.Text = "Error";
                StatusStateDot.Fill = new SolidColorBrush(Color.FromRgb(0xEF, 0x44, 0x44));
                break;
            default:
                StatusStateText.Text = "Ready";
                StatusStateDot.Fill = (Brush)FindResource("TextMutedBrush");
                break;
        }

        AddActivityEntry(message);
    }

    private void AddActivityEntry(string message)
    {
        _activityLog.Insert(0, $"{DateTime.Now:HH:mm:ss}  {message}");

        while (_activityLog.Count > 30)
        {
            _activityLog.RemoveAt(_activityLog.Count - 1);
        }
    }
}
