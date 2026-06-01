using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
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

    private sealed record JobPipelineResult(bool Completed, bool LoginRequired, string Message);

    private sealed class ParallelBatchStats
    {
        public int Completed;
        public int Failed;
        public int LoginRequiredWorkers;
        public string? LastError;
    }

    private readonly ObservableCollection<SiteCalibrationRecord> _jobs = [];
    private readonly ObservableCollection<string> _activityLog = [];
    private readonly FirebaseAuthService _authService;
    private readonly FirestoreService _firestoreService;
    private readonly PartyDetailsService _partyDetailsService;
    private readonly InstrumentDetailsService _instrumentDetailsService;
    private readonly AutomationService _automationService;
    private readonly LocalCredentialsStore _credentialStore = new();
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private readonly List<AutomationService> _preparedBulkWorkers = [];

    private FirebaseSignInResult? _session;
    private SiteCalibrationRecord? _selectedJob;
    private bool _isBusy;
    private bool _syncingStatusCombo;

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
        _partyDetailsService = new PartyDetailsService(settings.Firebase);
        _instrumentDetailsService = new InstrumentDetailsService(settings.Firebase);
        _automationService = new AutomationService(settings.Automation, _firestoreService);
        _automationService.ResolveFirebaseIdToken = GetFreshIdTokenAsync;
        App.AutomationService = _automationService;

        JobsGrid.ItemsSource = _jobs;
        ActivityLogList.ItemsSource = _activityLog;
        LoadSavedCredentials(settings);

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private SiteCalibrationRecord? SelectedJob => _selectedJob;

    private void SetSelectedJob(SiteCalibrationRecord? job) => _selectedJob = job;

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
        await DisposePreparedBulkWorkersAsync();
        await _automationService.DisposeAsync();
        _tokenLock.Dispose();
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
        SetSelectedJob(JobsGrid.SelectedItem as SiteCalibrationRecord);
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
            var result = await ProcessJobThroughPipelineAsync(
                job,
                _automationService,
                continueBrowserSession: false);

            if (result.LoginRequired)
            {
                SetStatus(result.Message, StatusKind.Error);
                return;
            }

            if (result.Completed)
            {
                SetStatus(result.Message, StatusKind.Success);
                await LoadQueueAsync();
                SelectJobAtIndexAfterRemoval(jobIndex);
            }
            else
            {
                SetStatus(result.Message, StatusKind.Info);
                await LoadQueueAsync();
                SelectJobById(job.Id);
            }
        });
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

        var queue = _jobs.Where(job => job.NeedsPipelineWork).ToList();
        if (queue.Count == 0)
        {
            SetStatus("No jobs are waiting in the pipeline.", StatusKind.Info);
            return;
        }

        var settings = App.Settings.Automation;
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

        await RunWithBusyStateAsync(async () =>
        {
            PersistCredentials();
            _automationService.DocaCredentials = CurrentDocaCredentials();

            if (useParallel)
            {
                await ProcessAllJobsInParallelAsync(queue, settings.ParallelBrowserCount);
            }
            else
            {
                await ProcessAllJobsSequentiallyAsync(queue);
            }
        });
    }

    private async Task ProcessAllJobsSequentiallyAsync(IReadOnlyList<SiteCalibrationRecord> queue)
    {
        var completed = 0;
        var failed = 0;
        string? lastError = null;

        for (var i = 0; i < queue.Count; i++)
        {
            var job = queue[i];
            var batchLabel = $"Job {i + 1} of {queue.Count}";

            SelectJobOnUiThread(job.Id);
            SetStatusSafe($"{batchLabel} · Serial {job.SerialNumber} ({job.NextStepLabel})…", StatusKind.Working);
            SetProcessAllButtonContentSafe($"{batchLabel}…");

            try
            {
                var result = await ProcessJobThroughPipelineAsync(
                    job,
                    _automationService,
                    continueBrowserSession: i > 0);

                if (result.LoginRequired)
                {
                    SetStatusSafe(
                        $"{batchLabel} stopped — DOCA login required. Complete login in the browser, then run again.",
                        StatusKind.Error);
                    return;
                }

                if (result.Completed)
                {
                    completed++;
                    SetStatusSafe($"{batchLabel} · {result.Message}", StatusKind.Success);
                    await LoadQueueAsync();
                }
                else
                {
                    failed++;
                    lastError = result.Message;
                    SetStatusSafe($"{batchLabel} · {result.Message}", StatusKind.Info);
                }
            }
            catch (Exception ex)
            {
                failed++;
                lastError = ex.Message;
                SetStatusSafe($"{batchLabel} failed · {ex.Message}", StatusKind.Error);
            }
        }

        await LoadQueueAsync();
        ReportBatchSummary(queue.Count, completed, failed, lastError, loginStopped: false);
    }

    private async Task ProcessAllJobsInParallelAsync(IReadOnlyList<SiteCalibrationRecord> queue, int parallelBrowserCount)
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
                    var result = await ProcessJobThroughPipelineAsync(
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
                        SetStatusSafe($"{label} — DOCA login required in Chrome {workerIndex + 1}.", StatusKind.Error);
                        return;
                    }

                    if (result.Completed)
                    {
                        Interlocked.Increment(ref stats.Completed);
                        SetStatusSafe($"{label} · done", StatusKind.Success);
                    }
                    else
                    {
                        Interlocked.Increment(ref stats.Failed);
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
        if (_preparedBulkWorkers.Count >= workerCount
            && _preparedBulkWorkers.Take(workerCount).All(worker => worker.IsRunning))
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
        var openCount = _preparedBulkWorkers.Count(worker => worker.IsRunning);
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
            await LoadQueueAsync();
        });
    }

    private async Task LoadQueueAsync()
    {
        if (_session is null)
        {
            return;
        }

        var previousId = _selectedJob?.Id;
        var records = await _firestoreService.GetPendingCertificationQueueAsync(_session.IdToken);

        _jobs.Clear();
        foreach (var record in records)
        {
            _jobs.Add(record);
        }

        RestoreSelection(previousId);
        UpdateQueueSummary();
        UpdateEmptyState();
        UpdateSelectionUi();

        var pending = _jobs.Count(job => job.NeedsPipelineWork);
        SetStatus($"Loaded {_jobs.Count} job(s) ({pending} pending in pipeline).", StatusKind.Success);
    }

    private void RestoreSelection(string? previousId)
    {
        _selectedJob = previousId is null
            ? null
            : _jobs.FirstOrDefault(job => job.Id == previousId);

        JobsGrid.SelectedItem = _selectedJob ?? (_jobs.Count > 0 ? _jobs[0] : null);
        _selectedJob = JobsGrid.SelectedItem as SiteCalibrationRecord;
    }

    private void UpdateQueueSummary()
    {
        var submitted = _jobs.Count(job => job.IsSubmitted);
        var approved = _jobs.Count(job => job.IsReadyToCertify);
        QueueCountText.Text = _jobs.Count == 0
            ? "0 jobs pending"
            : $"{_jobs.Count} jobs · {submitted} to submit · {approved} to certify";
        ProcessAllJobsButton.Content = $"Process all jobs ({_jobs.Count(job => job.NeedsPipelineWork)})";
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
            SetSelectedJob(null);
            JobsGrid.SelectedItem = null;
            UpdateSelectionUi();
            return;
        }

        var job = _jobs[index];
        JobsGrid.SelectedItem = job;
        JobsGrid.ScrollIntoView(job);
        SetSelectedJob(job);
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

        var pendingCount = _jobs.Count(job => job.NeedsPipelineWork);
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
