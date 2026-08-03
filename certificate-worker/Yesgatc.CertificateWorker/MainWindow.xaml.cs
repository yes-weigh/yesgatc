using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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
        bool BrowserDisconnected = false,
        bool HaltBatch = false);

    private sealed class ParallelBatchStats
    {
        public int Completed;
        public int Failed;
        public int LoginRequiredWorkers;
        public string? LastError;
    }

    private readonly ObservableCollection<CertificationQueueItem> _jobs = [];
    private readonly ObservableCollection<ActivityLogEntry> _activityLog = [];
    private readonly FirebaseAuthService _authService;
    private readonly FirestoreService _firestoreService;
    private readonly FirestoreQueueListener _queueListener;
    private readonly PartyDetailsService _partyDetailsService;
    private readonly InstrumentDetailsService _instrumentDetailsService;
    private readonly AutomationService _automationService;
    private readonly LocalCredentialsStore _credentialStore = new();
    private readonly JobRetryTracker _jobRetries = new();
    private readonly WorkerTelemetryService _telemetry;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private readonly List<AutomationService> _preparedBulkWorkers = [];
    private DateTimeOffset _lastStatusPublishUtc = DateTimeOffset.MinValue;

    private FirebaseSignInResult? _session;
    private CertificationQueueItem? _selectedQueueItem;
    private bool _isBusy;
    private bool _autoWorkerEnabled;
    private bool _autoWorkerPausedForDoca;
    private bool _startWithWindows = true;
    private bool _suppressStartWithWindowsCheckBoxEvent;
    /// <summary>Waiting on eMAAP OTP — stay on eMAAP, do not probe DOCA.</summary>
    private bool _emaapOtpIdle;
    private bool _emaapMasterOtpTried;
    private DispatcherTimer? _emaapOtpPollTimer;
    private bool _emaapOtpPollRunning;
    private bool _remotePaused;
    private bool _useRealtimeListener;
    private bool _realtimeListenerActive;
    private DispatcherTimer? _pollFallbackTimer;
    private DispatcherTimer? _retryBadgeTimer;
    private DispatcherTimer? _docaProbeTimer;
    private DispatcherTimer? _docaSessionWatchdogTimer;
    private DispatcherTimer? _telemetryTimer;
    private bool _autoWorkerCyclePending;
    private bool _sessionProbeRunning;
    private int _docaSessionProbeMinutes;
    private Task _docaBrowserStartupTask = Task.CompletedTask;
    private StatusKind _lastStatusKind = StatusKind.Idle;

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
        _telemetry = new WorkerTelemetryService(settings.Firebase);
        _automationService = new AutomationService(settings.Automation, _firestoreService);
        _automationService.Firebase = settings.Firebase;
        _automationService.ResolveFirebaseIdToken = GetFreshIdTokenAsync;
        _automationService.CaptchaAttemptReporter = ReportCaptchaAttemptAsync;
        _automationService.DocaCredentialsCaptured = creds => SyncDocaCredentialsToAllAutomation(creds);
        App.AutomationService = _automationService;

        JobsGrid.ItemsSource = _jobs;
        ActivityLogList.ItemsSource = _activityLog;
        LoadChromeProfilePicker(settings);
        LoadSavedCredentials(settings);
        ConfigureAutoWorkerFromSettings();
        ConfigureStartWithWindowsFromStore();

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private SiteCalibrationRecord? SelectedJob => _selectedQueueItem?.Record;

    private void SetSelectedQueueItem(CertificationQueueItem? item) => _selectedQueueItem = item;

    private void FocusWorkerTab()
    {
        if (MainTabs is not null)
        {
            MainTabs.SelectedIndex = 1;
        }
    }

    private void ExpandAccountPanel()
    {
        FocusWorkerTab();
        SignInExpander.IsExpanded = true;
    }

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
                CaptchaOcrKeys.ResolveApiKey(settings.Automation.CaptchaOcr) ?? string.Empty));
        CaptchaApiKeyBox.Text = captchaKey;
        CaptchaOcrKeys.RuntimeApiKeyOverride = string.IsNullOrWhiteSpace(captchaKey) ? null : captchaKey;
        UpdateCaptchaApiKeyHint();

        _docaSessionProbeMinutes = saved.DocaSessionProbeMinutes ?? settings.AutoWorker.DocaSessionProbeMinutes;
        DocaSessionProbeMinutesBox.Text = _docaSessionProbeMinutes.ToString();

        SyncDocaCredentialsToAllAutomation();
        UpdateSignInSummary();
    }

    private void LoadChromeProfilePicker(WorkerSettings settings)
    {
        var profiles = ChromeProfileCatalog.ListProfiles();
        ChromeProfileCombo.ItemsSource = profiles;

        var saved = _credentialStore.Load().ChromeProfileDirectory;
        var fromSettings = settings.Automation.ChromeProfileDirectory;
        var preferred = FirstNonEmpty(saved, fromSettings);

        if (!string.IsNullOrWhiteSpace(preferred))
        {
            ChromeProfilePreference.RuntimeDirectory = preferred;
            var match = profiles.FirstOrDefault(p =>
                p.DirectoryName.Equals(preferred, StringComparison.OrdinalIgnoreCase));
            ChromeProfileCombo.SelectedItem = match;
            if (match is null)
            {
                // Prefer still usable for launch even if combo list missed it.
                if (!profiles.Any(p =>
                        p.DirectoryName.Equals(preferred, StringComparison.OrdinalIgnoreCase)))
                {
                    ChromeProfilePreference.Clear();
                    preferred = string.Empty;
                    ChromeProfileCombo.SelectedIndex = -1;
                }
            }
        }
        else
        {
            ChromeProfilePreference.Clear();
            ChromeProfileCombo.SelectedIndex = -1;
        }

        UpdateChromeProfileHint();

        if (settings.Automation.UseSystemChromeProfile && !ChromeProfilePreference.HasSelection)
        {
            ExpandAccountPanel();
        }
    }

    private void UpdateChromeProfileHint()
    {
        if (!App.Settings.Automation.UseSystemChromeProfile)
        {
            ChromeProfileHint.Text = "System Chrome profile mirroring is off in settings.";
            return;
        }

        if (ChromeProfilePreference.HasSelection)
        {
            ChromeProfileHint.Text =
                $"Using saved profile: {ChromeProfilePreference.RuntimeDirectory}. Change anytime, then Save profile.";
            return;
        }

        ChromeProfileHint.Text = "Pick a Chrome profile before launching the browser (saved for next runs).";
    }

    private string? SelectedChromeProfileDirectory()
    {
        if (ChromeProfileCombo.SelectedItem is ChromeProfileInfo info
            && !string.IsNullOrWhiteSpace(info.DirectoryName))
        {
            return info.DirectoryName;
        }

        return ChromeProfilePreference.HasSelection
            ? ChromeProfilePreference.RuntimeDirectory
            : null;
    }

    private bool TryEnsureChromeProfileSelected(bool persist)
    {
        if (!App.Settings.Automation.UseSystemChromeProfile)
        {
            return true;
        }

        var directory = SelectedChromeProfileDirectory();
        if (string.IsNullOrWhiteSpace(directory))
        {
            SetStatus("Pick a Chrome profile in Account before launching the browser.", StatusKind.Info);
            ExpandAccountPanel();
            UpdateChromeProfileHint();
            return false;
        }

        ApplyChromeProfilePreference(directory, persist);
        return true;
    }

    private void ApplyChromeProfilePreference(string directoryName, bool persist)
    {
        var previous = ChromeProfilePreference.RuntimeDirectory;
        var next = directoryName.Trim();
        ChromeProfilePreference.RuntimeDirectory = next;

        if (!string.Equals(previous, next, StringComparison.OrdinalIgnoreCase))
        {
            ChromeProfileMirror.InvalidateMirror();
            AddActivityEntry($"Chrome profile set to {next} (mirror will resync on next launch).");
        }

        if (persist)
        {
            PersistCredentials();
        }

        UpdateChromeProfileHint();
    }

    private void SaveChromeProfileButton_Click(object sender, RoutedEventArgs e)
    {
        if (!TryEnsureChromeProfileSelected(persist: true))
        {
            return;
        }

        SetStatus(
            $"Chrome profile saved: {ChromeProfilePreference.RuntimeDirectory}. Next launches use this profile.",
            StatusKind.Success);
    }

    private async void ResetChromeProfileButton_Click(object sender, RoutedEventArgs e)
    {
        var confirm = MessageBox.Show(
            "Clear the saved Chrome profile preference and restart the worker?\n\n"
            + "You will pick a profile again before the browser opens.",
            "Reset Chrome profile",
            MessageBoxButton.YesNo,
            MessageBoxImage.Question);
        if (confirm != MessageBoxResult.Yes)
        {
            return;
        }

        ChromeProfilePreference.Clear();
        ChromeProfileCombo.SelectedIndex = -1;
        ChromeProfileMirror.InvalidateMirror();
        PersistCredentials();
        UpdateChromeProfileHint();
        AddActivityEntry("Chrome profile preference cleared — restarting…");

        try
        {
            await _automationService.DisposeAsync();
        }
        catch
        {
        }

        RestartApplication();
    }

    private static void RestartApplication()
    {
        var exe = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(exe) && File.Exists(exe))
        {
            Process.Start(new ProcessStartInfo(exe)
            {
                UseShellExecute = true,
                WorkingDirectory = AppContext.BaseDirectory,
            });
        }

        Application.Current.Shutdown();
    }

    private static string FirstNonEmpty(string primary, string fallback) =>
        string.IsNullOrWhiteSpace(primary) ? fallback : primary;

    private DocaCredentialSettings CurrentDocaCredentials() => new()
    {
        Email = DocaEmailBox.Text.Trim(),
        Password = DocaPasswordBox.Text,
    };

    private static bool HasDocaLoginCredentials(DocaCredentialSettings credentials) =>
        !string.IsNullOrWhiteSpace(credentials.Email)
        && !string.IsNullOrWhiteSpace(credentials.Password);

    private DocaCredentialSettings ResolveDocaCredentials()
    {
        var fromUi = CurrentDocaCredentials();
        if (HasDocaLoginCredentials(fromUi))
        {
            return fromUi;
        }

        var fromPrimary = _automationService.DocaCredentials;
        if (HasDocaLoginCredentials(fromPrimary))
        {
            return fromPrimary;
        }

        var fromStore = _credentialStore.Load().Doca;
        if (HasDocaLoginCredentials(fromStore))
        {
            return fromStore;
        }

        var fromSettings = App.Settings.Automation.DocaCredentials;
        if (HasDocaLoginCredentials(fromSettings))
        {
            return new DocaCredentialSettings
            {
                Email = fromSettings.Email.Trim(),
                Password = fromSettings.Password,
            };
        }

        return fromUi;
    }

    private DocaCredentialSettings ResolveDocaCredentialsOnUiThread() =>
        Dispatcher.CheckAccess()
            ? ResolveDocaCredentials()
            : Dispatcher.Invoke(ResolveDocaCredentials);

    private void SyncDocaCredentialsToAllAutomation(DocaCredentialSettings? credentials = null)
    {
        var resolved = credentials ?? ResolveDocaCredentials();
        _automationService.DocaCredentials = resolved;
        foreach (var worker in _preparedBulkWorkers)
        {
            worker.DocaCredentials = resolved;
        }
    }

    private int DocaSessionProbeMinutesSetting => _docaSessionProbeMinutes;

    private void PersistCredentials()
    {
        var chromeProfile = SelectedChromeProfileDirectory()
            ?? ChromeProfilePreference.RuntimeDirectory
            ?? string.Empty;
        // Never wipe a saved profile when combo is empty (e.g. during ctor).
        if (string.IsNullOrWhiteSpace(chromeProfile))
        {
            chromeProfile = _credentialStore.Load().ChromeProfileDirectory;
        }

        if (string.IsNullOrWhiteSpace(chromeProfile)
            && !string.IsNullOrWhiteSpace(App.Settings.Automation.ChromeProfileDirectory))
        {
            chromeProfile = App.Settings.Automation.ChromeProfileDirectory.Trim();
        }

        _credentialStore.SaveAll(
            AadharBox.Text,
            PasswordBox.Text,
            DocaEmailBox.Text,
            DocaPasswordBox.Text,
            CaptchaApiKeyBox.Text,
            docaFillOnly: false,
            _docaSessionProbeMinutes,
            chromeProfile,
            autoWorkerEnabled: _autoWorkerEnabled,
            startWithWindows: _startWithWindows);
    }

    private bool TryApplyDocaSessionProbeMinutesFromUi(bool persist, bool restartWatchdog)
    {
        if (!int.TryParse(DocaSessionProbeMinutesBox.Text.Trim(), out var minutes))
        {
            DocaSessionProbeMinutesBox.Text = _docaSessionProbeMinutes.ToString();
            SetStatus("Session probe must be a whole number of minutes (0 = off).", StatusKind.Error);
            return false;
        }

        minutes = Math.Clamp(minutes, 0, 24 * 60);
        if (minutes != _docaSessionProbeMinutes || DocaSessionProbeMinutesBox.Text.Trim() != minutes.ToString())
        {
            _docaSessionProbeMinutes = minutes;
            DocaSessionProbeMinutesBox.Text = minutes.ToString();
            if (persist)
            {
                PersistCredentials();
            }

            if (restartWatchdog)
            {
                StartDocaSessionWatchdogTimer();
            }

            UpdateAutoWorkerStatusText();
            var label = minutes == 0 ? "disabled" : $"every {minutes} min";
            AddActivityEntry($"DOCA session probe {label} (saved).");
        }

        return true;
    }

    private void DocaSessionProbeMinutesBox_LostFocus(object sender, RoutedEventArgs e)
    {
        TryApplyDocaSessionProbeMinutesFromUi(persist: true, restartWatchdog: true);
    }

    /// <summary>
    /// Shows the last 6 characters of the active key (e.g. "…8GcA") so the user
    /// can confirm which key is in use without exposing the full secret.
    /// </summary>
    private void UpdateCaptchaApiKeyHint()
    {
        var settings = App.Settings.Automation.CaptchaOcr;
        if (CaptchaOcrKeys.IsDeepSeek(settings))
        {
            CaptchaApiKeyHint.Text = "DeepSeek chat (no API key)";
            return;
        }

        var active = CaptchaOcrKeys.ResolveApiKey(settings);
        if (string.IsNullOrWhiteSpace(active))
        {
            CaptchaApiKeyHint.Text = CaptchaOcrKeys.IsGemini(settings) ? "Gemini key not set" : "not set";
            return;
        }

        var provider = CaptchaOcrKeys.IsGemini(settings) ? "Gemini" : settings.Provider;
        var tail = active.Length > 6 ? active[^6..] : active;
        CaptchaApiKeyHint.Text = $"{provider} …{tail}";
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        _telemetry.LogDiagnostic = message => LogToFile($"[telemetry] {message}");

        // Re-assert autostart on every launch (install path / scripts may have been updated).
        if (_startWithWindows)
        {
            try
            {
                WindowsAutostartService.EnsureRegistered();
            }
            catch (Exception ex)
            {
                LogToFile($"[autostart] ensure failed: {ex.Message}", ex);
            }
        }

        if (!string.IsNullOrWhiteSpace(AadharBox.Text) && !string.IsNullOrWhiteSpace(PasswordBox.Text))
        {
            await SignInAndLoadAsync();
            await StartDocaBrowserAsync();
            BeginWorkerServicesAfterDocaBrowser();
            return;
        }

        await StartDocaBrowserAsync();

        ExpandAccountPanel();
        SetStatus(
            _automationService.IsBrowserConnected
                ? "DOCA browser is open. Enter Super Admin credentials and sign in."
                : "Enter Super Admin credentials and sign in to load the queue.",
            StatusKind.Idle);
    }

    private Task StartDocaBrowserAsync()
    {
        _docaBrowserStartupTask = StartDocaBrowserCoreAsync();
        return _docaBrowserStartupTask;
    }

    private async Task StartDocaBrowserCoreAsync()
    {
        try
        {
            SyncDocaCredentialsToAllAutomation();
            var creds = ResolveDocaCredentials();
            if (!HasDocaLoginCredentials(creds))
            {
                SetStatus(
                    "Set eMAAP email/password in Account (or appsettings.local.json), Save Credentials, then sign in again.",
                    StatusKind.Info);
                ExpandAccountPanel();
                return;
            }

            // Keep Account boxes in sync so later Resolve doesn't see empty UI.
            if (string.IsNullOrWhiteSpace(DocaEmailBox.Text))
            {
                DocaEmailBox.Text = creds.Email;
            }

            if (string.IsNullOrWhiteSpace(DocaPasswordBox.Text))
            {
                DocaPasswordBox.Text = creds.Password;
            }

            SyncDocaCredentialsToAllAutomation(creds);

            if (!TryEnsureChromeProfileSelected(persist: true))
            {
                return;
            }

            if (CaptchaOcrKeys.RequiresApiKey(App.Settings.Automation.CaptchaOcr)
                && string.IsNullOrWhiteSpace(CaptchaOcrKeys.ResolveApiKey(App.Settings.Automation.CaptchaOcr)))
            {
                SetStatus(
                    "Captcha AI key missing — put ApiKey in appsettings.local.json or Captcha AI Key box, Save, retry.",
                    StatusKind.Info);
                ExpandAccountPanel();
            }

            var profileLabel = ChromeProfilePreference.RuntimeDirectory ?? "Default";
            var ocrLabel = CaptchaOcrKeys.DescribeProvider(App.Settings.Automation.CaptchaOcr);
            SetStatus(
                $"Opening eMAAP (Chrome: {profileLabel}) — captcha via {ocrLabel}, OTP via Firebase inbox…",
                StatusKind.Working);
            var state = await _automationService.OpenDocaWorkspaceAsync();

            if (state == DocaSessionState.OtpRequired)
            {
                _emaapOtpIdle = true;
                _emaapMasterOtpTried = true; // already tried during login gate (or skipped)
                SetDocaLoginPaused(true, startResumeProbe: false);
                StartEmaapOtpIdlePoller();
                var otpWhy = FirestoreEmaapOtpReader.LastFailureReason
                    ?? GmailOtpReader.LastFailureReason;
                SetStatus(
                    string.IsNullOrWhiteSpace(otpWhy)
                        ? "OTP sent. Waiting Firebase — keep Apps Script running, or paste OTP."
                        : $"OTP idle (still polling Firebase): {otpWhy}",
                    StatusKind.Info);
                if (!string.IsNullOrWhiteSpace(otpWhy))
                {
                    AddActivityEntry(otpWhy);
                }

                ExpandAccountPanel();
                return;
            }

            if (state == DocaSessionState.LoginRequired)
            {
                _emaapOtpIdle = false;
                SetDocaLoginPaused(true, startResumeProbe: false);
                SetStatus(
                    "Login not finished — browser left open on eMAAP. Fix captcha/creds, then retry Sign in.",
                    StatusKind.Info);
                ExpandAccountPanel();
                return;
            }

            _emaapOtpIdle = false;
            SetStatus("Logged in to eMAAP.", StatusKind.Success);
            _telemetry.MarkDocaLoggedIn();
            StartDocaSessionWatchdogTimer();
            if (_session is not null)
            {
                _ = LoadQueueAsync();
            }
        }
        catch (Exception ex)
        {
            SetStatus($"eMAAP login error: {ex.Message}", ex, StatusKind.Error);
            ExpandAccountPanel();
        }
    }

    private async void SubmitEmaapOtpButton_Click(object sender, RoutedEventArgs e)
    {
        var otp = EmaapOtpBox.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(otp))
        {
            SetStatus("Paste the OTP from your email first.", StatusKind.Info);
            return;
        }

        SubmitEmaapOtpButton.IsEnabled = false;
        try
        {
            SyncDocaCredentialsToAllAutomation();
            SetStatus("Submitting eMAAP OTP + solving captcha…", StatusKind.Working);
            var state = await _automationService.SubmitEmaapOtpAsync(otp);
            if (state == DocaSessionState.LoggedIn)
            {
                EmaapOtpBox.Text = string.Empty;
                _emaapOtpIdle = false;
                StopEmaapOtpIdlePoller();
                SetDocaLoginPaused(false);
                SetStatus("eMAAP login complete (OTP accepted).", StatusKind.Success);
                _telemetry.MarkDocaLoggedIn();
                StartDocaSessionWatchdogTimer();
                if (_session is not null)
                {
                    _ = LoadQueueAsync();
                }
                return;
            }

            SetStatus(
                state == DocaSessionState.OtpRequired
                    ? "OTP not accepted yet — check code / captcha and try again."
                    : "Still on login page — retry Send OTP from Chrome or restart browser open.",
                StatusKind.Info);
        }
        catch (Exception ex)
        {
            SetStatus($"OTP submit failed: {ex.Message}", ex, StatusKind.Error);
        }
        finally
        {
            SubmitEmaapOtpButton.IsEnabled = true;
        }
    }

    private void BeginWorkerServicesAfterDocaBrowser()
    {
        if (_session is null)
        {
            return;
        }

        if (!_autoWorkerEnabled)
        {
            return;
        }

        StartAutoWorkerTimers();
        if (_remotePaused)
        {
            return;
        }

        if (_autoWorkerPausedForDoca)
        {
            // OTP / login idle — do not hammer DOCA or eMAAP probes.
            if (!_emaapOtpIdle)
            {
                _ = TryResumeAutoWorkerAfterDocaLoginAsync();
            }

            return;
        }

        _ = RunAutoWorkerCycleAsync();
    }

    private async void MainWindow_Closed(object? sender, EventArgs e)
    {
        StopAutoWorkerTimers();
        StopTelemetryTimer();
        await _queueListener.StopAsync();
        await DisposePreparedBulkWorkersAsync();
        await _automationService.DisposeAsync();
        _tokenLock.Dispose();
    }

    private bool _suppressAutoRunCheckBoxEvent;

    private void ConfigureAutoWorkerFromSettings()
    {
        var settings = App.Settings.AutoWorker;
        var saved = _credentialStore.Load();
        // Persist last checkbox choice; fall back to appsettings when never saved.
        _autoWorkerEnabled = saved.AutoWorkerEnabled ?? settings.Enabled;
        _useRealtimeListener = settings.UseRealtimeListener;
        _suppressAutoRunCheckBoxEvent = true;
        try
        {
            AutoRunCheckBox.IsChecked = _autoWorkerEnabled;
        }
        finally
        {
            _suppressAutoRunCheckBoxEvent = false;
        }

        UpdateAutoWorkerStatusText();
    }

    private void ConfigureStartWithWindowsFromStore()
    {
        var saved = _credentialStore.Load();
        // Default ON so server reboots bring the worker back after logon.
        _startWithWindows = saved.StartWithWindows ?? true;
        _suppressStartWithWindowsCheckBoxEvent = true;
        try
        {
            StartWithWindowsCheckBox.IsChecked = _startWithWindows;
        }
        finally
        {
            _suppressStartWithWindowsCheckBoxEvent = false;
        }

        ApplyStartWithWindowsPreference(persist: true, announce: false);
    }

    private void StartWithWindowsCheckBox_Changed(object sender, RoutedEventArgs e)
    {
        if (_suppressStartWithWindowsCheckBoxEvent)
        {
            return;
        }

        _startWithWindows = StartWithWindowsCheckBox.IsChecked == true;
        ApplyStartWithWindowsPreference(persist: true, announce: true);
    }

    private void ApplyStartWithWindowsPreference(bool persist, bool announce)
    {
        try
        {
            if (_startWithWindows)
            {
                WindowsAutostartService.EnsureRegistered();
                if (announce)
                {
                    AddActivityEntry("Start with Windows ON — registered for logon / reboot.");
                    SetStatus(
                        "Start with Windows enabled. After reboot, sign in (or use auto-logon) and the worker starts.",
                        StatusKind.Success);
                }
            }
            else
            {
                WindowsAutostartService.Unregister();
                if (announce)
                {
                    AddActivityEntry("Start with Windows OFF — removed from startup.");
                    SetStatus("Start with Windows disabled.", StatusKind.Info);
                }
            }
        }
        catch (Exception ex)
        {
            LogToFile($"[autostart] {ex.Message}", ex);
            if (announce)
            {
                SetStatus($"Could not update Start with Windows: {ex.Message}", ex, StatusKind.Error);
            }
        }

        if (persist)
        {
            PersistCredentials();
        }
    }

    private void AutoRunCheckBox_Changed(object sender, RoutedEventArgs e)
    {
        if (_suppressAutoRunCheckBoxEvent)
        {
            return;
        }

        var on = AutoRunCheckBox.IsChecked == true;
        _autoWorkerEnabled = on;
        PersistCredentials();

        if (on)
        {
            AddActivityEntry("Auto-run ON — batch processing enabled.");
            SetStatus("Auto-run on — worker will process Submitted jobs unattended.", StatusKind.Info);
            UpdateAutoWorkerStatusText();

            if (_session is not null && !_remotePaused && !_autoWorkerPausedForDoca)
            {
                StartAutoWorkerTimers();
                // Defer cycle so checkbox paint / tab input stay responsive.
                _ = Dispatcher.BeginInvoke(
                    DispatcherPriority.ApplicationIdle,
                    new Action(() =>
                    {
                        if (_autoWorkerEnabled && _session is not null && !_remotePaused && !_autoWorkerPausedForDoca)
                        {
                            _ = RunAutoWorkerCycleAsync();
                        }
                    }));
            }

            return;
        }

        StopAutoWorkerTimers();
        AddActivityEntry("Auto-run OFF — use Process all submitted.");
        SetStatus("Auto-run off — use Process all submitted.", StatusKind.Info);
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
                ex,
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
            ApplyQueueRecords(records, "Queue updated from Firestore.", quietStatus: true);
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
        }, DispatcherPriority.Background);
    }

    private void OnQueueListenerError(string message)
    {
        _ = Dispatcher.InvokeAsync(() => SetStatus(message, StatusKind.Info));
    }

    private void StartAutoWorkerTimers()
    {
        StopAutoWorkerTimers();
        StartTelemetryTimer();

        if (!_autoWorkerEnabled || _session is null || _remotePaused)
        {
            return;
        }

        if (!_useRealtimeListener || !_realtimeListenerActive)
        {
            StartPollFallbackTimer();
        }

        StartRetryBadgeTimer();
        StartDocaSessionWatchdogTimer();
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
        StopDocaSessionWatchdogTimer();
    }

    private void StartTelemetryTimer()
    {
        StopTelemetryTimer();

        if (_session is null)
        {
            return;
        }

        _telemetryTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(30),
        };
        _telemetryTimer.Tick += TelemetryTimer_Tick;
        _telemetryTimer.Start();
        _ = PublishWorkerStatusAsync();
        _ = PollRemoteControlAsync();
    }

    private void StopTelemetryTimer()
    {
        if (_telemetryTimer is null)
        {
            return;
        }

        _telemetryTimer.Tick -= TelemetryTimer_Tick;
        _telemetryTimer.Stop();
        _telemetryTimer = null;
    }

    private async void TelemetryTimer_Tick(object? sender, EventArgs e)
    {
        await PublishWorkerStatusAsync();
        await PollRemoteControlAsync();
    }

    private readonly List<CaptchaAttemptReport> _pendingCaptchaReports = [];

    private async Task ReportCaptchaAttemptAsync(CaptchaAttemptReport report)
    {
        ShowCaptchaAttemptInActivity(report);

        if (_session is null)
        {
            lock (_pendingCaptchaReports)
            {
                _pendingCaptchaReports.Add(report);
            }

            return;
        }

        await _telemetry.ReportCaptchaAttemptAsync(report, () => GetFreshIdTokenAsync());
    }

    private void ShowCaptchaAttemptInActivity(CaptchaAttemptReport report)
    {
        void Add()
        {
            var resolved = string.IsNullOrWhiteSpace(report.ResolvedText)
                ? "(unreadable)"
                : report.ResolvedText.Trim();
            var outcome = report.Success ? "ok" : report.Outcome;
            var message =
                $"{DateTime.Now:HH:mm:ss}  Captcha #{report.AttemptNumber} · {report.OcrProvider} → {resolved} ({outcome})";

            byte[]? aiBytes = null;
            try
            {
                // DeepSeek gets the original image; Gemini/OpenAI still use black-only preview.
                aiBytes = CaptchaOcrKeys.IsDeepSeek(App.Settings.Automation.CaptchaOcr)
                    ? report.ImageBytes
                    : DocaCaptchaOcr.BuildBlackOnlyVisionPngBytes(report.ImageBytes);
            }
            catch
            {
                // preview still shows original
            }

            AddActivityEntry(new ActivityLogEntry
            {
                Text = message,
                CaptchaImage = TryCreateCaptchaBitmap(report.ImageBytes),
                CaptchaAiImage = TryCreateCaptchaBitmap(aiBytes ?? []),
                CaptchaResolvedText = resolved,
            });
        }

        if (Dispatcher.CheckAccess())
        {
            Add();
        }
        else
        {
            _ = Dispatcher.InvokeAsync(Add, DispatcherPriority.Background);
        }
    }

    private static BitmapImage? TryCreateCaptchaBitmap(byte[] imageBytes)
    {
        if (imageBytes is not { Length: > 0 })
        {
            return null;
        }

        try
        {
            using var stream = new MemoryStream(imageBytes);
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.StreamSource = stream;
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }
        catch
        {
            return null;
        }
    }

    private async Task FlushPendingCaptchaReportsAsync()
    {
        List<CaptchaAttemptReport> pending;
        lock (_pendingCaptchaReports)
        {
            if (_pendingCaptchaReports.Count == 0)
            {
                return;
            }

            pending = [.. _pendingCaptchaReports];
            _pendingCaptchaReports.Clear();
        }

        foreach (var report in pending)
        {
            await _telemetry.ReportCaptchaAttemptAsync(report, () => GetFreshIdTokenAsync());
        }
    }

    private async Task PublishWorkerStatusAsync()
    {
        if (_session is null)
        {
            return;
        }

        var submitted = _jobs.Count(item => item.Record.IsSubmitted);
        var eligible = _jobs.Count(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id));

        var state = _lastStatusKind switch
        {
            StatusKind.Working => "working",
            StatusKind.Error => "error",
            StatusKind.Success => "idle",
            _ when _autoWorkerPausedForDoca => "login_required",
            _ when _remotePaused => "paused",
            _ => "idle",
        };

        var docaSessionAgeSeconds = _telemetry.DocaLoggedInAt is { } loggedInAt
            ? (int)Math.Max(0, (DateTimeOffset.UtcNow - loggedInAt).TotalSeconds)
            : 0;

        await _telemetry.PublishStatusAsync(
            new WorkerStatusSnapshot
            {
                State = state,
                StatusMessage = StatusText.Text,
                AutoWorkerEnabled = _autoWorkerEnabled,
                RemotePaused = _remotePaused,
                DocaSessionState = _autoWorkerPausedForDoca ? "login_required" : "logged_in",
                QueueTotal = _jobs.Count,
                QueueEligible = eligible,
                QueueSubmitted = submitted,
                JobsCompletedSession = _telemetry.JobsCompletedSession,
                JobsFailedSession = _telemetry.JobsFailedSession,
                LastSessionProbeAt = _telemetry.LastSessionProbeAt?.ToString("O") ?? string.Empty,
                LastSessionProbeResult = _telemetry.LastSessionProbeResult,
                DocaSessionAgeSeconds = docaSessionAgeSeconds,
            },
            () => GetFreshIdTokenAsync());
    }

    private async Task PollRemoteControlAsync()
    {
        if (_session is null)
        {
            return;
        }

        var remote = await _telemetry.PollRemoteControlAsync(() => GetFreshIdTokenAsync());
        if (remote is null)
        {
            return;
        }

        if (_telemetry.ShouldApplyCredentials(remote))
        {
            await ApplyRemoteCredentialsAsync(remote);
        }

        if (_telemetry.ShouldApplyCommand(remote))
        {
            await ApplyRemoteCommandAsync(remote);
        }
    }

    private async Task ApplyRemoteCredentialsAsync(WorkerRemoteControlState remote)
    {
        var changed = false;

        if (!string.IsNullOrWhiteSpace(remote.SuperAdminAadhar))
        {
            AadharBox.Text = remote.SuperAdminAadhar.Trim();
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(remote.SuperAdminPassword))
        {
            PasswordBox.Text = remote.SuperAdminPassword;
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(remote.DocaEmail))
        {
            DocaEmailBox.Text = remote.DocaEmail.Trim();
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(remote.DocaPassword))
        {
            DocaPasswordBox.Text = remote.DocaPassword;
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(remote.CaptchaApiKey))
        {
            CaptchaApiKeyBox.Text = remote.CaptchaApiKey.Trim();
            CaptchaOcrKeys.RuntimeApiKeyOverride = remote.CaptchaApiKey.Trim();
            UpdateCaptchaApiKeyHint();
            changed = true;
        }

        if (changed)
        {
            PersistCredentials();
            SyncDocaCredentialsToAllAutomation();
            foreach (var worker in _preparedBulkWorkers)
            {
                worker.CaptchaAttemptReporter = ReportCaptchaAttemptAsync;
            }

            AddActivityEntry("Applied remote credential update from web admin.");
            SetStatus("Remote credentials applied from web admin.", StatusKind.Success);
        }

        _telemetry.MarkCredentialsApplied(remote.CredentialsRevision);
        await _telemetry.ClearAppliedCredentialsAsync(remote.CredentialsRevision, () => GetFreshIdTokenAsync());
    }

    private async Task ApplyRemoteCommandAsync(WorkerRemoteControlState remote)
    {
        if (remote.AutoWorkerEnabled.HasValue)
        {
            _autoWorkerEnabled = remote.AutoWorkerEnabled.Value;
            _suppressAutoRunCheckBoxEvent = true;
            try
            {
                AutoRunCheckBox.IsChecked = _autoWorkerEnabled;
            }
            finally
            {
                _suppressAutoRunCheckBoxEvent = false;
            }

            PersistCredentials();

            if (_autoWorkerEnabled && _session is not null && !_remotePaused)
            {
                StartAutoWorkerTimers();
            }
            else
            {
                StopAutoWorkerTimers();
                StartTelemetryTimer();
            }
        }

        var wasPaused = _remotePaused;
        _remotePaused = remote.PauseWorker;
        if (_remotePaused && !wasPaused)
        {
            AddActivityEntry("Auto worker paused from web admin.");
        }
        else if (!_remotePaused && wasPaused)
        {
            AddActivityEntry("Auto worker resumed from web admin.");
            if (_autoWorkerEnabled && _session is not null)
            {
                StartAutoWorkerTimers();
                _ = RunAutoWorkerCycleAsync();
            }
        }

        _telemetry.MarkCommandApplied(remote.CommandRevision);
        UpdateAutoWorkerStatusText();
        await PublishWorkerStatusAsync();
    }

    private void SetDocaLoginPaused(
        bool paused,
        string logoutReason = "login_required",
        bool startResumeProbe = true,
        bool blockAutoLogin = false)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.Invoke(() => SetDocaLoginPaused(paused, logoutReason, startResumeProbe, blockAutoLogin));
            return;
        }

        var wasPaused = _autoWorkerPausedForDoca;
        _autoWorkerPausedForDoca = paused;
        // Only block auto-login when operator is typing credentials manually.
        ApplyManualDocaLoginWaitToAllAutomation(paused && blockAutoLogin);

        if (paused && !wasPaused)
        {
            StopDocaSessionWatchdogTimer();
            _ = _telemetry.MarkDocaLoggedOutAsync(() => GetFreshIdTokenAsync(), logoutReason);
        }

        if (paused)
        {
            if (startResumeProbe && !_emaapOtpIdle)
            {
                StartDocaProbeTimer();
            }
            else
            {
                StopDocaProbeTimer();
            }
        }
        else
        {
            _emaapOtpIdle = false;
            StopEmaapOtpIdlePoller();
            StopDocaProbeTimer();
            _telemetry.MarkDocaLoggedIn();
            StartDocaSessionWatchdogTimer();
        }

        UpdateAutoWorkerStatusText();
        _ = PublishWorkerStatusAsync();
    }

    private void ApplyManualDocaLoginWaitToAllAutomation(bool paused)
    {
        _automationService.ManualDocaLoginWait = paused;
        foreach (var worker in _preparedBulkWorkers)
        {
            worker.ManualDocaLoginWait = paused;
        }
    }

    private void StartEmaapOtpIdlePoller()
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.Invoke(StartEmaapOtpIdlePoller);
            return;
        }

        StopEmaapOtpIdlePoller();
        _emaapOtpPollTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(5),
        };
        _emaapOtpPollTimer.Tick += EmaapOtpIdlePollTimer_Tick;
        _emaapOtpPollTimer.Start();
    }

    private void StopEmaapOtpIdlePoller()
    {
        if (_emaapOtpPollTimer is null)
        {
            return;
        }

        _emaapOtpPollTimer.Stop();
        _emaapOtpPollTimer.Tick -= EmaapOtpIdlePollTimer_Tick;
        _emaapOtpPollTimer = null;
    }

    private async void EmaapOtpIdlePollTimer_Tick(object? sender, EventArgs e)
    {
        if (!_emaapOtpIdle || _emaapOtpPollRunning || _session is null)
        {
            return;
        }

        var requestedAt = EmaapLoginAutomation.LastOtpRequestedAtUtc
            ?? DateTimeOffset.UtcNow.AddMinutes(-5);
        _emaapOtpPollRunning = true;
        try
        {
            // After ~5 min countdown, auto-click Resend OTP so a fresh mail can arrive.
            try
            {
                if (await _automationService.TryResendEmaapOtpIfEnabledAsync())
                {
                    AddActivityEntry("Clicked Resend OTP — trying master OTP, then Firebase…");
                    SetStatus("Resend OTP clicked — trying master OTP…", StatusKind.Working);
                    requestedAt = EmaapLoginAutomation.LastOtpRequestedAtUtc
                        ?? DateTimeOffset.UtcNow;
                    _emaapMasterOtpTried = false; // allow master again after resend
                }
            }
            catch (Exception ex)
            {
                AddActivityEntry($"Resend OTP check: {ex.Message}");
            }

            if (!_emaapMasterOtpTried
                && !string.IsNullOrWhiteSpace(App.Settings.Automation.EmaapMasterOtp))
            {
                _emaapMasterOtpTried = true;
                AddActivityEntry("Trying master OTP…");
                var masterState = await _automationService.TrySubmitMasterEmaapOtpAsync();
                if (masterState == DocaSessionState.LoggedIn)
                {
                    EmaapOtpBox.Text = string.Empty;
                    _emaapOtpIdle = false;
                    StopEmaapOtpIdlePoller();
                    SetDocaLoginPaused(false);
                    SetStatus("eMAAP login complete (master OTP).", StatusKind.Success);
                    _telemetry.MarkDocaLoggedIn();
                    StartDocaSessionWatchdogTimer();
                    _ = LoadQueueAsync();
                    return;
                }

                AddActivityEntry("Master OTP failed — falling back to Firebase OTP.");
            }

            var code = await FirestoreEmaapOtpReader.TryClaimOnceAsync(
                App.Settings.Firebase,
                GetFreshIdTokenAsync,
                requestedAt,
                CancellationToken.None);
            if (string.IsNullOrWhiteSpace(code) || !_emaapOtpIdle)
            {
                return;
            }

            AddActivityEntry($"Firebase OTP received ({code}) — submitting…");
            SetStatus("Firebase OTP landed — submitting…", StatusKind.Working);
            var state = await _automationService.SubmitEmaapOtpAsync(code);
            if (state == DocaSessionState.LoggedIn)
            {
                EmaapOtpBox.Text = string.Empty;
                _emaapOtpIdle = false;
                StopEmaapOtpIdlePoller();
                SetDocaLoginPaused(false);
                SetStatus("eMAAP login complete (Firebase OTP).", StatusKind.Success);
                _telemetry.MarkDocaLoggedIn();
                StartDocaSessionWatchdogTimer();
                _ = LoadQueueAsync();
            }
            else
            {
                SetStatus(
                    "Firebase OTP submit did not finish — paste / retry Submit OTP.",
                    StatusKind.Info);
            }
        }
        catch (Exception ex)
        {
            AddActivityEntry($"OTP idle poll: {ex.Message}");
        }
        finally
        {
            _emaapOtpPollRunning = false;
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

    private void StartDocaSessionWatchdogTimer()
    {
        StopDocaSessionWatchdogTimer();

        var probeMinutes = DocaSessionProbeMinutesSetting;
        if (probeMinutes <= 0 || _session is null || !_autoWorkerEnabled || _remotePaused || _autoWorkerPausedForDoca)
        {
            return;
        }

        _docaSessionWatchdogTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromMinutes(Math.Max(1, probeMinutes)),
        };
        _docaSessionWatchdogTimer.Tick += DocaSessionWatchdogTimer_Tick;
        _docaSessionWatchdogTimer.Start();
    }

    private void StopDocaSessionWatchdogTimer()
    {
        if (_docaSessionWatchdogTimer is null)
        {
            return;
        }

        _docaSessionWatchdogTimer.Tick -= DocaSessionWatchdogTimer_Tick;
        _docaSessionWatchdogTimer.Stop();
        _docaSessionWatchdogTimer = null;
    }

    private async void DocaSessionWatchdogTimer_Tick(object? sender, EventArgs e)
    {
        if (_sessionProbeRunning
            || _isBusy
            || _remotePaused
            || !_autoWorkerEnabled
            || _autoWorkerPausedForDoca
            || _session is null
            || !_automationService.IsBrowserConnected)
        {
            return;
        }

        _sessionProbeRunning = true;
        try
        {
            DocaSessionProbeResult probe;
            try
            {
                probe = await _automationService.ProbeDocaSessionAtProtectedRouteAsync(forceAutoLogin: false);
            }
            catch (Exception ex) when (AutomationService.IsBrowserDisconnectedError(ex))
            {
                _telemetry.RecordSessionProbe("browser_disconnected");
                await PublishWorkerStatusAsync();
                return;
            }
            catch (Exception ex)
            {
                _telemetry.RecordSessionProbe("error");
                LogToFile($"[session-probe] {ex.Message}");
                await PublishWorkerStatusAsync();
                return;
            }

            if (probe.State == DocaSessionState.LoggedIn)
            {
                _telemetry.RecordSessionProbe("valid");
                await PublishWorkerStatusAsync();
                return;
            }

            _telemetry.RecordSessionProbe("expired");
            await _telemetry.ReportActivityAsync(
                "DOCA session expired (detected by periodic IC verification probe). Retrying auto-login…",
                "warning",
                () => GetFreshIdTokenAsync());
            SetDocaLoginPaused(true, logoutReason: "session_probe");
            await TryResumeAutoWorkerAfterDocaLoginAsync();
        }
        finally
        {
            _sessionProbeRunning = false;
        }
    }

    private async void DocaProbeTimer_Tick(object? sender, EventArgs e)
    {
        if (!_autoWorkerPausedForDoca || _session is null || _emaapOtpIdle)
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
            if (!_emaapOtpIdle)
            {
                await TryResumeAutoWorkerAfterDocaLoginAsync();
            }

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
        if (_emaapOtpIdle)
        {
            return;
        }

        try
        {
            var state = await _automationService.ProbeDocaSessionAsync();
            if (state == DocaSessionState.OtpRequired)
            {
                _emaapOtpIdle = true;
                StopDocaProbeTimer();
                StartEmaapOtpIdlePoller();
                SetStatus("eMAAP waiting for OTP — polling Firebase / master OTP…", StatusKind.Info);
                AddActivityEntry("eMAAP signed out — auto re-login waiting for OTP.");
                return;
            }

            if (state != DocaSessionState.LoggedIn)
            {
                UpdateAutoWorkerStatusText();
                return;
            }

            SetDocaLoginPaused(false);
            SetStatus("eMAAP session restored — auto worker resuming.", StatusKind.Success);
            AddActivityEntry("eMAAP session restored — auto worker resuming.");
            UpdateAutoWorkerStatusText();
            await RunAutoWorkerCycleAsync();
        }
        catch (Exception ex)
        {
            SetStatus($"Waiting for eMAAP login — {ex.Message}", ex, StatusKind.Info);
            UpdateAutoWorkerStatusText();
        }
    }

    private async Task RunAutoWorkerCycleAsync()
    {
        if (!_autoWorkerEnabled || _session is null || _autoWorkerPausedForDoca || _remotePaused)
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
            await LoadQueueAsync().ConfigureAwait(false);
        }

        var queue = await RunOnUiAsync(() => _jobs
            .Where(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id))
            .Select(item => item.Record)
            .ToList()).ConfigureAwait(false);

        if (queue.Count == 0)
        {
            await RunOnUiAsync(UpdateAutoWorkerStatusText).ConfigureAwait(false);
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            SetStatusSafe($"Auto worker — processing {queue.Count} eligible job(s)…", StatusKind.Working);
            await ProcessQueueInternalAsync(queue, sequentialOnly: true, fromAutoWorker: true)
                .ConfigureAwait(false);
            await RunOnUiAsync(UpdateAutoWorkerStatusText).ConfigureAwait(false);
        }, offUiThread: true).ConfigureAwait(false);
    }

    private void RefreshRetryBadges()
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(RefreshRetryBadges, DispatcherPriority.Background);
            return;
        }

        foreach (var item in _jobs)
        {
            item.RetryBadge = _jobRetries.BadgeFor(item.Id);
        }

        UpdateAutoWorkerStatusText();
    }

    /// <summary>Single stage — Submitted → eMAAP fill+certify. Only MaxSubmitRetries applies.</summary>
    private static int ResolveMaxRetriesFor(SiteCalibrationRecord job) =>
        Math.Max(1, App.Settings.AutoWorker.MaxSubmitRetries);

    private void ScheduleJobRetry(SiteCalibrationRecord job, string error)
    {
        if (PipelineFailureClassifier.IsPermanentDataFailure(error))
        {
            _jobRetries.MarkExhausted(job.Id, error, ResolveMaxRetriesFor(job));
            RefreshRetryBadges();
            return;
        }

        _jobRetries.Schedule(
            job.Id,
            error,
            TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds),
            ResolveMaxRetriesFor(job));
        RefreshRetryBadges();
    }

    private async Task RecordPipelineFailureAsync(SiteCalibrationRecord job, string error, bool? exhausted = null)
    {
        if (_session is null)
        {
            return;
        }

        // HALT / mandatory eMAAP failures persist immediately (PDF resume needs cert #).
        var retryExhausted = exhausted
            ?? (error.Contains("HALT", StringComparison.OrdinalIgnoreCase)
                || _jobRetries.IsExhausted(job.Id));

        var outcome = PipelineFailureClassifier.Classify(error, retryExhausted);
        if (outcome == PipelineFailureClassifier.Outcome.Retry)
        {
            return;
        }

        try
        {
            var token = await GetFreshIdTokenAsync();
            if (outcome == PipelineFailureClassifier.Outcome.Rejected)
            {
                await _firestoreService.RecordRejectionAsync(job.Id, error, token);
                _jobRetries.MarkExhausted(job.Id, error, ResolveMaxRetriesFor(job));
                RefreshRetryBadges();
            }
            else
            {
                await _firestoreService.RecordSubmitFailureAsync(job.Id, error, token, retryExhausted: true);
            }
        }
        catch
        {
            // Best-effort Firebase patch — local retry state still applies.
        }
    }

    private void UpdateAutoWorkerStatusText()
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(UpdateAutoWorkerStatusText, DispatcherPriority.Background);
            return;
        }

        if (!_autoWorkerEnabled)
        {
            AutoWorkerStatusText.Text = "Auto-run off — use Process all submitted.";
            return;
        }

        if (_remotePaused)
        {
            AutoWorkerStatusText.Text = "Paused from web admin — resume in Integrations → Automation Worker.";
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
                "Paused — eMAAP login / HALT. Finish login, then turn Auto-run on.";
            return;
        }

        var waitingRetries = _jobRetries.Snapshot().Count(pair => DateTimeOffset.Now < pair.Value.RetryAt);
        var eligible = _jobs.Count(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id));
        var watchMode = _realtimeListenerActive
            ? "watching Firestore live"
            : $"polling every {App.Settings.AutoWorker.PollIntervalSeconds}s";
        var probeMinutes = DocaSessionProbeMinutesSetting;
        var probeNote = probeMinutes > 0 ? $" · eMAAP session probe every {probeMinutes} min" : string.Empty;
        AutoWorkerStatusText.Text = waitingRetries > 0
            ? $"Running — {eligible} job(s) ready, {waitingRetries} waiting for retry ({watchMode}{probeNote})."
            : $"Running — {watchMode} · {eligible} job(s) ready{probeNote}.";
    }

    private async void SignInButton_Click(object sender, RoutedEventArgs e)
    {
        await SignInAndLoadAsync();
        await StartDocaBrowserAsync();
        BeginWorkerServicesAfterDocaBrowser();
    }

    private void SaveCredsButton_Click(object sender, RoutedEventArgs e)
    {
        if (!TryApplyDocaSessionProbeMinutesFromUi(persist: false, restartWatchdog: true))
        {
            return;
        }

        PersistCredentials();
        SyncDocaCredentialsToAllAutomation();

        // Apply captcha key immediately so auto-login uses it without restart.
        var apiKey = CaptchaApiKeyBox.Text.Trim();
        CaptchaOcrKeys.RuntimeApiKeyOverride = string.IsNullOrWhiteSpace(apiKey) ? null : apiKey;
        UpdateCaptchaApiKeyHint();

        SetStatus("Credentials saved locally.", StatusKind.Success);
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first to refresh.", StatusKind.Info);
            ExpandAccountPanel();
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            SetStatus("Refreshing queue…", StatusKind.Working);
            await LoadQueueAsync();
        });
    }

    private async void JobsGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        var item = JobsGrid.SelectedItem as CertificationQueueItem;
        SetSelectedQueueItem(item);
        UpdateProcessSubmittedButtonVisibility();
        await ShowSelectedJobDocumentAsync(item);
    }

    private void UpdateProcessSubmittedButtonVisibility()
    {
        var item = JobsGrid.SelectedItem as CertificationQueueItem;
        var selectedSubmitted = item?.Record.IsSubmitted == true && _session is not null;
        ProcessSelectedEmaapButton.Visibility = selectedSubmitted
            ? Visibility.Visible
            : Visibility.Collapsed;
        FillOnlySelectedEmaapButton.Visibility = selectedSubmitted
            ? Visibility.Visible
            : Visibility.Collapsed;

        var hasSubmitted = _jobs.Any(j => j.Record.IsSubmitted && _jobRetries.IsEligible(j.Id));
        ProcessSubmittedEmaapButton.Visibility = hasSubmitted && _session is not null
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    private async void ProcessSelectedEmaapButton_Click(object sender, RoutedEventArgs e)
    {
        var item = SelectedJob;
        if (item is null || !item.IsSubmitted)
        {
            SetStatus("Select a Submitted job first.", StatusKind.Info);
            return;
        }

        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first.", StatusKind.Info);
            ExpandAccountPanel();
            return;
        }

        if (!_automationService.IsBrowserConnected)
        {
            SetStatus("Opening eMAAP browser…", StatusKind.Working);
            await StartDocaBrowserAsync();
            if (!_automationService.IsBrowserConnected)
            {
                SetStatus("eMAAP browser did not open. Pick Chrome profile in Account, then retry.", StatusKind.Info);
                ExpandAccountPanel();
                return;
            }
        }

        if (string.IsNullOrWhiteSpace(item.RcId))
        {
            SetStatus("RC id is missing for this job.", StatusKind.Info);
            return;
        }

        ProcessSelectedEmaapButton.IsEnabled = false;
        ProcessSubmittedEmaapButton.IsEnabled = false;
        FillOnlySelectedEmaapButton.IsEnabled = false;
        try
        {
            await RunWithBusyStateAsync(async () =>
            {
                await RunOnUiAsync(() => SyncDocaCredentialsToAllAutomation());
                SetStatusSafe(
                    $"eMAAP fill & certify for {item.CustomerName} · {item.SerialNumber}…",
                    StatusKind.Working);
                var token = await GetFreshIdTokenAsync().ConfigureAwait(false);
                var party = await _partyDetailsService.ResolveForJobAsync(item, item.RcId, token).ConfigureAwait(false);
                var instrument = await _instrumentDetailsService.ResolveForJobAsync(item, item.RcId, token)
                    .ConfigureAwait(false);
                AddActivityEntry(
                    $"eMAAP fill+certify: {party.BelongToName} · {instrument.SerialNumber} · {item.VerificationTypeLabel}");
                var message = await _automationService.FillEmaapCertificateGenerationAsync(
                    item,
                    party,
                    instrument,
                    token).ConfigureAwait(false);
                _jobRetries.Clear(item.Id);
                await LoadQueueAsync().ConfigureAwait(false);

                SetStatusSafe(message, StatusKind.Success);
                AddActivityEntry(message);
            }, offUiThread: true);
        }
        catch (Exception ex)
        {
            SetStatus($"eMAAP failed: {ex.Message}", ex, StatusKind.Error);
            AddActivityEntry($"eMAAP failed: {ex.Message}");
            if (ex is EmaapMandatoryStepException)
            {
                HaltWorkerPipeline(ex.Message);
            }
        }
        finally
        {
            ProcessSelectedEmaapButton.IsEnabled = true;
            ProcessSubmittedEmaapButton.IsEnabled = true;
            FillOnlySelectedEmaapButton.IsEnabled = true;
            UpdateProcessSubmittedButtonVisibility();
        }
    }

    private async void FillOnlySelectedEmaapButton_Click(object sender, RoutedEventArgs e)
    {
        var item = SelectedJob;
        if (item is null || !item.IsSubmitted)
        {
            SetStatus("Select a Submitted job first.", StatusKind.Info);
            return;
        }

        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first.", StatusKind.Info);
            ExpandAccountPanel();
            return;
        }

        if (!_automationService.IsBrowserConnected)
        {
            SetStatus("Opening eMAAP browser…", StatusKind.Working);
            await StartDocaBrowserAsync();
            if (!_automationService.IsBrowserConnected)
            {
                SetStatus("eMAAP browser did not open. Pick Chrome profile in Account, then retry.", StatusKind.Info);
                ExpandAccountPanel();
                return;
            }
        }

        if (string.IsNullOrWhiteSpace(item.RcId))
        {
            SetStatus("RC id is missing for this job.", StatusKind.Info);
            return;
        }

        ProcessSelectedEmaapButton.IsEnabled = false;
        ProcessSubmittedEmaapButton.IsEnabled = false;
        FillOnlySelectedEmaapButton.IsEnabled = false;
        try
        {
            await RunWithBusyStateAsync(async () =>
            {
                await RunOnUiAsync(() => SyncDocaCredentialsToAllAutomation());
                SetStatusSafe(
                    $"eMAAP fill only for {item.CustomerName} · {item.SerialNumber}…",
                    StatusKind.Working);
                var token = await GetFreshIdTokenAsync().ConfigureAwait(false);
                var party = await _partyDetailsService.ResolveForJobAsync(item, item.RcId, token).ConfigureAwait(false);
                var instrument = await _instrumentDetailsService.ResolveForJobAsync(item, item.RcId, token)
                    .ConfigureAwait(false);
                AddActivityEntry(
                    $"eMAAP fill-only: {party.BelongToName} · {instrument.SerialNumber} · {item.VerificationTypeLabel}");
                var message = await _automationService.FillEmaapCertificateGenerationAsync(
                    item,
                    party,
                    instrument,
                    token,
                    fillOnly: true).ConfigureAwait(false);

                SetStatusSafe(message, StatusKind.Success);
                AddActivityEntry(message);
            }, offUiThread: true);
        }
        catch (Exception ex)
        {
            SetStatus($"eMAAP fill-only failed: {ex.Message}", ex, StatusKind.Error);
            AddActivityEntry($"eMAAP fill-only failed: {ex.Message}");
            if (ex is EmaapMandatoryStepException)
            {
                HaltWorkerPipeline(ex.Message);
            }
        }
        finally
        {
            ProcessSelectedEmaapButton.IsEnabled = true;
            ProcessSubmittedEmaapButton.IsEnabled = true;
            FillOnlySelectedEmaapButton.IsEnabled = true;
            UpdateProcessSubmittedButtonVisibility();
        }
    }

    private async void ProcessSubmittedEmaapButton_Click(object sender, RoutedEventArgs e)
    {
        if (_session is null)
        {
            SetStatus("Sign in as Super Admin first.", StatusKind.Info);
            ExpandAccountPanel();
            return;
        }

        if (!_automationService.IsBrowserConnected)
        {
            SetStatus("Opening eMAAP browser…", StatusKind.Working);
            await StartDocaBrowserAsync();
            if (!_automationService.IsBrowserConnected)
            {
                SetStatus("eMAAP browser did not open. Pick Chrome profile in Account, then retry.", StatusKind.Info);
                ExpandAccountPanel();
                return;
            }
        }

        var queue = _jobs
            .Where(item => item.Record.IsSubmitted && _jobRetries.IsEligible(item.Id))
            .Select(item => item.Record)
            .ToList();

        if (queue.Count == 0)
        {
            SetStatus("No eligible Submitted jobs in the queue.", StatusKind.Info);
            return;
        }

        ProcessSubmittedEmaapButton.IsEnabled = false;
        FillOnlySelectedEmaapButton.IsEnabled = false;
        ProcessSelectedEmaapButton.IsEnabled = false;
        try
        {
            await RunWithBusyStateAsync(async () =>
            {
                SetStatusSafe($"eMAAP fill+certify → PDF → certified — {queue.Count} job(s)…", StatusKind.Working);
                AddActivityEntry($"eMAAP batch start — {queue.Count} submitted.");
                await ProcessQueueInternalAsync(queue, sequentialOnly: true, fromAutoWorker: false);
            }, offUiThread: true);
        }
        catch (Exception ex)
        {
            SetStatus($"eMAAP batch failed: {ex.Message}", ex, StatusKind.Error);
            AddActivityEntry($"eMAAP batch failed: {ex.Message}");
        }
        finally
        {
            ProcessSubmittedEmaapButton.IsEnabled = true;
            FillOnlySelectedEmaapButton.IsEnabled = true;
            ProcessSelectedEmaapButton.IsEnabled = true;
            UpdateProcessSubmittedButtonVisibility();
        }
    }

    private async Task ShowSelectedJobDocumentAsync(CertificationQueueItem? item)
    {
        if (item is null)
        {
            JobDetailBox.Text = "Select a job to view its Firestore document.";
            return;
        }

        if (_session is null)
        {
            JobDetailBox.Text = "Sign in as Super Admin to load document details.";
            return;
        }

        var jobId = item.Id;
        JobDetailBox.Text = $"Loading siteCalibrations/{jobId}…";
        try
        {
            var token = await GetFreshIdTokenAsync();
            var text = await _firestoreService.FormatSiteCalibrationDocumentAsync(jobId, token);
            // Selection may have changed while loading.
            if (JobsGrid.SelectedItem is CertificationQueueItem selected
                && string.Equals(selected.Id, jobId, StringComparison.Ordinal))
            {
                JobDetailBox.Text = text;
            }
        }
        catch (Exception ex)
        {
            JobDetailBox.Text = $"Failed to load document:\n{ex.Message}";
        }
    }

    private void ActivityLogList_MouseDoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
    {
        CopySelectedLog();
    }

    private void CopyLogItem_Click(object sender, RoutedEventArgs e)
    {
        CopySelectedLog();
    }

    private void CopySelectedLog()
    {
        if (ActivityLogList.SelectedItem is ActivityLogEntry entry)
        {
            try
            {
                Clipboard.SetText(FormatActivityLogForClipboard(entry));
            }
            catch
            {
                // Clipboard access might fail, ignore
            }
        }
    }

    private void CopyAllLogs_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var logs = string.Join(
                Environment.NewLine,
                _activityLog.Select(FormatActivityLogForClipboard));
            Clipboard.SetText(logs);
        }
        catch
        {
        }
    }

    private static string FormatActivityLogForClipboard(ActivityLogEntry entry)
    {
        if (!entry.HasCaptchaPreview || string.IsNullOrWhiteSpace(entry.CaptchaResolvedText))
        {
            return entry.Text;
        }

        return $"{entry.Text} | resolved={entry.CaptchaResolvedText}";
    }

    private void OpenLogFile_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var logPath = GetLogFilePath();
            if (System.IO.File.Exists(logPath))
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = logPath,
                    UseShellExecute = true
                });
            }
            else
            {
                MessageBox.Show(this, "Log file does not exist yet.", "Certificate Worker", MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Could not open log file: {ex.Message}", "Certificate Worker", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private static string GetLogFilePath()
    {
        var directory = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "YesGATC",
            "CertificateWorker");
        System.IO.Directory.CreateDirectory(directory);
        return System.IO.Path.Combine(directory, "activity.log");
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
                var otp = result.Message.Contains("OTP", StringComparison.OrdinalIgnoreCase);
                if (otp)
                {
                    _emaapOtpIdle = true;
                    SetDocaLoginPaused(true, logoutReason: "otp_required", startResumeProbe: false, blockAutoLogin: false);
                    StartEmaapOtpIdlePoller();
                }
                else
                {
                    SetDocaLoginPaused(true, logoutReason: "job_failure", blockAutoLogin: false);
                }
            }

            SetStatus(result.Message, StatusKind.Error);
            return;
        }

        if (result.BrowserDisconnected)
        {
            SetStatus(result.Message, StatusKind.Info);
            if (fromAutoWorker || _autoWorkerEnabled)
            {
                ScheduleJobRetry(job, result.Message);
                await RecordPipelineFailureAsync(job, result.Message);
                SetDocaLoginPaused(true, logoutReason: "browser_disconnected", blockAutoLogin: false);
            }

            await LoadQueueAsync();
            SelectJobById(job.Id);
            return;
        }

        if (result.HaltBatch)
        {
            ScheduleJobRetry(job, result.Message);
            await RecordPipelineFailureAsync(job, result.Message);
            _telemetry.RecordJobFailed();
            HaltWorkerPipeline(result.Message);
            await LoadQueueAsync();
            SelectJobById(job.Id);
            return;
        }

        if (result.Completed)
        {
            _jobRetries.Clear(job.Id);
            _telemetry.RecordJobCompleted();
            SetStatus(result.Message, StatusKind.Success);
            await LoadQueueAsync();
            SelectJobAtIndexAfterRemoval(jobIndex);
            return;
        }

        ScheduleJobRetry(job, result.Message);
        if (_jobRetries.IsExhausted(job.Id)
            || PipelineFailureClassifier.IsPermanentDataFailure(result.Message))
        {
            var suffix = PipelineFailureClassifier.IsPermanentDataFailure(result.Message)
                ? " (permanent data error — marked Rejected)"
                : $" (worker stopped after {ResolveMaxRetriesFor(job)} submit retries — marked Failed at submit)";
            await RecordPipelineFailureAsync(job, $"{result.Message}{suffix}", exhausted: true);
        }
        else
        {
            await RecordPipelineFailureAsync(job, result.Message);
        }

        _telemetry.RecordJobFailed();
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
            var creds = await ResolveDocaCredentialsAsync().ConfigureAwait(false);
            automation.DocaCredentials = creds;
            _automationService.DocaCredentials = creds;
            if (!HasDocaLoginCredentials(automation.DocaCredentials))
            {
                return new JobPipelineResult(
                    false,
                    true,
                    "eMAAP email/password missing — set Account fields or appsettings.local.json, Save Credentials.");
            }

            await _docaBrowserStartupTask.ConfigureAwait(false);
            await automation.EnsureBrowserReadyAsync().ConfigureAwait(false);

            var sessionGate = await automation.EnsureDocaSessionForJobAsync().ConfigureAwait(false);
            if (sessionGate is not null)
            {
                return await HandleSessionGateResultAsync(sessionGate).ConfigureAwait(false);
            }

            return await ProcessJobThroughPipelineAsync(job, automation, continueBrowserSession)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (AutomationService.IsBrowserDisconnectedError(ex))
        {
            AddActivityEntry("eMAAP browser disconnected — reopening Chrome and auto-signing in…");
            try
            {
                await automation.EnsureBrowserReadyAsync();
                var gate = await automation.EnsureDocaSessionForJobAsync();
                if (gate is not null)
                {
                    return await HandleSessionGateResultAsync(gate);
                }

                // Browser back + logged in — retry this job once in the same cycle.
                return await ProcessJobThroughPipelineAsync(job, automation, continueBrowserSession: true);
            }
            catch (Exception reopenEx) when (AutomationService.IsBrowserDisconnectedError(reopenEx))
            {
                return new JobPipelineResult(
                    false,
                    false,
                    "eMAAP browser was closed or disconnected. Reopening Chrome on the next attempt.",
                    BrowserDisconnected: true);
            }
            catch (Exception reopenEx)
            {
                if (reopenEx.Message.Contains("login", StringComparison.OrdinalIgnoreCase)
                    || reopenEx.Message.Contains("OTP", StringComparison.OrdinalIgnoreCase)
                    || reopenEx.Message.Contains("Sign in to eMAAP", StringComparison.OrdinalIgnoreCase))
                {
                    return new JobPipelineResult(false, true, reopenEx.Message);
                }

                return new JobPipelineResult(
                    false,
                    false,
                    "eMAAP browser was closed or disconnected. Reopening Chrome on the next attempt.",
                    BrowserDisconnected: true);
            }
        }
    }

    private async Task<JobPipelineResult> HandleSessionGateResultAsync(DocaOpenResult sessionGate)
    {
        if (sessionGate.State == DocaSessionState.OtpRequired)
        {
            _emaapOtpIdle = true;
            SetDocaLoginPaused(true, logoutReason: "otp_required", startResumeProbe: false, blockAutoLogin: false);
            StartEmaapOtpIdlePoller();
            AddActivityEntry("eMAAP signed out — OTP sent; waiting Firebase / master OTP, then auto-resume.");
        }

        return new JobPipelineResult(false, true, sessionGate.Message);
    }

    private async Task ProcessQueueInternalAsync(
        IReadOnlyList<SiteCalibrationRecord> queue,
        bool sequentialOnly,
        bool fromAutoWorker)
    {
        // eMAAP fill+certify must stay single-browser sequential.
        if (sequentialOnly || queue.Any(job => job.IsSubmitted))
        {
            await ProcessAllJobsSequentiallyAsync(queue, fromAutoWorker);
            return;
        }

        var settings = App.Settings.Automation;
        var useParallel = queue.Count > settings.ParallelBrowserThreshold
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
                ScheduleJobRetry(job, ex.Message);
                await RecordPipelineFailureAsync(job, ex.Message);
                SetStatusSafe($"{batchLabel} failed · {ex.Message}", ex, StatusKind.Error);
                AddActivityEntry($"{batchLabel} failed · {ex.Message}");

                if (ex is EmaapMandatoryStepException
                    || AutomationService.IsBrowserDisconnectedError(ex))
                {
                    HaltWorkerPipeline(
                        $"{batchLabel} — halted. Fix the issue, then Process all submitted / resume auto worker.");
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
                var otp = result.Message.Contains("OTP", StringComparison.OrdinalIgnoreCase);
                if (otp)
                {
                    _emaapOtpIdle = true;
                    SetDocaLoginPaused(true, logoutReason: "otp_required", startResumeProbe: false, blockAutoLogin: false);
                    StartEmaapOtpIdlePoller();
                }
                else
                {
                    // Keep auto-login enabled — probe timer will captcha+OTP and resume.
                    SetDocaLoginPaused(true, logoutReason: "job_failure", blockAutoLogin: false);
                }
            }

            lastError = result.Message;
            SetStatusSafe(
                $"{batchLabel} paused — eMAAP re-login in progress (captcha + OTP). Worker resumes when signed in.",
                StatusKind.Error);
            stopBatch = true;
            return true;
        }

        if (result.BrowserDisconnected)
        {
            failed++;
            lastError = result.Message;
            ScheduleJobRetry(job, result.Message);
            // Do not permanent-halt: reopen + auto-login on next auto-worker cycle.
            if (fromAutoWorker || _autoWorkerEnabled)
            {
                SetDocaLoginPaused(true, logoutReason: "browser_disconnected", blockAutoLogin: false);
            }

            SetStatusSafe(
                $"{batchLabel} — browser disconnected. Reopening Chrome + auto sign-in on next cycle.",
                StatusKind.Info);
            AddActivityEntry(
                $"{batchLabel} — browser disconnected. Stopping batch; Chrome will reopen after resume.");
            stopBatch = true;
            return true;
        }

        if (result.HaltBatch)
        {
            failed++;
            lastError = result.Message;
            ScheduleJobRetry(job, result.Message);
            _ = RecordPipelineFailureAsync(job, result.Message);
            HaltWorkerPipeline($"{batchLabel} · {result.Message}");
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
        ScheduleJobRetry(job, result.Message);
        _ = RecordPipelineFailureAsync(job, result.Message);
        // eMAAP fill/submit failures also halt — do not skip to next job with a half-done cert.
        HaltWorkerPipeline($"{batchLabel} · {result.Message} — batch halted.");
        stopBatch = true;
        return true;
    }

    /// <summary>Stop auto-worker cycles until session restored (auto re-login / OTP).</summary>
    private void HaltWorkerPipeline(string message)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.Invoke(() => HaltWorkerPipeline(message));
            return;
        }

        _autoWorkerPausedForDoca = true;
        StopAutoWorkerTimers();
        SetDocaLoginPaused(true, startResumeProbe: true, blockAutoLogin: false);
        SetStatus(message, StatusKind.Error);
        AddActivityEntry(message);
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
                            SetDocaLoginPaused(true, logoutReason: "job_failure");
                        }

                        SetStatusSafe($"{label} — DOCA login required in Chrome {workerIndex + 1}.", StatusKind.Error);
                        return;
                    }

                    if (result.BrowserDisconnected)
                    {
                        Interlocked.Increment(ref stats.Failed);
                        ScheduleJobRetry(job, result.Message);
                        _ = RecordPipelineFailureAsync(job, result.Message);
                        lock (stats)
                        {
                            stats.LastError = result.Message;
                        }
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
                        ScheduleJobRetry(job, result.Message);
                        _ = RecordPipelineFailureAsync(job, result.Message);
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
                    ScheduleJobRetry(job, ex.Message);
                    _ = RecordPipelineFailureAsync(job, ex.Message);
                    lock (stats)
                    {
                        stats.LastError = ex.Message;
                    }
                    RefreshRetryBadges();
                    SetStatusSafe($"{label} failed · {ex.Message}", ex, StatusKind.Error);

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
                _preparedBulkWorkers[i].DocaCredentials = ResolveDocaCredentials();
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
            DocaCredentials = ResolveDocaCredentials(),
            Firebase = App.Settings.Firebase,
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
        SetStatusSafe(message, null, kind);
    }

    private void SetStatusSafe(string message, Exception? ex, StatusKind kind)
    {
        if (Dispatcher.CheckAccess())
        {
            SetStatus(message, ex, kind);
            return;
        }

        _ = Dispatcher.InvokeAsync(() => SetStatus(message, ex, kind), DispatcherPriority.Normal);
    }

    private void SelectJobOnUiThread(string jobId)
    {
        if (Dispatcher.CheckAccess())
        {
            SelectJobById(jobId);
            return;
        }

        _ = Dispatcher.InvokeAsync(() => SelectJobById(jobId), DispatcherPriority.Background);
    }

    private Task RunOnUiAsync(Action action)
    {
        if (Dispatcher.CheckAccess())
        {
            action();
            return Task.CompletedTask;
        }

        return Dispatcher.InvokeAsync(action).Task;
    }

    private async Task<T> RunOnUiAsync<T>(Func<T> func)
    {
        if (Dispatcher.CheckAccess())
        {
            return func();
        }

        return await Dispatcher.InvokeAsync(func);
    }

    private Task<DocaCredentialSettings> ResolveDocaCredentialsAsync() =>
        RunOnUiAsync(() =>
        {
            SyncDocaCredentialsToAllAutomation();
            return ResolveDocaCredentials();
        });

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

        automation.DocaCredentials = await ResolveDocaCredentialsAsync().ConfigureAwait(false);

        var current = job;

        // Single production stage: Submitted → eMAAP fill+certify → PDF → Firebase certified.
        if (!current.IsSubmitted)
        {
            return new JobPipelineResult(
                false,
                false,
                $"No pipeline steps matched serial {current.SerialNumber} (Firebase status: {current.StatusLabel}).");
        }

        if (string.IsNullOrWhiteSpace(current.RcId))
        {
            return new JobPipelineResult(false, false, $"Serial {current.SerialNumber} — RC id is missing.");
        }

        SetStatusSafe(
            $"eMAAP · Fill & certify serial {current.SerialNumber} ({current.CustomerName})…",
            StatusKind.Working);

        var token = await GetFreshIdTokenAsync();
        var party = await _partyDetailsService.ResolveForJobAsync(current, current.RcId, token);
        var instrument = await _instrumentDetailsService.ResolveForJobAsync(current, current.RcId, token);

        AddActivityEntry(
            $"eMAAP fill+certify: {party.BelongToName} · {instrument.SerialNumber} · " +
            $"{current.VerificationTypeLabel} · {instrument.TypeOfInstrument} · Max {instrument.MaximumCapacity}");

        try
        {
            var message = await automation.FillEmaapCertificateGenerationAsync(
                current,
                party,
                instrument,
                token);
            AddActivityEntry(message);
            return new JobPipelineResult(true, false, message);
        }
        catch (EmaapMandatoryStepException ex)
        {
            AddActivityEntry(ex.Message);
            return new JobPipelineResult(false, false, ex.Message, HaltBatch: true);
        }
        catch (Exception ex) when (
            ex.Message.Contains("login page", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("Sign in to eMAAP", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("OTP", StringComparison.OrdinalIgnoreCase))
        {
            return new JobPipelineResult(false, true, ex.Message);
        }
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
            SyncDocaCredentialsToAllAutomation();
            UpdateSignInSummary();
            SignInExpander.IsExpanded = false;

            await FlushPendingCaptchaReportsAsync();

            SetStatus("Signed in. Loading certification queue...", StatusKind.Working);
            if (_useRealtimeListener && _autoWorkerEnabled)
            {
                await StartQueueListenerAsync();
            }
            else
            {
                await LoadQueueAsync();
            }

            if (!_autoWorkerEnabled)
            {
                SetStatus("Signed in. Queue loaded — Auto worker off. Opening eMAAP next…", StatusKind.Working);
            }
        });
    }

    private async Task LoadQueueAsync()
    {
        if (_session is null)
        {
            return;
        }

        var token = await GetFreshIdTokenAsync().ConfigureAwait(false);
        var records = await _firestoreService.GetPendingCertificationQueueAsync(token).ConfigureAwait(false);
        await RunOnUiAsync(() =>
            ApplyQueueRecords(records, $"Loaded {records.Count} job(s) from Firestore."));
    }

    private void ApplyQueueRecords(
        IReadOnlyList<SiteCalibrationRecord> records,
        string statusMessage,
        bool quietStatus = false)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.Invoke(() => ApplyQueueRecords(records, statusMessage, quietStatus));
            return;
        }

        var previousId = _selectedQueueItem?.Id;
        var sameIds = _jobs.Count == records.Count;
        if (sameIds)
        {
            for (var i = 0; i < records.Count; i++)
            {
                if (!string.Equals(_jobs[i].Id, records[i].Id, StringComparison.Ordinal))
                {
                    sameIds = false;
                    break;
                }
            }
        }

        if (sameIds)
        {
            for (var i = 0; i < records.Count; i++)
            {
                _jobs[i] = new CertificationQueueItem(records[i])
                {
                    RetryBadge = _jobRetries.BadgeFor(records[i].Id),
                };
            }
        }
        else
        {
            _jobs.Clear();
            foreach (var record in records)
            {
                _jobs.Add(new CertificationQueueItem(record)
                {
                    RetryBadge = _jobRetries.BadgeFor(record.Id),
                });
            }
        }

        RestoreSelection(previousId);
        UpdateQueueSummary();
        UpdateEmptyState();
        UpdateProcessSubmittedButtonVisibility();
        _ = ShowSelectedJobDocumentAsync(JobsGrid.SelectedItem as CertificationQueueItem);

        var pending = _jobs.Count(job => job.NeedsPipelineWork);
        var eligible = _jobs.Count(job => job.NeedsPipelineWork && _jobRetries.IsEligible(job.Id));
        if (!quietStatus)
        {
            SetStatus($"{statusMessage} ({eligible}/{pending} ready in pipeline).", StatusKind.Success);
        }

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
        QueueCountText.Text = _jobs.Count == 0
            ? "0 jobs pending"
            : $"{_jobs.Count} jobs · {submitted} to eMAAP-certify";
    }

    private void UpdateEmptyState()
    {
        var count = _jobs.Count;
        EmptyStateText.Visibility = count == 0 ? Visibility.Visible : Visibility.Collapsed;
        JobsGrid.Visibility = count == 0 ? Visibility.Collapsed : Visibility.Visible;

        EmptyStateTitleText.Text = "No pending verifications";
        EmptyStateBodyText.Text = _session is null
            ? "Sign in and refresh to load jobs from all RCs."
            : "All submitted jobs are certified.";
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

    private async Task RunWithBusyStateAsync(Func<Task> action, bool offUiThread = false)
    {
        if (_isBusy)
        {
            return;
        }

        _isBusy = true;
        await RunOnUiAsync(() =>
        {
            SignInButton.IsEnabled = false;
            RefreshButton.IsEnabled = false;
        });

        try
        {
            if (offUiThread)
            {
                // Playwright + Firestore pipeline off the WPF dispatcher so tabs/checkboxes stay responsive.
                await Task.Run(async () => await action().ConfigureAwait(false)).ConfigureAwait(true);
            }
            else
            {
                await action();
            }
        }
        catch (Exception ex)
        {
            await RunOnUiAsync(() =>
            {
                SetStatus(ex.Message, ex, StatusKind.Error);
                MessageBox.Show(this, ex.Message, "Certificate Worker", MessageBoxButton.OK, MessageBoxImage.Warning);
            });
        }
        finally
        {
            await RunOnUiAsync(() =>
            {
                _isBusy = false;
                SignInButton.IsEnabled = true;
                RefreshButton.IsEnabled = true;

                if (_autoWorkerCyclePending && _autoWorkerEnabled && !_autoWorkerPausedForDoca && _session is not null)
                {
                    _autoWorkerCyclePending = false;
                    _ = RunAutoWorkerCycleAsync();
                }
            });
        }
    }

    private void SetStatus(string message, StatusKind kind = StatusKind.Info)
    {
        SetStatus(message, null, kind);
    }

    private static readonly object LogFileLock = new();

    private void LogToFile(string message, Exception? ex = null)
    {
        try
        {
            var logPath = GetLogFilePath();
            lock (LogFileLock)
            {
                var logLine = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}";
                if (ex != null)
                {
                    logLine += $"{Environment.NewLine}{ex.ToString()}{Environment.NewLine}";
                }
                System.IO.File.AppendAllText(logPath, logLine + Environment.NewLine);
            }
        }
        catch
        {
            // Ignore logging errors to prevent crash
        }
    }

    private void SetStatus(string message, Exception? ex, StatusKind kind = StatusKind.Info)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => SetStatus(message, ex, kind));
            return;
        }

        _lastStatusKind = kind;
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
        LogToFile(message, ex);

        if (_session is null)
        {
            return;
        }

        // Working spam floods Firestore + UI; throttle heartbeats.
        var shouldPublish = kind is StatusKind.Error or StatusKind.Success
            || (DateTimeOffset.UtcNow - _lastStatusPublishUtc).TotalSeconds >= 20;
        if (kind != StatusKind.Working)
        {
            var level = kind switch
            {
                StatusKind.Error => "error",
                StatusKind.Success => "success",
                _ => "info",
            };
            _ = _telemetry.ReportActivityAsync(message, level, () => GetFreshIdTokenAsync());
        }

        if (shouldPublish)
        {
            _lastStatusPublishUtc = DateTimeOffset.UtcNow;
            _ = PublishWorkerStatusAsync();
        }
    }

    private void AddActivityEntry(string message) =>
        AddActivityEntry(new ActivityLogEntry
        {
            Text = $"{DateTime.Now:HH:mm:ss}  {message}",
        });

    private void AddActivityEntry(ActivityLogEntry entry)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => AddActivityEntry(entry), DispatcherPriority.Background);
            return;
        }

        _activityLog.Insert(0, entry);

        while (_activityLog.Count > 120)
        {
            _activityLog.RemoveAt(_activityLog.Count - 1);
        }

        if (_activityLog.Count > 0 && ActivityLogList.IsVisible)
        {
            ActivityLogList.ScrollIntoView(_activityLog[0]);
        }
    }
}
