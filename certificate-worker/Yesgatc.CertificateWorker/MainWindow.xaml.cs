using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
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

    private enum QueueTab
    {
        Submitted,
        Approved,
    }

    private readonly ObservableCollection<SiteCalibrationRecord> _submittedJobs = [];
    private readonly ObservableCollection<SiteCalibrationRecord> _approvedJobs = [];
    private readonly ObservableCollection<string> _activityLog = [];
    private readonly FirebaseAuthService _authService;
    private readonly FirestoreService _firestoreService;
    private readonly PartyDetailsService _partyDetailsService;
    private readonly InstrumentDetailsService _instrumentDetailsService;
    private readonly AutomationService _automationService;
    private readonly LocalCredentialsStore _credentialStore = new();

    private FirebaseSignInResult? _session;
    private SiteCalibrationRecord? _selectedSubmittedJob;
    private SiteCalibrationRecord? _selectedApprovedJob;
    private QueueTab _activeTab = QueueTab.Submitted;
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
        App.AutomationService = _automationService;

        JobsGrid.ItemsSource = _submittedJobs;
        ActivityLogList.ItemsSource = _activityLog;
        LoadSavedCredentials(settings);

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private ObservableCollection<SiteCalibrationRecord> ActiveJobs =>
        _activeTab == QueueTab.Submitted ? _submittedJobs : _approvedJobs;

    private SiteCalibrationRecord? SelectedJob =>
        _activeTab == QueueTab.Submitted ? _selectedSubmittedJob : _selectedApprovedJob;

    private void SetSelectedJob(SiteCalibrationRecord? job)
    {
        if (_activeTab == QueueTab.Submitted)
        {
            _selectedSubmittedJob = job;
        }
        else
        {
            _selectedApprovedJob = job;
        }
    }

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
        SetStatus("Enter Super Admin credentials and sign in to load the queues.", StatusKind.Idle);
    }

    private async void MainWindow_Closed(object? sender, EventArgs e)
    {
        await _automationService.DisposeAsync();
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
            SetStatus("Refreshing queues…", StatusKind.Working);
            await LoadQueuesAsync();
        });
    }

    private void QueueTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (QueueTabs.SelectedItem is not TabItem tab)
        {
            return;
        }

        _activeTab = tab == ApprovedTabItem ? QueueTab.Approved : QueueTab.Submitted;
        JobsGrid.ItemsSource = ActiveJobs;
        JobsGrid.SelectedItem = SelectedJob;
        UpdateTabChrome();
        UpdateSelectionUi();
    }

    private void JobsGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        SetSelectedJob(JobsGrid.SelectedItem as SiteCalibrationRecord);
        UpdateSelectionUi();
    }

    private void PreviousJobButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy || ActiveJobs.Count == 0)
        {
            return;
        }

        var index = SelectedJobIndex();
        SelectJobAtIndex(index <= 0 ? ActiveJobs.Count - 1 : index - 1);
    }

    private void NextJobButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isBusy || ActiveJobs.Count == 0)
        {
            return;
        }

        var index = SelectedJobIndex();
        SelectJobAtIndex(index < 0 || index >= ActiveJobs.Count - 1 ? 0 : index + 1);
    }

    private async void ApproveJobButton_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedJob is null || _session is null)
        {
            SetStatus("Select a submitted job first.", StatusKind.Info);
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            var job = SelectedJob!;
            var jobIndex = SelectedJobIndex();
            var result = await SubmitJobToDocaAsync(job, continueOnSamePage: false);

            if (result.State == DocaSessionState.LoginRequired)
            {
                SetStatus(result.Message, StatusKind.Info);
                return;
            }

            if (result.VerificationApproved)
            {
                SetStatus(result.Message, StatusKind.Success);
                await LoadQueuesAsync();
                QueueTabs.SelectedItem = ApprovedTabItem;
                SelectJobAtIndexAfterRemoval(jobIndex);
            }
            else
            {
                SetStatus(result.Message, StatusKind.Info);
            }
        });
    }

    private async void ApproveAllJobsButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first.", StatusKind.Info);
            return;
        }

        if (_submittedJobs.Count == 0)
        {
            SetStatus("No submitted jobs to approve.", StatusKind.Info);
            return;
        }

        var confirm = MessageBox.Show(
            this,
            $"Submit all {_submittedJobs.Count} submitted job(s) on DOCA?\n\n" +
            "The browser opens the create IC verification form for each job. " +
            "Firebase is updated to approved only after DOCA submission succeeds.",
            "Submit all on DOCA",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);
        if (confirm != MessageBoxResult.Yes)
        {
            return;
        }

        await SubmitAllJobsToDocaAsync(_submittedJobs.ToList());
    }

    private async Task SubmitAllJobsToDocaAsync(IReadOnlyList<SiteCalibrationRecord> jobs)
    {
        await RunWithBusyStateAsync(async () =>
        {
            PersistCredentials();
            _automationService.DocaCredentials = CurrentDocaCredentials();

            var completed = 0;
            var failed = 0;
            string? lastError = null;

            for (var i = 0; i < jobs.Count; i++)
            {
                var job = jobs[i];
                var batchLabel = $"Submit {i + 1} of {jobs.Count}";

                var liveIndex = _submittedJobs.ToList().FindIndex(j => j.Id == job.Id);
                if (liveIndex >= 0)
                {
                    QueueTabs.SelectedItem = SubmittedTabItem;
                    SelectJobAtIndex(liveIndex);
                }

                SetStatus($"{batchLabel} · Serial {job.SerialNumber}…", StatusKind.Working);

                try
                {
                    var result = await SubmitJobToDocaAsync(job, continueOnSamePage: i > 0);

                    if (result.State == DocaSessionState.LoginRequired)
                    {
                        SetStatus(
                            $"{batchLabel} stopped — DOCA login required. Complete login in the browser, then run again.",
                            StatusKind.Error);
                        return;
                    }

                    if (result.VerificationApproved)
                    {
                        completed++;
                        SetStatus($"{batchLabel} · {result.Message}", StatusKind.Success);
                    }
                    else
                    {
                        failed++;
                        lastError = result.Message;
                        SetStatus($"{batchLabel} · {result.Message}", StatusKind.Info);
                    }
                }
                catch (Exception ex)
                {
                    failed++;
                    lastError = ex.Message;
                    SetStatus($"{batchLabel} failed · {ex.Message}", StatusKind.Error);
                }
            }

            await LoadQueuesAsync();
            QueueTabs.SelectedItem = ApprovedTabItem;

            if (completed == jobs.Count)
            {
                SetStatus($"Batch complete — {completed} job(s) submitted on DOCA and approved.", StatusKind.Success);
            }
            else if (completed > 0)
            {
                SetStatus($"Batch finished — {completed} succeeded, {failed} failed. {lastError}", StatusKind.Info);
            }
            else if (failed > 0)
            {
                SetStatus($"Batch finished — all {failed} job(s) failed. {lastError}", StatusKind.Error);
            }
        });
    }

    private async Task<DocaOpenResult> SubmitJobToDocaAsync(
        SiteCalibrationRecord job,
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
        _automationService.DocaCredentials = docaCredentials;

        SetStatus($"Step 1/4 · Opening DOCA create IC form for serial {job.SerialNumber}…", StatusKind.Working);

        var party = await _partyDetailsService.ResolveForJobAsync(job, job.RcId, _session.IdToken);
        SetStatus($"Step 2/4 · Loading instrument details for serial {job.SerialNumber}…", StatusKind.Working);

        var instrument = await _instrumentDetailsService.ResolveForJobAsync(job, job.RcId, _session.IdToken);
        SetStatus($"Step 3/4 · Filling form and submitting on DOCA…", StatusKind.Working);

        var result = await _automationService.RunOvStarterAsync(
            job,
            party,
            instrument,
            _session.IdToken,
            docaCredentials,
            continueOnSamePage);

        var captured = _automationService.DocaCredentials;
        if (!string.IsNullOrWhiteSpace(captured.Email) || !string.IsNullOrWhiteSpace(captured.Password))
        {
            DocaEmailBox.Text = captured.Email;
            if (!string.IsNullOrWhiteSpace(captured.Password))
            {
                DocaPasswordBox.Password = captured.Password;
            }

            PersistCredentials();
        }

        return result;
    }

    private async void CertifyJobButton_Click(object sender, RoutedEventArgs e)
    {
        if (SelectedJob is null)
        {
            SetStatus("Select an approved job first.", StatusKind.Info);
            return;
        }

        if (!SelectedJob.IsReadyToCertify)
        {
            SetStatus(
                SelectedJob.IsCertified
                    ? "This job is already certified."
                    : "This job is not ready for DOCA certification.",
                StatusKind.Info);
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            if (_session is null)
            {
                throw new InvalidOperationException("Sign in as Super Admin first.");
            }

            var job = SelectedJob;
            var jobIndex = SelectedJobIndex();
            var result = await CertifyJobAsync(job, continueOnSamePage: false);

            if (result.VerificationApproved)
            {
                SetStatus(result.Message, StatusKind.Success);
                await LoadQueuesAsync();
                SelectJobAtIndexAfterRemoval(jobIndex);
            }
            else
            {
                SetStatus(result.Message, StatusKind.Info);
            }
        });
    }

    private async void CertifyAllJobsButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first.", StatusKind.Info);
            return;
        }

        var certifyQueue = _approvedJobs.Where(job => job.IsReadyToCertify).ToList();
        if (certifyQueue.Count == 0)
        {
            SetStatus("No approved jobs are waiting for DOCA certification.", StatusKind.Info);
            return;
        }

        var confirm = MessageBox.Show(
            this,
            $"Start DOCA certification for {certifyQueue.Count} approved job(s)?\n\n" +
            "Each job downloads the DOCA certificate PDF, stamps it, and uploads the signed PDF with the instrument photo.",
            "Certify all approved jobs",
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

            var completed = 0;
            var failed = 0;
            string? lastError = null;

            for (var i = 0; i < certifyQueue.Count; i++)
            {
                var job = certifyQueue[i];
                var batchLabel = $"Certify {i + 1} of {certifyQueue.Count}";

                var liveIndex = _approvedJobs.ToList().FindIndex(j => j.Id == job.Id);
                if (liveIndex >= 0)
                {
                    QueueTabs.SelectedItem = ApprovedTabItem;
                    SelectJobAtIndex(liveIndex);
                }

                SetStatus($"{batchLabel} · Loading serial {job.SerialNumber}…", StatusKind.Working);

                try
                {
                    var result = await CertifyJobAsync(job, continueOnSamePage: false);

                    if (result.State == DocaSessionState.LoginRequired)
                    {
                        SetStatus(
                            $"{batchLabel} stopped — DOCA login required. Complete login in the browser, then run again.",
                            StatusKind.Error);
                        return;
                    }

                    if (result.VerificationApproved)
                    {
                        completed++;
                        SetStatus($"{batchLabel} · {result.Message}", StatusKind.Success);
                    }
                    else
                    {
                        failed++;
                        lastError = result.Message;
                        SetStatus($"{batchLabel} · {result.Message}", StatusKind.Info);
                    }
                }
                catch (Exception ex)
                {
                    failed++;
                    lastError = ex.Message;
                    SetStatus($"{batchLabel} failed · {ex.Message}", StatusKind.Error);
                }
            }

            await LoadQueuesAsync();

            if (completed == certifyQueue.Count)
            {
                SetStatus($"Batch complete — {completed} job(s) located on View IC Verification.", StatusKind.Success);
            }
            else if (completed > 0)
            {
                SetStatus($"Batch finished — {completed} succeeded, {failed} failed. {lastError}", StatusKind.Info);
            }
            else if (failed > 0)
            {
                SetStatus($"Batch finished — all {failed} job(s) failed. {lastError}", StatusKind.Error);
            }
        });
    }

    private async Task<DocaOpenResult> CertifyJobAsync(
        SiteCalibrationRecord job,
        bool continueOnSamePage)
    {
        _ = continueOnSamePage;

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

        var docaCredentials = CurrentDocaCredentials();
        _automationService.DocaCredentials = docaCredentials;

        SetStatus($"Step 1/6 · Opening View IC Verification for serial {job.SerialNumber}…", StatusKind.Working);
        SetStatus($"Step 2/6 · Loading instrument photo from Firebase for serial {job.SerialNumber}…", StatusKind.Working);

        if (string.IsNullOrWhiteSpace(job.RcId))
        {
            throw new InvalidOperationException("RC id is missing for this job.");
        }

        var instrument = await _instrumentDetailsService.ResolveForJobAsync(job, job.RcId, _session.IdToken);

        SetStatus($"Step 3/6 · Downloading certificate PDF from DOCA…", StatusKind.Working);
        SetStatus($"Step 4/6 · Stamping signed PDF…", StatusKind.Working);
        SetStatus($"Step 5/6 · Uploading signed PDF and instrument photo to DOCA…", StatusKind.Working);

        var result = await _automationService.RunCertificationLookupAsync(
            job,
            instrument,
            _session.IdToken,
            docaCredentials);

        var captured = _automationService.DocaCredentials;
        if (!string.IsNullOrWhiteSpace(captured.Email) || !string.IsNullOrWhiteSpace(captured.Password))
        {
            DocaEmailBox.Text = captured.Email;
            if (!string.IsNullOrWhiteSpace(captured.Password))
            {
                DocaPasswordBox.Password = captured.Password;
            }

            PersistCredentials();
        }

        return result;
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
            var jobId = job.Id;
            await _firestoreService.UpdateVerificationStatusAsync(jobId, newStatus, _session!.IdToken);
            SetStatus(
                $"Updated serial {job.SerialNumber} to {VerificationStatuses.Label(newStatus)}.",
                StatusKind.Success);
            await LoadQueuesAsync();
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

            SetStatus("Signed in. Loading submitted and approved queues…", StatusKind.Working);
            await LoadQueuesAsync();
        });
    }

    private async Task LoadQueuesAsync()
    {
        if (_session is null)
        {
            return;
        }

        var previousSubmittedId = _selectedSubmittedJob?.Id;
        var previousApprovedId = _selectedApprovedJob?.Id;

        var submitted = await _firestoreService.GetAllSubmittedVerificationsAsync(_session.IdToken);
        var approved = await _firestoreService.GetAllApprovedVerificationsAsync(_session.IdToken);

        _submittedJobs.Clear();
        foreach (var record in submitted)
        {
            _submittedJobs.Add(record);
        }

        _approvedJobs.Clear();
        foreach (var record in approved)
        {
            _approvedJobs.Add(record);
        }

        UpdateTabHeaders();
        RestoreSelection(previousSubmittedId, previousApprovedId);
        UpdateTabChrome();
        UpdateEmptyState();
        UpdateSelectionUi();

        var readyToCertify = _approvedJobs.Count(job => job.IsReadyToCertify);
        SetStatus(
            $"Loaded {_submittedJobs.Count} submitted and {_approvedJobs.Count} approved job(s) " +
            $"({readyToCertify} ready to certify on DOCA).",
            StatusKind.Success);
    }

    private void RestoreSelection(string? previousSubmittedId, string? previousApprovedId)
    {
        _selectedSubmittedJob = previousSubmittedId is null
            ? null
            : _submittedJobs.FirstOrDefault(job => job.Id == previousSubmittedId);
        _selectedApprovedJob = previousApprovedId is null
            ? null
            : _approvedJobs.FirstOrDefault(job => job.Id == previousApprovedId);

        if (_activeTab == QueueTab.Submitted)
        {
            JobsGrid.ItemsSource = _submittedJobs;
            JobsGrid.SelectedItem = _selectedSubmittedJob ?? (_submittedJobs.Count > 0 ? _submittedJobs[0] : null);
            _selectedSubmittedJob = JobsGrid.SelectedItem as SiteCalibrationRecord;
        }
        else
        {
            JobsGrid.ItemsSource = _approvedJobs;
            JobsGrid.SelectedItem = _selectedApprovedJob ?? (_approvedJobs.Count > 0 ? _approvedJobs[0] : null);
            _selectedApprovedJob = JobsGrid.SelectedItem as SiteCalibrationRecord;
        }
    }

    private void UpdateTabHeaders()
    {
        SubmittedTabItem.Header = $"Submitted ({_submittedJobs.Count})";
        var readyCount = _approvedJobs.Count(job => job.IsReadyToCertify);
        ApprovedTabItem.Header = readyCount == _approvedJobs.Count
            ? $"Approved ({_approvedJobs.Count})"
            : $"Approved ({_approvedJobs.Count}, {readyCount} to certify)";
    }

    private void UpdateTabChrome()
    {
        var isSubmittedTab = _activeTab == QueueTab.Submitted;
        SubmittedActionsPanel.Visibility = isSubmittedTab ? Visibility.Visible : Visibility.Collapsed;
        ApprovedActionsPanel.Visibility = isSubmittedTab ? Visibility.Collapsed : Visibility.Visible;

        DateColumn.Header = isSubmittedTab ? "Submitted" : "Approved";
        DateColumn.Binding = new System.Windows.Data.Binding(
            isSubmittedTab ? nameof(SiteCalibrationRecord.SubmittedAtDisplay) : nameof(SiteCalibrationRecord.ApprovedAtDisplay));
        CertificationColumn.Width = isSubmittedTab
            ? new DataGridLength(0)
            : new DataGridLength(1, DataGridLengthUnitType.Star);
    }

    private void UpdateEmptyState()
    {
        var count = ActiveJobs.Count;
        EmptyStateText.Visibility = count == 0 ? Visibility.Visible : Visibility.Collapsed;
        JobsGrid.Visibility = count == 0 ? Visibility.Collapsed : Visibility.Visible;

        if (_activeTab == QueueTab.Submitted)
        {
            EmptyStateTitleText.Text = "No submitted verifications";
            EmptyStateBodyText.Text = _session is null
                ? "Sign in and refresh to load submitted jobs from all RCs."
                : "No jobs are waiting for Super Admin approval.";
        }
        else
        {
            EmptyStateTitleText.Text = "No approved verifications";
            EmptyStateBodyText.Text = _session is null
                ? "Sign in and refresh to load approved jobs."
                : "Submit submitted jobs on DOCA first, then certify them here.";
        }
    }

    private int SelectedJobIndex()
    {
        var selected = SelectedJob;
        if (selected is null)
        {
            return -1;
        }

        for (var i = 0; i < ActiveJobs.Count; i++)
        {
            if (ActiveJobs[i].Id == selected.Id)
            {
                return i;
            }
        }

        return -1;
    }

    private void SelectJobAtIndex(int index)
    {
        if (index < 0 || index >= ActiveJobs.Count)
        {
            SetSelectedJob(null);
            JobsGrid.SelectedItem = null;
            UpdateSelectionUi();
            return;
        }

        var job = ActiveJobs[index];
        JobsGrid.SelectedItem = job;
        JobsGrid.ScrollIntoView(job);
        SetSelectedJob(job);
        UpdateSelectionUi();
    }

    private void SelectJobAtIndexAfterRemoval(int removedIndex)
    {
        if (ActiveJobs.Count == 0)
        {
            SelectJobAtIndex(-1);
            return;
        }

        SelectJobAtIndex(Math.Min(removedIndex, ActiveJobs.Count - 1));
    }

    private void UpdateSelectionUi()
    {
        var jobs = ActiveJobs;
        var canNavigate = !_isBusy && jobs.Count > 0;
        var selected = SelectedJob;
        var canAct = canNavigate && _session is not null && selected is not null;
        var index = SelectedJobIndex();

        PreviousJobButton.IsEnabled = canNavigate;
        NextJobButton.IsEnabled = canNavigate;

        if (jobs.Count == 0)
        {
            JobPositionText.Text = "No jobs loaded";
            SelectedJobText.Text = _session is null
                ? "Sign in as Super Admin and refresh the queues."
                : _activeTab == QueueTab.Submitted
                    ? "No submitted jobs are waiting for DOCA submission."
                    : "No approved jobs are ready yet.";
            ApproveAllJobsButton.IsEnabled = false;
            ApproveJobButton.IsEnabled = false;
            CertifyAllJobsButton.IsEnabled = false;
            CertifyJobButton.IsEnabled = false;
            StatusComboBox.IsEnabled = false;
            ApplyStatusButton.IsEnabled = false;
            return;
        }

        JobPositionText.Text = selected is null
            ? $"{jobs.Count} job(s) in tab"
            : $"Job {index + 1} of {jobs.Count}";

        if (selected is null)
        {
            SelectedJobText.Text = "Select a job from the queue or use Previous / Next job.";
            ApproveAllJobsButton.IsEnabled = _activeTab == QueueTab.Submitted && _session is not null && !_isBusy;
            ApproveAllJobsButton.Content = $"Submit all on DOCA & approve ({_submittedJobs.Count})";
            ApproveJobButton.IsEnabled = false;
            CertifyAllJobsButton.IsEnabled = false;
            CertifyJobButton.IsEnabled = false;
            SyncStatusComboToSelectedJob();
            UpdateStatusChangeUi();
            return;
        }

        var dateLabel = _activeTab == QueueTab.Submitted
            ? $"status {selected.StatusLabel} · submitted {selected.SubmittedAtDisplay}"
            : $"status {selected.StatusLabel} · approved {selected.ApprovedAtDisplay} · {selected.CertificationStatusLabel}";

        SelectedJobText.Text =
            $"{selected.RcCenterName}\n{selected.CustomerName}\n{selected.ProductName} · Serial {selected.SerialNumber}\n{selected.VerificationTypeLabel} · {dateLabel}";

        SyncStatusComboToSelectedJob();
        UpdateStatusChangeUi();

        if (_activeTab == QueueTab.Submitted)
        {
            ApproveAllJobsButton.IsEnabled = canNavigate && _session is not null;
            ApproveAllJobsButton.Content = $"Submit all on DOCA & approve ({_submittedJobs.Count})";
            ApproveJobButton.IsEnabled = canAct;
        }
        else
        {
            var readyCount = _approvedJobs.Count(job => job.IsReadyToCertify);
            CertifyAllJobsButton.IsEnabled = canNavigate && _session is not null && readyCount > 0;
            CertifyAllJobsButton.Content = $"Certify all approved jobs ({readyCount})";
            CertifyJobButton.IsEnabled = canAct && selected.IsReadyToCertify;
        }
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
        ApproveAllJobsButton.IsEnabled = false;
        ApproveJobButton.IsEnabled = false;
        CertifyAllJobsButton.IsEnabled = false;
        CertifyJobButton.IsEnabled = false;
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
