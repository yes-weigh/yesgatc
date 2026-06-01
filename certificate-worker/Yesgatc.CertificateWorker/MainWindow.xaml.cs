using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Win32;
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
    private bool _syncingStatusCombo;
    private bool _useRealtimeListener;
    private bool _realtimeListenerActive;
    private DispatcherTimer? _pollFallbackTimer;
    private DispatcherTimer? _retryBadgeTimer;
    private DispatcherTimer? _docaProbeTimer;

    public MainWindow()
    {
        InitializeComponent();

        foreach (var status in VerificationStatuses.All)
        {
            StatusComboBox.Items.Add(new ComboBoxItem
            {
                Content = VerificationStatuses.Label(status),
                Tag = status,
            });
        }

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
        PasswordBox.Password = FirstNonEmpty(
            saved.SuperAdmin.Password,
            settings.Credentials.Password);
        DocaEmailBox.Text = FirstNonEmpty(
            saved.Doca.Email,
            settings.Automation.DocaCredentials.Email);
        DocaPasswordBox.Password = FirstNonEmpty(
            saved.Doca.Password,
            settings.Automation.DocaCredentials.Password);

        _automationService.DocaCredentials = CurrentDocaCredentials();
        UpdateSignInSummary();
    }

    private static string FirstNonEmpty(string primary, string fallback) =>
        string.IsNullOrWhiteSpace(primary) ? fallback : primary;

    private DocaCredentialSettings CurrentDocaCredentials() => new()
    {
        Email = DocaEmailBox.Text.Trim(),
        Password = DocaPasswordBox.Password,
    };

    private void PersistCredentials()
    {
        _credentialStore.SaveAll(
            AadharBox.Text,
            PasswordBox.Password,
            DocaEmailBox.Text,
            DocaPasswordBox.Password);
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(AadharBox.Text) && !string.IsNullOrWhiteSpace(PasswordBox.Password))
        {
            await SignInAndLoadAsync();
            return;
        }

        SignInExpander.IsExpanded = true;
        SetStatus("Enter Super Admin credentials and sign in to load the queue.", StatusKind.Idle);
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
        AutoWorkerCheckBox.IsChecked = settings.Enabled;
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
            if (_autoWorkerEnabled && !_isBusy && !_autoWorkerPausedForDoca)
            {
                await RunAutoWorkerCycleAsync();
            }
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
        _automationService.ManualDocaLoginWait = paused;

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
        if (!_autoWorkerPausedForDoca || _session is null || _isBusy)
        {
            return;
        }

        await TryResumeAutoWorkerAfterDocaLoginAsync();
    }

    private async void PollFallbackTimer_Tick(object? sender, EventArgs e)
    {
        if (!_autoWorkerEnabled || _session is null || _isBusy)
        {
            return;
        }

        if (_autoWorkerPausedForDoca)
        {
            await TryResumeAutoWorkerAfterDocaLoginAsync();
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

    private void AutoWorkerCheckBox_Changed(object sender, RoutedEventArgs e)
    {
        _autoWorkerEnabled = AutoWorkerCheckBox.IsChecked == true;
        UpdateAutoWorkerStatusText();

        if (_autoWorkerEnabled && _session is not null)
        {
            StartAutoWorkerTimers();
            _ = RunAutoWorkerCycleAsync();
            return;
        }

        StopAutoWorkerTimers();
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
            SetStatus($"Waiting for DOCA login — {ex.Message}", StatusKind.Info);
            UpdateAutoWorkerStatusText();
        }
    }

    private async Task RunAutoWorkerCycleAsync()
    {
        if (!_autoWorkerEnabled || _session is null || _isBusy || _autoWorkerPausedForDoca)
        {
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
            AutoWorkerStatusText.Text = "Auto worker is off — use Process all jobs manually.";
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
                "Paused for DOCA login — enter your new password and captcha in Chrome; the page will not be refreshed.";
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

    private void JobsGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        SetSelectedQueueItem(JobsGrid.SelectedItem as CertificationQueueItem);
        UpdateSelectionUi();
    }

    private void PreviousJobButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy || _jobs.Count == 0)
        {
            return;
        }

        var index = SelectedJobIndex();
        SelectJobAtIndex(index <= 0 ? _jobs.Count - 1 : index - 1);
    }

    private void NextJobButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy || _jobs.Count == 0)
        {
            return;
        }

        var index = SelectedJobIndex();
        SelectJobAtIndex(index < 0 || index >= _jobs.Count - 1 ? 0 : index + 1);
    }

    private async void ProcessJobButton_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedJob is null || _session is null)
        {
            SetStatus("Select a job from the queue first.", StatusKind.Info);
            return;
        }

        if (!SelectedJob.NeedsPipelineWork)
        {
            SetStatus("This job has no pending pipeline steps.", StatusKind.Info);
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            var job = SelectedJob!;
            var jobIndex = SelectedJobIndex();
            var result = await ProcessJobWithRecoveryAsync(
                job,
                _automationService,
                continueBrowserSession: _automationService.IsBrowserConnected);

            await HandleJobPipelineResultAsync(job, jobIndex, result, fromAutoWorker: false);
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

    private async void PrepareBulkBrowsersButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first.", StatusKind.Info);
            return;
        }

        var browserCount = App.Settings.Automation.ParallelBrowserCount;
        if (browserCount < 1)
        {
            SetStatus("ParallelBrowserCount must be at least 1 in appsettings.json.", StatusKind.Error);
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            PersistCredentials();
            _automationService.DocaCredentials = CurrentDocaCredentials();

            SetStatus($"Opening {browserCount} Chrome session(s) for DOCA login check…", StatusKind.Working);
            await DisposePreparedBulkWorkersAsync();

            var loginRequired = 0;
            var ready = 0;

            for (var i = 0; i < browserCount; i++)
            {
                var automation = CreateAutomationWorker(i);
                var state = await automation.OpenDocaWorkspaceAsync(i + 1);
                _preparedBulkWorkers.Add(automation);

                if (state == DocaSessionState.LoginRequired)
                {
                    loginRequired++;
                }
                else
                {
                    ready++;
                }
            }

            UpdatePrepareBulkBrowsersButtonContent();

            if (loginRequired == 0)
            {
                SetStatus(
                    $"All {browserCount} Chrome sessions are open and logged in to DOCA. Ready for bulk processing.",
                    StatusKind.Success);
            }
            else
            {
                SetStatus(
                    $"Opened {browserCount} Chrome sessions — {ready} logged in, {loginRequired} need DOCA login. " +
                    "Complete login in each window, then click this button again to verify.",
                    StatusKind.Info);
            }
        });
    }

    private async void ProcessAllJobsButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first.", StatusKind.Info);
            return;
        }

        var queue = _jobs
            .Where(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id))
            .Select(item => item.Record)
            .ToList();
        if (queue.Count == 0)
        {
            var waiting = _jobs.Count(item => item.NeedsPipelineWork && !_jobRetries.IsEligible(item.Id));
            SetStatus(waiting > 0
                ? $"No jobs ready — {waiting} waiting for retry."
                : "No jobs are waiting in the pipeline.",
                StatusKind.Info);
            return;
        }

        var settings = App.Settings.Automation;
        var skipConfirm = _autoWorkerEnabled || App.Settings.AutoWorker.SkipBatchConfirmation;
        if (!skipConfirm)
        {
            var useParallel = queue.Count > settings.ParallelBrowserThreshold && settings.ParallelBrowserCount > 1;
            var parallelHint = useParallel
                ? $"\n\n{Math.Min(settings.ParallelBrowserCount, queue.Count)} Chrome windows will open and jobs are split across them. " +
                  "Log in to DOCA in each window if prompted (first time only per window)."
                : "\n\nKeep the DOCA browser window open.";

            var confirm = MessageBox.Show(
                this,
                $"Process {queue.Count} job(s)?\n\n" +
                "Each job runs only the steps it still needs:\n" +
                "• Submitted → submit on DOCA (duplicate check), then certify\n" +
                "• Approved → certify only (download, stamp, upload, Firebase)\n\n" +
                "If phase 1 already succeeded on DOCA, phase 2 resumes without creating a duplicate." +
                parallelHint,
                "Process all jobs",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);
            if (confirm != MessageBoxResult.Yes)
            {
                return;
            }
        }

        await RunWithBusyStateAsync(async () =>
        {
            PersistCredentials();
            _automationService.DocaCredentials = CurrentDocaCredentials();
            await ProcessQueueInternalAsync(queue, sequentialOnly: false, fromAutoWorker: false);
        });
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
            SetProcessAllButtonContentSafe($"{batchLabel}…");

            try
            {
                var result = await ProcessJobWithRecoveryAsync(
                    job,
                    _automationService,
                    continueBrowserSession: continueSession || i > 0);

                continueSession = _automationService.IsBrowserConnected;

                if (result.LoginRequired)
                {
                    if (fromAutoWorker || _autoWorkerEnabled)
                    {
                        SetDocaLoginPaused(true);
                    }

                    SetStatusSafe(
                        $"{batchLabel} paused — complete DOCA login/captcha in Chrome. Auto worker will resume when logged in.",
                        StatusKind.Error);
                    return;
                }

                if (result.Completed)
                {
                    completed++;
                    _jobRetries.Clear(job.Id);
                    SetStatusSafe($"{batchLabel} · {result.Message}", StatusKind.Success);
                    await LoadQueueAsync();
                }
                else
                {
                    failed++;
                    lastError = result.Message;
                    _jobRetries.Schedule(
                        job.Id,
                        result.Message,
                        TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds));
                    RefreshRetryBadges();
                    SetStatusSafe($"{batchLabel} · {result.Message}", StatusKind.Info);
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
            }
        }

        await LoadQueueAsync();
        ReportBatchSummary(queue.Count, completed, failed, lastError, loginStopped: false);
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
                    SetStatusSafe($"{label} failed · {ex.Message}", StatusKind.Error);
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
        UpdatePrepareBulkBrowsersButtonContent();
    }

    private void UpdatePrepareBulkBrowsersButtonContent()
    {
        var configured = App.Settings.Automation.ParallelBrowserCount;
        var openCount = _preparedBulkWorkers.Count(worker => worker.IsBrowserConnected);
        PrepareBulkBrowsersButton.Content = openCount > 0
            ? $"Open Chrome sessions for bulk DOCA ({openCount}/{configured} open)"
            : $"Open Chrome sessions for bulk DOCA ({configured})";
    }

    private AutomationService CreateAutomationWorker(int workerIndex)
    {
        var automation = new AutomationService(App.Settings.Automation, _firestoreService)
        {
            WorkerIndex = workerIndex,
            DocaCredentials = CurrentDocaCredentials(),
            ResolveFirebaseIdToken = GetFreshIdTokenAsync,
        };
        return automation;
    }

    private void ReportBatchSummary(int total, int completed, int failed, string? lastError, bool loginStopped)
    {
        if (loginStopped)
        {
            SetStatusSafe(
                $"Batch paused — complete DOCA login in the browser window(s), then run again. " +
                $"{completed} completed so far. {lastError}",
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

    private void SetProcessAllButtonContentSafe(string content)
    {
        if (Dispatcher.CheckAccess())
        {
            ProcessAllJobsButton.Content = content;
            return;
        }

        Dispatcher.Invoke(() => ProcessAllJobsButton.Content = content);
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
            DocaPasswordBox.Password = captured.Password;
        }

        PersistCredentials();
    }

    private async void UploadCertificatePdfButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null || SelectedJob is null)
        {
            return;
        }

        var job = SelectedJob;
        if (!job.NeedsCertificatePdfUpload)
        {
            MessageBox.Show(
                this,
                "This job already has a certificate PDF URL in Firebase.",
                "Certificate Worker",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            var pdfPath = WorkerDataPaths.FindLatestStampedPdf(job.Id);
            if (string.IsNullOrWhiteSpace(pdfPath))
            {
                var dialog = new OpenFileDialog
                {
                    Title = "Select signed certificate PDF",
                    Filter = "PDF files (*.pdf)|*.pdf",
                    CheckFileExists = true,
                };

                if (dialog.ShowDialog(this) != true)
                {
                    SetStatus("Certificate PDF upload cancelled.", StatusKind.Info);
                    return;
                }

                pdfPath = dialog.FileName;
            }

            SetStatus($"Uploading signed PDF to Firebase Storage for serial {job.SerialNumber}…", StatusKind.Working);
            var token = await GetFreshIdTokenAsync();
            await _firestoreService.MarkCertifiedWithSignedPdfAsync(
                job.Id,
                pdfPath,
                token,
                cancellationToken: CancellationToken.None);

            SetStatus(
                $"Certificate PDF uploaded — serial {job.SerialNumber}. Refresh the web app to download.",
                StatusKind.Success);
            AddActivityEntry($"Uploaded certificate PDF for {job.CustomerName} · serial {job.SerialNumber}");

            await LoadQueueAsync();
            SelectJobById(job.Id);
        });
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

    private async void ApplyStatusButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null || SelectedJob is null)
        {
            return;
        }

        var newStatus = GetSelectedStatusFromCombo();
        if (newStatus is null)
        {
            return;
        }

        if (string.Equals(VerificationStatuses.Normalize(SelectedJob.Status), newStatus, StringComparison.OrdinalIgnoreCase))
        {
            SetStatus($"Job is already {VerificationStatuses.Label(newStatus)}.", StatusKind.Info);
            return;
        }

        var confirm = MessageBox.Show(
            this,
            $"Change status for serial {SelectedJob.SerialNumber}?\n\n" +
            $"{SelectedJob.StatusLabel} → {VerificationStatuses.Label(newStatus)}",
            "Update job status",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);
        if (confirm != MessageBoxResult.Yes)
        {
            SyncStatusComboToSelectedJob();
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            var job = SelectedJob!;
            await _firestoreService.UpdateVerificationStatusAsync(job.Id, newStatus, _session!.IdToken);
            SetStatus(
                $"Updated serial {job.SerialNumber} to {VerificationStatuses.Label(newStatus)}.",
                StatusKind.Success);
            await LoadQueueAsync();
        });
    }

    private void StatusComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncingStatusCombo)
        {
            return;
        }

        UpdateStatusChangeUi();
    }

    private string? GetSelectedStatusFromCombo()
    {
        if (StatusComboBox.SelectedItem is ComboBoxItem item
            && item.Tag is string status)
        {
            return status;
        }

        return null;
    }

    private void SyncStatusComboToSelectedJob()
    {
        _syncingStatusCombo = true;
        try
        {
            var normalized = VerificationStatuses.Normalize(SelectedJob?.Status);
            StatusComboBox.SelectedItem = StatusComboBox.Items
                .Cast<ComboBoxItem>()
                .FirstOrDefault(item => string.Equals(item.Tag as string, normalized, StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            _syncingStatusCombo = false;
        }
    }

    private void UpdateStatusChangeUi()
    {
        var selected = SelectedJob;
        var canChangeStatus = !_isBusy && _session is not null && selected is not null;
        StatusComboBox.IsEnabled = canChangeStatus;

        if (selected is null || _session is null)
        {
            StatusOverrideSummaryText.Text = "Collapsed — expand only when you need to fix a status";
        }
        else
        {
            StatusOverrideSummaryText.Text =
                $"Current: {selected.StatusLabel} · serial {selected.SerialNumber}";
        }

        if (!canChangeStatus)
        {
            ApplyStatusButton.IsEnabled = false;
            return;
        }

        var current = VerificationStatuses.Normalize(selected!.Status);
        var target = GetSelectedStatusFromCombo();
        ApplyStatusButton.IsEnabled = target is not null
            && !string.Equals(current, target, StringComparison.OrdinalIgnoreCase);
    }

    private async Task SignInAndLoadAsync()
    {
        await RunWithBusyStateAsync(async () =>
        {
            SetStatus("Signing in as Super Admin…", StatusKind.Working);
            _session = await _authService.SignInAsSuperAdminAsync(AadharBox.Text, PasswordBox.Password);
            SignedInLabel.Text = string.IsNullOrWhiteSpace(_session.DisplayName)
                ? _session.Email
                : _session.DisplayName;

            PersistCredentials();
            _automationService.DocaCredentials = CurrentDocaCredentials();
            UpdateSignInSummary();
            SignInExpander.IsExpanded = false;

            SetStatus("Signed in. Loading certification queue…", StatusKind.Working);
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
                _ = RunAutoWorkerCycleAsync();
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
        UpdateSelectionUi();

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
        var eligible = _jobs.Count(job => job.NeedsPipelineWork && _jobRetries.IsEligible(job.Id));
        ProcessAllJobsButton.Content = $"Process all jobs ({eligible})";
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
            UpdateSelectionUi();
            return;
        }

        var job = _jobs[index];
        JobsGrid.SelectedItem = job;
        JobsGrid.ScrollIntoView(job);
        SetSelectedQueueItem(job);
        UpdateSelectionUi();
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

    private void UpdateSelectionUi()
    {
        var canNavigate = !_isBusy && _jobs.Count > 0;
        var selected = SelectedJob;
        var canAct = canNavigate && _session is not null && selected is not null;
        var index = SelectedJobIndex();

        PreviousJobButton.IsEnabled = canNavigate;
        NextJobButton.IsEnabled = canNavigate;

        if (_jobs.Count == 0)
        {
            JobPositionText.Text = "No jobs loaded";
            SelectedJobText.Text = _session is null
                ? "Sign in as Super Admin and refresh the queue."
                : "No submitted or approved jobs are waiting.";
            ProcessAllJobsButton.IsEnabled = false;
            ProcessJobButton.IsEnabled = false;
            UploadCertificatePdfButton.IsEnabled = false;
            PrepareBulkBrowsersButton.IsEnabled = _session is not null && !_isBusy;
            StatusComboBox.IsEnabled = false;
            ApplyStatusButton.IsEnabled = false;
            UpdateQueueSummary();
            UpdatePrepareBulkBrowsersButtonContent();
            return;
        }

        JobPositionText.Text = selected is null
            ? $"{_jobs.Count} job(s) in queue"
            : $"Job {index + 1} of {_jobs.Count}";

        if (selected is null)
        {
            SelectedJobText.Text = "Select a job from the queue or use Previous / Next job.";
            ProcessAllJobsButton.IsEnabled = _session is not null && !_isBusy;
            ProcessJobButton.IsEnabled = false;
            UploadCertificatePdfButton.IsEnabled = false;
            PrepareBulkBrowsersButton.IsEnabled = _session is not null && !_isBusy;
            SyncStatusComboToSelectedJob();
            UpdateStatusChangeUi();
            UpdateQueueSummary();
            UpdatePrepareBulkBrowsersButtonContent();
            return;
        }

        SelectedJobText.Text =
            $"{selected.RcCenterName}\n{selected.CustomerName}\n{selected.ProductName} · Serial {selected.SerialNumber}\n" +
            $"{selected.VerificationTypeLabel} · {selected.StatusLabel} · {selected.NextStepLabel}\n" +
            $"Updated {selected.PipelineDateDisplay} · {selected.CertificationStatusLabel}";

        SyncStatusComboToSelectedJob();
        UpdateStatusChangeUi();
        UpdateQueueSummary();

        var pendingCount = _jobs.Count(job => job.NeedsPipelineWork && _jobRetries.IsEligible(job.Id));
        ProcessAllJobsButton.IsEnabled = canNavigate && _session is not null && pendingCount > 0;
        ProcessJobButton.IsEnabled = canAct && selected.NeedsPipelineWork;
        UploadCertificatePdfButton.IsEnabled = canAct && selected.NeedsCertificatePdfUpload;
        PrepareBulkBrowsersButton.IsEnabled = _session is not null && !_isBusy;
        UpdatePrepareBulkBrowsersButtonContent();
    }

    private void UpdateSignInSummary()
    {
        if (_session is null)
        {
            SignInSummaryText.Text = "Not signed in";
            SignedInLabel.Text = "Not signed in";
            SignInStatusDot.Fill = (Brush)FindResource("TextMutedBrush");
            return;
        }

        var summary = string.IsNullOrWhiteSpace(_session.DisplayName)
            ? _session.Email
            : $"{_session.DisplayName} · Super Admin";
        SignInSummaryText.Text = summary;
        SignedInLabel.Text = summary;
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
        PrepareBulkBrowsersButton.IsEnabled = false;
        ProcessAllJobsButton.IsEnabled = false;
        ProcessJobButton.IsEnabled = false;
        UploadCertificatePdfButton.IsEnabled = false;
        PreviousJobButton.IsEnabled = false;
        NextJobButton.IsEnabled = false;
        StatusComboBox.IsEnabled = false;
        ApplyStatusButton.IsEnabled = false;

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
            UpdateSelectionUi();
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
