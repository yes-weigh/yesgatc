using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
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
        bool HaltBatch = false,
        bool SoftFail = false);

    private sealed class ParallelBatchStats
    {
        public int Completed;
        public int Failed;
        public int LoginRequiredWorkers;
        public string? LastError;
    }

    private readonly ObservableCollection<CertificationQueueItem> _jobs = [];
    private readonly ObservableCollection<CertificationQueueItem> _pdfSignerJobs = [];
    private readonly ObservableCollection<CertificationQueueItem> _signedUploadJobs = [];
    private readonly ObservableCollection<ActivityLogEntry> _activityLog = [];
    private bool _syncingQueueSelection;
    private readonly FirebaseAuthService _authService;
    private readonly FirestoreService _firestoreService;
    private readonly FirestoreQueueListener _queueListener;
    private readonly PartyDetailsService _partyDetailsService;
    private readonly InstrumentDetailsService _instrumentDetailsService;
    private readonly AutomationService _automationService;
    private readonly PdfImageStampService _pdfImageStampService;
    private readonly LocalCredentialsStore _credentialStore = new();
    private readonly JobRetryTracker _jobRetries = new();
    private readonly WorkerTelemetryService _telemetry;
    private readonly WorkerPresenceService _presence;
    private bool _yieldedToRcEngine;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private readonly List<AutomationService> _preparedBulkWorkers = [];
    private DateTimeOffset _lastStatusPublishUtc = DateTimeOffset.MinValue;

    private FirebaseSignInResult? _session;
    private CertificationQueueItem? _selectedQueueItem;
    private bool _isBusy;
    private bool _autoWorkerEnabled;
    private bool _processFillQueue = true;
    private bool _processSignerQueue = true;
    private bool _processSignedUploadQueue = true;
    private bool _suppressProcessQueueSwitchEvent;
    private bool _autoWorkerPausedForDoca;
    private bool _emaapReadyForJobs;
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
    private DispatcherTimer? _retryDueTimer;
    private DispatcherTimer? _docaProbeTimer;
    private DispatcherTimer? _docaSessionWatchdogTimer;
    private DispatcherTimer? _telemetryTimer;
    private bool _autoWorkerCyclePending;
    private WorkerQueueStage? _lastEmaapStage;
    private bool _sessionProbeRunning;
    private int _docaSessionProbeMinutes;
    private Task _docaBrowserStartupTask = Task.CompletedTask;
    private StatusKind _lastStatusKind = StatusKind.Idle;
    private StatusHudWindow? _statusHud;
    private DispatcherTimer? _hudVisibilityTimer;

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
        _queueListener.SignedUploadQueueUpdated += OnSignedUploadQueueListenerUpdated;
        _queueListener.PdfSignerQueueUpdated += OnPdfSignerQueueListenerUpdated;
        _queueListener.ListenerError += OnQueueListenerError;
        _useRealtimeListener = settings.AutoWorker.UseRealtimeListener;
        _partyDetailsService = new PartyDetailsService(settings.Firebase);
        _instrumentDetailsService = new InstrumentDetailsService(settings.Firebase);
        _telemetry = new WorkerTelemetryService(settings.Firebase);
        _presence = new WorkerPresenceService(settings.Firebase);
        _automationService = new AutomationService(settings.Automation, _firestoreService);
        _pdfImageStampService = new PdfImageStampService(settings.Firebase);
        _automationService.Firebase = settings.Firebase;
        _automationService.ResolveFirebaseIdToken = GetFreshIdTokenAsync;
        _automationService.CaptchaAttemptReporter = ReportCaptchaAttemptAsync;
        _automationService.DocaCredentialsCaptured = creds => SyncDocaCredentialsToAllAutomation(creds);
        App.AutomationService = _automationService;

        JobsGrid.ItemsSource = _jobs;
        SignerJobsGrid.ItemsSource = _pdfSignerJobs;
        SignedJobsGrid.ItemsSource = _signedUploadJobs;
        ActivityLogList.ItemsSource = _activityLog;
        LoadChromeProfilePicker(settings);
        LoadSavedCredentials(settings);
        ConfigureAutoWorkerFromSettings();
        ConfigureStartWithWindowsFromStore();
        ApplyProductBranding();

        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
        Activated += (_, _) => SyncStatusHudVisibility();
        Deactivated += (_, _) => SyncStatusHudVisibility();
        StateChanged += (_, _) => SyncStatusHudVisibility();
    }

    private void ApplyProductBranding()
    {
        Title = WorkerProduct.AppName;
        WorkerBrandText.Text = WorkerProduct.AppName;
        AccountHintText.Text = WorkerProduct.IsEmaapEngineBuild
            ? "RC Admin Aadhar + password"
            : "Super Admin Aadhar + password (VPS)";
        EmaapLoginAutomation.PreferManualLoginUntilAuthenticated = WorkerProduct.IsEmaapEngineBuild;
        if (WorkerProduct.IsEmaapEngineBuild)
        {
            EmaapLoginAutomation.OnLoggedIn = () => Dispatcher.BeginInvoke(OnEmaapPortalLoggedIn);
        }
        if (!WorkerProduct.IsEmaapEngineBuild)
        {
            PortalLoginPanel.Visibility = Visibility.Collapsed;
        }
        if (WorkerProduct.IsEmaapEngineBuild)
        {
            DocaLoginPanel.Visibility = Visibility.Collapsed;
            ChromeProfilePanel.Visibility = Visibility.Collapsed;
            VpsAccountExtrasPanel.Visibility = Visibility.Collapsed;
            StartWithWindowsCheckBox.Visibility = Visibility.Collapsed;
            StartWithWindowsHint.Visibility = Visibility.Collapsed;
        }
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
        if (WorkerProduct.IsEmaapEngineBuild)
        {
            DocaEmailBox.Text = settings.Automation.DocaCredentials.Email;
            DocaPasswordBox.Text = settings.Automation.DocaCredentials.Password;
        }
        else
        {
            DocaEmailBox.Text = FirstNonEmpty(
                saved.Doca.Email,
                settings.Automation.DocaCredentials.Email);
            DocaPasswordBox.Text = FirstNonEmpty(
                saved.Doca.Password,
                settings.Automation.DocaCredentials.Password);
        }

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
        if (_docaSessionProbeMinutes == 10)
        {
            // Old default probed Chrome every 10 min — kills 4 GB VPS. Event-based queue instead.
            _docaSessionProbeMinutes = 0;
        }
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

        if (!WorkerProduct.IsEmaapEngineBuild
            && settings.Automation.UseSystemChromeProfile
            && !ChromeProfilePreference.HasSelection)
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

    private DocaCredentialSettings CurrentDocaCredentials()
    {
        if (WorkerProduct.IsEmaapEngineBuild)
        {
            return CloneSettingsDoca();
        }

        return new DocaCredentialSettings
        {
            Email = DocaEmailBox.Text.Trim(),
            Password = DocaPasswordBox.Text,
        };
    }

    private static DocaCredentialSettings CloneSettingsDoca() => new()
    {
        Email = FirstNonEmpty(
            App.Settings.Automation.DocaCredentials.Email,
            EmaapPortalLogin.Email).Trim(),
        Password = string.IsNullOrWhiteSpace(App.Settings.Automation.DocaCredentials.Password)
            ? EmaapPortalLogin.Password
            : App.Settings.Automation.DocaCredentials.Password,
    };

    private static bool HasDocaLoginCredentials(DocaCredentialSettings credentials) =>
        !string.IsNullOrWhiteSpace(credentials.Email)
        && !string.IsNullOrWhiteSpace(credentials.Password);

    private DocaCredentialSettings ResolveDocaCredentials()
    {
        if (WorkerProduct.IsEmaapEngineBuild && HasDocaLoginCredentials(CloneSettingsDoca()))
        {
            return CloneSettingsDoca();
        }

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

    private DocaCredentialSettings ResolveDocaCredentialsOnUiThread()
    {
        if (Dispatcher.CheckAccess())
        {
            return ResolveDocaCredentials();
        }

        // Prefer async path via ResolveDocaCredentialsAsync; sync fallback for legacy callers.
        return Dispatcher.Invoke(ResolveDocaCredentials);
    }

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
            WorkerProduct.IsEmaapEngineBuild ? CloneSettingsDoca().Email : DocaEmailBox.Text,
            WorkerProduct.IsEmaapEngineBuild ? CloneSettingsDoca().Password : DocaPasswordBox.Text,
            CaptchaApiKeyBox.Text,
            docaFillOnly: false,
            _docaSessionProbeMinutes,
            chromeProfile,
            autoWorkerEnabled: _autoWorkerEnabled,
            startWithWindows: _startWithWindows,
            processFillQueue: _processFillQueue,
            processSignerQueue: _processSignerQueue,
            processSignedUploadQueue: _processSignedUploadQueue);
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
            AddActivityEntry($"eMaap session probe {label} (saved).");
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
        EnsureStatusHud();

        // Re-assert autostart on every launch (install path / scripts may have been updated).
        if (_startWithWindows && !WorkerProduct.IsEmaapEngineBuild)
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

        if (WorkerProduct.IsEmaapEngineBuild)
        {
            await StartEmaapEngineSessionAsync();
            return;
        }

        if (!string.IsNullOrWhiteSpace(AadharBox.Text) && !string.IsNullOrWhiteSpace(PasswordBox.Text))
        {
            await SignInAndLoadAsync();
            await StartDocaBrowserAsync();
            BeginWorkerServicesAfterDocaBrowser();
            return;
        }

        await StartDocaBrowserAsync();

        SetStatus(
            "VPS worker uses saved Super Admin from credentials.local.json / appsettings.local.json. No portal login on this EXE.",
            StatusKind.Info);
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

            if (!WorkerProduct.IsEmaapEngineBuild && !TryEnsureChromeProfileSelected(persist: true))
            {
                return;
            }

            if (!WorkerProduct.IsEmaapEngineBuild
                && CaptchaOcrKeys.RequiresApiKey(App.Settings.Automation.CaptchaOcr)
                && string.IsNullOrWhiteSpace(CaptchaOcrKeys.ResolveApiKey(App.Settings.Automation.CaptchaOcr)))
            {
                SetStatus(
                    "Captcha AI key missing — put ApiKey in appsettings.local.json or Captcha AI Key box, Save, retry.",
                    StatusKind.Info);
                ExpandAccountPanel();
            }

            if (WorkerProduct.IsEmaapEngineBuild)
            {
                MainTabs.SelectedIndex = 0;
                SetStatus(
                    "Chrome window should open on eMAAP. Type captcha and OTP there. This app waits.",
                    StatusKind.Working);
            }
            else
            {
                var profileLabel = ChromeProfilePreference.RuntimeDirectory ?? "Default";
                var ocrLabel = CaptchaOcrKeys.DescribeProvider(App.Settings.Automation.CaptchaOcr);
                SetStatus(
                    $"Opening eMAAP (Chrome: {profileLabel}) — auto login + captcha via {ocrLabel}…",
                    StatusKind.Working);
            }

            // Playwright must not run on the WPF dispatcher — long captcha/OCR waits freeze the main window.
            var state = await RunPlaywrightOffUiAsync(() => _automationService.OpenDocaWorkspaceAsync());

            if (WorkerProduct.IsEmaapEngineBuild)
            {
                if (state == DocaSessionState.LoggedIn)
                {
                    OnEmaapPortalLoggedIn();
                    return;
                }

                SetStatus(
                    "Chrome is on eMAAP. Type captcha and OTP. Fill starts the moment login succeeds.",
                    StatusKind.Working);
                return;
            }

            if (state == DocaSessionState.OtpRequired)
            {
                _emaapOtpIdle = true;
                _emaapMasterOtpTried = false;
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
            var state = await RunPlaywrightOffUiAsync(() => _automationService.SubmitEmaapOtpAsync(otp));
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
        CloseStatusHud();
        await _queueListener.StopAsync();
        if (_session is not null)
        {
            try
            {
                var token = await GetFreshIdTokenAsync();
                await _presence.ClearAsync(_session with { IdToken = token });
            }
            catch
            {
            }
        }

        await DisposePreparedBulkWorkersAsync();
        await _automationService.DisposeAsync();
        _tokenLock.Dispose();
    }

    private void EnsureStatusHud()
    {
        if (_statusHud is not null)
        {
            return;
        }

        _statusHud = new StatusHudWindow();
        _statusHud.UpdateStatus("Idle", StatusText.Text, (Brush)FindResource("TextMutedBrush"));
        UpdateAutoWorkerStatusText();
        StartHudVisibilityTimer();
        SyncStatusHudVisibility();
    }

    private void StartHudVisibilityTimer()
    {
        if (_hudVisibilityTimer is not null)
        {
            return;
        }

        _hudVisibilityTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _hudVisibilityTimer.Tick += (_, _) => SyncStatusHudVisibility();
        _hudVisibilityTimer.Start();
    }

    private void SyncStatusHudVisibility()
    {
        if (_statusHud is null)
        {
            return;
        }

        var handle = new WindowInteropHelper(this).Handle;
        _statusHud.FollowMainWindowForeground(handle);
    }

    private void CloseStatusHud()
    {
        if (_hudVisibilityTimer is not null)
        {
            _hudVisibilityTimer.Stop();
            _hudVisibilityTimer = null;
        }

        if (_statusHud is null)
        {
            return;
        }

        try
        {
            _statusHud.Close();
        }
        catch
        {
        }

        _statusHud = null;
    }

    private void PushStatusHud(string message, StatusKind kind)
    {
        if (_statusHud is null)
        {
            return;
        }

        string state;
        Brush dot;
        switch (kind)
        {
            case StatusKind.Idle:
                state = "Idle";
                dot = (Brush)FindResource("TextMutedBrush");
                break;
            case StatusKind.Working:
                state = "Working";
                dot = (Brush)FindResource("AccentPrimaryBrush");
                break;
            case StatusKind.Success:
                state = "Done";
                dot = (Brush)FindResource("AccentGreenBrush");
                break;
            case StatusKind.Error:
                state = "Error";
                dot = new SolidColorBrush(Color.FromRgb(0xEF, 0x44, 0x44));
                break;
            default:
                state = "Ready";
                dot = (Brush)FindResource("TextMutedBrush");
                break;
        }

        _statusHud.UpdateStatus(state, message, dot);
    }

    private bool _suppressAutoRunCheckBoxEvent;

    private void ConfigureAutoWorkerFromSettings()
    {
        var settings = App.Settings.AutoWorker;
        var saved = _credentialStore.Load();
        // Persist last checkbox choice; fall back to appsettings when never saved.
        _autoWorkerEnabled = saved.AutoWorkerEnabled ?? settings.Enabled;
        _processFillQueue = saved.ProcessFillQueue ?? true;
        _processSignerQueue = saved.ProcessSignerQueue ?? true;
        _processSignedUploadQueue = saved.ProcessSignedUploadQueue ?? true;
        if (WorkerProduct.IsEmaapEngineBuild)
        {
            _autoWorkerEnabled = true;
        }
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

        ApplyProcessQueueSwitchesToUi();
        UpdateAutoWorkerStatusText();
    }

    private void ApplyProcessQueueSwitchesToUi()
    {
        _suppressProcessQueueSwitchEvent = true;
        try
        {
            ProcessFillQueueSwitch.IsChecked = _processFillQueue;
            ProcessSignerQueueSwitch.IsChecked = _processSignerQueue;
            ProcessSignedQueueSwitch.IsChecked = _processSignedUploadQueue;
        }
        finally
        {
            _suppressProcessQueueSwitchEvent = false;
        }
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
            SetStatus("Auto-run on — worker processes queues whose Process switch is on.", StatusKind.Info);
            UpdateAutoWorkerStatusText();
            RequestAutoWorkerCycle();
            return;
        }

        StopAutoWorkerTimers();
        AddActivityEntry("Auto-run OFF — queue process switches ignored until Auto-run is on.");
        SetStatus("Auto-run off — turn Auto-run on to process queues.", StatusKind.Info);
        UpdateAutoWorkerStatusText();
    }

    private void ProcessQueueSwitch_Changed(object sender, RoutedEventArgs e)
    {
        if (_suppressProcessQueueSwitchEvent
            || ProcessFillQueueSwitch is null
            || ProcessSignerQueueSwitch is null
            || ProcessSignedQueueSwitch is null
            || !IsLoaded)
        {
            return;
        }

        _processFillQueue = ProcessFillQueueSwitch.IsChecked == true;
        _processSignerQueue = ProcessSignerQueueSwitch.IsChecked == true;
        _processSignedUploadQueue = ProcessSignedQueueSwitch.IsChecked == true;
        PersistCredentials();
        UpdateEmptyState();
        UpdateQueueSummary();
        UpdateAutoWorkerStatusText();

        var label = sender == ProcessFillQueueSwitch
            ? "Fill & certify"
            : sender == ProcessSignerQueueSwitch
                ? "PDF signer"
                : "Signed PDF → eMAAP";
        var on = sender is CheckBox box && box.IsChecked == true;
        AddActivityEntry($"{label} process switch {(on ? "ON" : "OFF")}.");
        SetStatus(
            on
                ? $"{label} will process when Auto-run is on (fill ↔ signed upload, stamp bursts between)."
                : $"{label} skipped until switch is on.",
            StatusKind.Info);

        if (_autoWorkerEnabled)
        {
            RequestAutoWorkerCycle();
        }
    }

    private void RequestAutoWorkerCycle()
    {
        if (_session is null || _remotePaused || !_autoWorkerEnabled)
        {
            return;
        }

        _ = Dispatcher.BeginInvoke(
            DispatcherPriority.ApplicationIdle,
            new Action(async () =>
            {
                if (!_autoWorkerEnabled || _session is null || _remotePaused)
                {
                    return;
                }

                if (_useRealtimeListener && !_realtimeListenerActive)
                {
                    await StartQueueListenerAsync();
                }

                StartAutoWorkerTimers();
                await RunAutoWorkerCycleAsync();
            }));
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
            await KickAutoWorkerAfterQueueChangeAsync();
        }, DispatcherPriority.Background);
    }

    private void OnSignedUploadQueueListenerUpdated(IReadOnlyList<SiteCalibrationRecord> records)
    {
        _ = Dispatcher.InvokeAsync(async () =>
        {
            ApplySignedUploadRecords(records);
            await KickAutoWorkerAfterQueueChangeAsync();
        }, DispatcherPriority.Background);
    }

    private void OnPdfSignerQueueListenerUpdated(IReadOnlyList<SiteCalibrationRecord> records)
    {
        _ = Dispatcher.InvokeAsync(async () =>
        {
            ApplyPdfSignerRecords(records);
            await KickAutoWorkerAfterQueueChangeAsync();
        }, DispatcherPriority.Background);
    }

    private async Task KickAutoWorkerAfterQueueChangeAsync()
    {
        if (!_autoWorkerEnabled || _session is null || _remotePaused)
        {
            return;
        }

        if (WorkerProduct.IsEmaapEngineBuild && !_emaapReadyForJobs)
        {
            return;
        }

        if (_isBusy)
        {
            _autoWorkerCyclePending = true;
            return;
        }

        await RunAutoWorkerCycleAsync();
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

    private void StopRetryDueTimer()
    {
        if (_retryDueTimer is null)
        {
            return;
        }

        _retryDueTimer.Tick -= RetryDueTimer_Tick;
        _retryDueTimer.Stop();
        _retryDueTimer = null;
    }

    private void ArmRetryDueTimer()
    {
        StopRetryDueTimer();
        DateTimeOffset? next = null;
        foreach (var state in _jobRetries.Snapshot().Values)
        {
            if (state.Exhausted || state.RetryAt == DateTimeOffset.MaxValue)
            {
                continue;
            }

            if (next is null || state.RetryAt < next)
            {
                next = state.RetryAt;
            }
        }

        if (next is null)
        {
            return;
        }

        var delay = next.Value - DateTimeOffset.Now;
        if (delay < TimeSpan.FromMilliseconds(50))
        {
            delay = TimeSpan.FromMilliseconds(50);
        }

        _retryDueTimer = new DispatcherTimer
        {
            Interval = delay,
        };
        _retryDueTimer.Tick += RetryDueTimer_Tick;
        _retryDueTimer.Start();
    }

    private async void RetryDueTimer_Tick(object? sender, EventArgs e)
    {
        StopRetryDueTimer();
        if (_autoWorkerEnabled && _session is not null && !_isBusy && !_remotePaused)
        {
            await RunAutoWorkerCycleAsync();
        }

        ArmRetryDueTimer();
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

        StopRetryDueTimer();
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
        if (CertificateWorkerIdentity.IsSuperAdmin(_session))
        {
            _ = PollRemoteControlAsync();
        }
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
        if (CertificateWorkerIdentity.IsSuperAdmin(_session))
        {
            await PollRemoteControlAsync();
        }
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

        if (CertificateWorkerIdentity.IsSuperAdmin(_session))
        {
            var submitted = _jobs.Count(item => item.Record.IsSubmitted);
            var eligible = _jobs.Count(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id));

            var state = _lastStatusKind switch
            {
                StatusKind.Working => "working",
                StatusKind.Error => "error",
                StatusKind.Success => "idle",
                _ when _autoWorkerPausedForDoca => "login_required",
                _ when _remotePaused => "paused",
                _ when _yieldedToRcEngine => "paused",
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
                    RemotePaused = _remotePaused || _yieldedToRcEngine,
                    DocaSessionState = _autoWorkerPausedForDoca ? "login_required" : "logged_in",
                    QueueTotal = _jobs.Count + _pdfSignerJobs.Count + _signedUploadJobs.Count,
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

        try
        {
            var token = await GetFreshIdTokenAsync();
            var message = Dispatcher.CheckAccess() ? StatusText.Text : await RunOnUiAsync(() => StatusText.Text);
            await _presence.HeartbeatAsync(_session, token, message);
        }
        catch
        {
            // Presence must not stop the worker.
        }
    }

    private async Task PollRemoteControlAsync()
    {
        if (_session is null || !CertificateWorkerIdentity.IsSuperAdmin(_session))
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

        if (_telemetry.ShouldApplyClearJobLocks(remote))
        {
            await ApplyRemoteClearJobLocksAsync(remote);
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

        if (!WorkerProduct.IsEmaapEngineBuild && !string.IsNullOrWhiteSpace(remote.DocaEmail))
        {
            DocaEmailBox.Text = remote.DocaEmail.Trim();
            changed = true;
        }

        if (!WorkerProduct.IsEmaapEngineBuild && !string.IsNullOrWhiteSpace(remote.DocaPassword))
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

    private async Task ApplyRemoteClearJobLocksAsync(WorkerRemoteControlState remote)
    {
        var cleared = _jobRetries.Snapshot().Count;
        _jobRetries.ClearAll();
        RefreshRetryBadges();
        _autoWorkerPausedForDoca = false;
        AddActivityEntry(
            cleared > 0
                ? $"Cleared {cleared} job lock(s) from web admin — re-queueing submitted work."
                : "Cleared job locks from web admin — re-queueing submitted work.");
        _telemetry.MarkClearJobLocksApplied(remote.ClearJobLocksRevision);
        await LoadQueueAsync().ConfigureAwait(false);
        if (_autoWorkerEnabled && _session is not null && !_remotePaused)
        {
            StartAutoWorkerTimers();
            _ = RunAutoWorkerCycleAsync();
        }

        await PublishWorkerStatusAsync().ConfigureAwait(false);
    }

    private void SetDocaLoginPaused(
        bool paused,
        string logoutReason = "login_required",
        bool startResumeProbe = true,
        bool blockAutoLogin = false)
    {
        if (!Dispatcher.CheckAccess())
        {
            // Never block a Playwright worker thread on the UI — sync Invoke deadlocks when UI awaits browser.
            _ = Dispatcher.InvokeAsync(
                () => SetDocaLoginPaused(paused, logoutReason, startResumeProbe, blockAutoLogin));
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
            _ = Dispatcher.InvokeAsync(StartEmaapOtpIdlePoller);
            return;
        }

        StopEmaapOtpIdlePoller();
        _emaapOtpPollTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(5),
        };
        _emaapOtpPollTimer.Tick += EmaapOtpIdlePollTimer_Tick;
        _emaapOtpPollTimer.Start();
        _ = Dispatcher.BeginInvoke(
            DispatcherPriority.Background,
            new Action(() => EmaapOtpIdlePollTimer_Tick(_emaapOtpPollTimer, EventArgs.Empty)));
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
                if (await RunPlaywrightOffUiAsync(() => _automationService.TryResendEmaapOtpIfEnabledAsync()))
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
                var masterState = await RunPlaywrightOffUiAsync(() => _automationService.TrySubmitMasterEmaapOtpAsync());
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
            var state = await RunPlaywrightOffUiAsync(() => _automationService.SubmitEmaapOtpAsync(code));
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
                probe = await RunPlaywrightOffUiAsync(
                    () => _automationService.ProbeDocaSessionAtProtectedRouteAsync(forceAutoLogin: false));
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
                "eMaap session expired (detected by periodic IC verification probe). Retrying auto-login…",
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

            if (!_isBusy)
            {
                await RunAutoWorkerCycleAsync();
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
    }

    private async Task TryResumeAutoWorkerAfterDocaLoginAsync()
    {
        if (_emaapOtpIdle)
        {
            return;
        }

        try
        {
            var state = await RunPlaywrightOffUiAsync(() => _automationService.ProbeDocaSessionAsync());
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
        if (!_autoWorkerEnabled || _session is null || _remotePaused)
        {
            return;
        }

        if (WorkerProduct.IsEmaapEngineBuild && !_emaapReadyForJobs)
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

        var snapshot = await RunOnUiAsync(() => (
            ProcessFill: _processFillQueue,
            ProcessSigner: _processSignerQueue,
            ProcessSigned: _processSignedUploadQueue,
            FillJobs: _jobs
                .Where(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id))
                .Select(item => item.Record)
                .ToList(),
            SignerJobs: _pdfSignerJobs
                .Where(item => _jobRetries.IsEligible(item.Id))
                .Select(item => item.Record)
                .ToList(),
            SignedJobs: _signedUploadJobs
                .Where(item => _jobRetries.IsEligible(item.Id))
                .Select(item => item.Record)
                .ToList())).ConfigureAwait(false);

        var fillQueue = snapshot.ProcessFill ? snapshot.FillJobs : [];
        var signerQueue = snapshot.ProcessSigner ? snapshot.SignerJobs : [];
        var signedQueue = snapshot.ProcessSigned ? snapshot.SignedJobs : [];
        if (signerQueue.Count == 0 && snapshot.ProcessSigner)
        {
            signerQueue = await FetchEligiblePdfSignerJobsAsync().ConfigureAwait(false);
        }

        if (_autoWorkerPausedForDoca)
        {
            if (signerQueue.Count == 0)
            {
                await RunOnUiAsync(UpdateAutoWorkerStatusText).ConfigureAwait(false);
                return;
            }

            await RunWithBusyStateAsync(async () =>
            {
                SetStatusSafe(
                    $"Auto worker — PDF signer burst ({Math.Min(signerQueue.Count, WorkerQueueStagePicker.StampBurstMax)}) while eMAAP paused…",
                    StatusKind.Working);
                await ProcessStampBurstAsync(signerQueue).ConfigureAwait(false);
                await RunOnUiAsync(UpdateAutoWorkerStatusText).ConfigureAwait(false);
            }, offUiThread: true).ConfigureAwait(false);
            return;
        }

        var emaap = WorkerQueueStagePicker.NextEmaap(
            snapshot.ProcessFill,
            snapshot.ProcessSigned,
            fillQueue.Count,
            signedQueue.Count,
            _lastEmaapStage);

        if (emaap is null
            && snapshot.ProcessSigned
            && fillQueue.Count == 0
            && signedQueue.Count == 0
            && _session is not null)
        {
            var token = await GetFreshIdTokenAsync().ConfigureAwait(false);
            signedQueue = (await _firestoreService.GetPendingSignedPdfUploadQueueAsync(token).ConfigureAwait(false))
                .Where(item => _jobRetries.IsEligible(item.Id))
                .ToList();
            emaap = WorkerQueueStagePicker.NextEmaap(
                snapshot.ProcessFill,
                snapshot.ProcessSigned,
                fillQueue.Count,
                signedQueue.Count,
                _lastEmaapStage);
        }

        if (emaap is null && signerQueue.Count == 0)
        {
            await RunOnUiAsync(UpdateAutoWorkerStatusText).ConfigureAwait(false);
            return;
        }

        await RunWithBusyStateAsync(async () =>
        {
            if (emaap == WorkerQueueStage.FillCertify)
            {
                _lastEmaapStage = WorkerQueueStage.FillCertify;
                SetStatusSafe(
                    $"Auto worker — fill & certify · {fillQueue.Count} waiting…",
                    StatusKind.Working);
                await ProcessAllJobsSequentiallyAsync(fillQueue, fromAutoWorker: true, maxJobs: 1)
                    .ConfigureAwait(false);
            }
            else if (emaap == WorkerQueueStage.SignedEmaapUpload)
            {
                _lastEmaapStage = WorkerQueueStage.SignedEmaapUpload;
                SetStatusSafe(
                    $"Auto worker — signed PDF → eMAAP · {signedQueue.Count} waiting…",
                    StatusKind.Working);
                await ProcessAllJobsSequentiallyAsync(signedQueue, fromAutoWorker: true, maxJobs: 1)
                    .ConfigureAwait(false);
            }

            if (_processSignerQueue && _session is not null)
            {
                var freshSigner = await FetchEligiblePdfSignerJobsAsync().ConfigureAwait(false);
                if (freshSigner.Count > 0)
                {
                    SetStatusSafe(
                        $"Auto worker — PDF signer burst ({Math.Min(freshSigner.Count, WorkerQueueStagePicker.StampBurstMax)})…",
                        StatusKind.Working);
                    await ProcessStampBurstAsync(freshSigner).ConfigureAwait(false);
                }
            }

            await RunOnUiAsync(UpdateAutoWorkerStatusText).ConfigureAwait(false);
        }, offUiThread: true).ConfigureAwait(false);
    }

    private async Task<List<SiteCalibrationRecord>> FetchEligiblePdfSignerJobsAsync()
    {
        if (_session is null)
        {
            return [];
        }

        var token = await GetFreshIdTokenAsync().ConfigureAwait(false);
        return (await _firestoreService.GetPendingPdfSignerQueueAsync(token).ConfigureAwait(false))
            .Where(item => _jobRetries.IsEligible(item.Id))
            .ToList();
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

        foreach (var item in _pdfSignerJobs)
        {
            item.RetryBadge = _jobRetries.BadgeFor(item.Id);
        }

        foreach (var item in _signedUploadJobs)
        {
            item.RetryBadge = _jobRetries.BadgeFor(item.Id);
        }

        UpdateAutoWorkerStatusText();
    }

    /// <summary>Single stage — Submitted → eMAAP fill+certify. Only MaxSubmitRetries applies.</summary>
    private static int ResolveMaxRetriesFor(SiteCalibrationRecord job) =>
        Math.Max(1, App.Settings.AutoWorker.MaxSubmitRetries);

    private void ScheduleJobRetry(SiteCalibrationRecord job, string error, int? maxRetries = null)
    {
        var max = maxRetries ?? ResolveMaxRetriesFor(job);
        if (PipelineFailureClassifier.IsPermanentDataFailure(error))
        {
            _jobRetries.MarkExhausted(job.Id, error, max);
            RefreshRetryBadges();
            return;
        }

        _jobRetries.Schedule(
            job.Id,
            error,
            TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds),
            max);
        RefreshRetryBadges();
        ArmRetryDueTimer();
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
            AutoWorkerStatusText.Text = "Auto-run off — turn on to process queues whose Process switch is on.";
            _statusHud?.UpdateContext(AutoWorkerStatusText.Text);
            return;
        }

        if (_remotePaused)
        {
            AutoWorkerStatusText.Text = "Paused from web admin — resume in Integrations → Automation Worker.";
            _statusHud?.UpdateContext(AutoWorkerStatusText.Text);
            return;
        }

        if (_session is null)
        {
            AutoWorkerStatusText.Text = "Sign in to start unattended processing.";
            _statusHud?.UpdateContext(AutoWorkerStatusText.Text);
            return;
        }

        if (_autoWorkerPausedForDoca)
        {
            var signerWaiting = _processSignerQueue
                ? _pdfSignerJobs.Count(item => _jobRetries.IsEligible(item.Id))
                : 0;
            AutoWorkerStatusText.Text = signerWaiting > 0
                ? $"eMAAP paused — still stamping PDF signer ({signerWaiting}). Fix login to resume fill/upload."
                : "Paused — eMAAP login / HALT. Finish login, then turn Auto-run on.";
            _statusHud?.UpdateContext(AutoWorkerStatusText.Text);
            return;
        }

        var waitingRetries = _jobRetries.Snapshot().Count(pair => DateTimeOffset.Now < pair.Value.RetryAt);
        var fillEligible = _processFillQueue
            ? _jobs.Count(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id))
            : 0;
        var signerEligible = _processSignerQueue
            ? _pdfSignerJobs.Count(item => _jobRetries.IsEligible(item.Id))
            : 0;
        var signedEligible = _processSignedUploadQueue
            ? _signedUploadJobs.Count(item => _jobRetries.IsEligible(item.Id))
            : 0;
        var stage = WorkerQueueStagePicker.Next(
            _processFillQueue,
            _processSignerQueue,
            _processSignedUploadQueue,
            fillEligible,
            signerEligible,
            signedEligible,
            _lastEmaapStage);
        var watchMode = _realtimeListenerActive
            ? "watching Firestore live"
            : $"polling every {App.Settings.AutoWorker.PollIntervalSeconds}s";
        var probeMinutes = DocaSessionProbeMinutesSetting;
        var probeNote = probeMinutes > 0 ? $" · eMAAP session probe every {probeMinutes} min" : string.Empty;
        var skipped = new List<string>();
        if (!_processFillQueue)
        {
            skipped.Add("fill off");
        }

        if (!_processSignerQueue)
        {
            skipped.Add("signer off");
        }

        if (!_processSignedUploadQueue)
        {
            skipped.Add("signed off");
        }

        var skipNote = skipped.Count > 0 ? $" · {string.Join(", ", skipped)}" : string.Empty;
        var nextNote = stage switch
        {
            WorkerQueueStage.FillCertify => $"{fillEligible} fill & certify next",
            WorkerQueueStage.PdfSigner => $"{signerEligible} PDF signer next",
            WorkerQueueStage.SignedEmaapUpload => $"{signedEligible} signed PDF upload next",
            _ => !_processFillQueue && !_processSignerQueue && !_processSignedUploadQueue
                ? "all process switches off"
                : "queues empty",
        };
        AutoWorkerStatusText.Text = waitingRetries > 0
            ? $"Running — {nextNote}{skipNote}, {waitingRetries} waiting for retry ({watchMode}{probeNote})."
            : $"Running — {watchMode} · {nextNote}{skipNote}{probeNote}.";

        _statusHud?.UpdateContext(AutoWorkerStatusText.Text);
    }

    private async void SignInButton_Click(object sender, RoutedEventArgs e)
    {
        await SignInAndLoadAsync();
        if (WorkerProduct.IsEmaapEngineBuild)
        {
            ForceEmaapEngineAutoWorker();
        }

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
            SetStatus("Sign in first to refresh.", StatusKind.Info);
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
        if (_syncingQueueSelection)
        {
            return;
        }

        var item = JobsGrid.SelectedItem as CertificationQueueItem;
        if (item is not null)
        {
            _syncingQueueSelection = true;
            try
            {
                SignerJobsGrid.SelectedItem = null;
                SignedJobsGrid.SelectedItem = null;
            }
            finally
            {
                _syncingQueueSelection = false;
            }
        }

        SetSelectedQueueItem(item ?? SignerJobsGrid.SelectedItem as CertificationQueueItem
            ?? SignedJobsGrid.SelectedItem as CertificationQueueItem);
        UpdateProcessSubmittedButtonVisibility();
        await ShowSelectedJobDocumentAsync(_selectedQueueItem);
    }

    private async void SignedJobsGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncingQueueSelection)
        {
            return;
        }

        var item = SignedJobsGrid.SelectedItem as CertificationQueueItem;
        if (item is not null)
        {
            _syncingQueueSelection = true;
            try
            {
                JobsGrid.SelectedItem = null;
                SignerJobsGrid.SelectedItem = null;
            }
            finally
            {
                _syncingQueueSelection = false;
            }
        }

        SetSelectedQueueItem(item ?? JobsGrid.SelectedItem as CertificationQueueItem
            ?? SignerJobsGrid.SelectedItem as CertificationQueueItem);
        UpdateProcessSubmittedButtonVisibility();
        await ShowSelectedJobDocumentAsync(_selectedQueueItem);
    }

    private async void SignerJobsGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncingQueueSelection)
        {
            return;
        }

        var item = SignerJobsGrid.SelectedItem as CertificationQueueItem;
        if (item is not null)
        {
            _syncingQueueSelection = true;
            try
            {
                JobsGrid.SelectedItem = null;
                SignedJobsGrid.SelectedItem = null;
            }
            finally
            {
                _syncingQueueSelection = false;
            }
        }

        SetSelectedQueueItem(item ?? JobsGrid.SelectedItem as CertificationQueueItem
            ?? SignedJobsGrid.SelectedItem as CertificationQueueItem);
        UpdateProcessSubmittedButtonVisibility();
        await ShowSelectedJobDocumentAsync(_selectedQueueItem);
    }

    private void UpdateProcessSubmittedButtonVisibility()
    {
        var item = _selectedQueueItem;
        var selectedSubmitted = item?.Record.IsSubmitted == true && _session is not null;
        ProcessSelectedEmaapButton.Visibility = selectedSubmitted
            ? Visibility.Visible
            : Visibility.Collapsed;
        FillOnlySelectedEmaapButton.Visibility = selectedSubmitted
            ? Visibility.Visible
            : Visibility.Collapsed;

        var signerRow = IsPdfSignerRow(item);
        PdfSignerSignButton.Visibility = signerRow ? Visibility.Visible : Visibility.Collapsed;
        PdfSignerDownloadButton.Visibility = signerRow ? Visibility.Visible : Visibility.Collapsed;
        PdfSignerSignButton.IsEnabled = signerRow;
    }

    private void SetManualQueueButtonsEnabled(bool enabled)
    {
        FillOnlySelectedEmaapButton.IsEnabled = enabled;
        ProcessSelectedEmaapButton.IsEnabled = enabled;
        PdfSignerSignButton.IsEnabled = enabled;
        PdfSignerDownloadButton.IsEnabled = enabled;
        if (enabled)
        {
            UpdateProcessSubmittedButtonVisibility();
        }
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
            SetStatus($"Sign in as {WorkerProduct.SignInRoleLabel} first.", StatusKind.Info);
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

        SetManualQueueButtonsEnabled(false);
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
                if (party.FiledUnderRc)
                {
                    AddActivityEntry(
                        $"PIN outside Kerala — filing serial {instrument.SerialNumber} under RC name {party.BelongToName}");
                }
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
            SetManualQueueButtonsEnabled(true);
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
            SetStatus($"Sign in as {WorkerProduct.SignInRoleLabel} first.", StatusKind.Info);
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

        SetManualQueueButtonsEnabled(false);
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
                if (party.FiledUnderRc)
                {
                    AddActivityEntry(
                        $"PIN outside Kerala — filing serial {instrument.SerialNumber} under RC name {party.BelongToName}");
                }
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
            SetManualQueueButtonsEnabled(true);
        }
    }

    private bool IsPdfSignerRow(CertificationQueueItem? item) =>
        item is not null
        && _pdfSignerJobs.Any(job => string.Equals(job.Id, item.Id, StringComparison.Ordinal));

    private async void PdfSignerSignButton_Click(object sender, RoutedEventArgs e)
    {
        var item = _selectedQueueItem;
        if (!IsPdfSignerRow(item) || item is null)
        {
            SetStatus("Select a PDF signer job first.", StatusKind.Info);
            return;
        }

        if (_session is null)
        {
            SetStatus($"Sign in as {WorkerProduct.SignInRoleLabel} first.", StatusKind.Info);
            ExpandAccountPanel();
            return;
        }

        if (string.IsNullOrWhiteSpace(item.Record.RcId))
        {
            SetStatus("RC id is missing for this job.", StatusKind.Info);
            return;
        }

        var record = item.Record;
        var uid = _session.UserId;
        var label = string.IsNullOrWhiteSpace(record.CertificateNumber)
            ? record.SerialNumber
            : record.CertificateNumber;

        SetManualQueueButtonsEnabled(false);
        try
        {
            await RunWithBusyStateAsync(async () =>
            {
                SetStatusSafe($"Stamping officer signature on {label}…", StatusKind.Working);
                var claimed = await TryClaimCurrentJobAsync(record).ConfigureAwait(false);
                if (!claimed)
                {
                    SetStatusSafe($"{label} held by another worker.", StatusKind.Info);
                    return;
                }

                try
                {
                    var token = await GetFreshIdTokenAsync().ConfigureAwait(false);
                    var outcome = await _pdfImageStampService
                        .StampAndUploadAsync(record, token, uid)
                        .ConfigureAwait(false);
                    var message = outcome switch
                    {
                        PdfStampOutcome.Uploaded => $"Signed {label}. Stamped PDF uploaded to Firebase.",
                        PdfStampOutcome.SkippedAlreadySigned => $"{label} already has a signed PDF.",
                        PdfStampOutcome.SkippedNotPdfSigner => $"{label} RC is not PDF signer.",
                        PdfStampOutcome.SkippedDead => $"{label} is voided or superseded.",
                        PdfStampOutcome.MissingUnsignedPdf => $"No unsigned PDF yet for {label}.",
                        _ => $"PDF signer finished {label}.",
                    };
                    if (outcome == PdfStampOutcome.Uploaded)
                    {
                        var local = Path.Combine(
                            WorkerDataPaths.CertificatePdfDirectory(record.Id),
                            PdfImageStampService.SuggestedSignedFileName(record));
                        if (File.Exists(local))
                        {
                            var download = PdfImageStampService.UniquePath(
                                Path.Combine(DefaultDownloadsDirectory(), Path.GetFileName(local)));
                            File.Copy(local, download, overwrite: false);
                            await RunOnUiAsync(() => OpenSavedPath(download));
                        }
                    }

                    AddActivityEntry(message);
                    SetStatusSafe(
                        message,
                        outcome == PdfStampOutcome.Uploaded ? StatusKind.Success : StatusKind.Info);
                    await LoadQueueAsync().ConfigureAwait(false);
                }
                finally
                {
                    if (_session is not null)
                    {
                        await _firestoreService.ReleaseClaimAsync(record.Id, _session).ConfigureAwait(false);
                    }
                }
            }, offUiThread: true);
        }
        catch (Exception ex)
        {
            SetStatus($"PDF signer failed: {ex.Message}", ex, StatusKind.Error);
            AddActivityEntry($"PDF signer failed: {ex.Message}");
        }
        finally
        {
            SetManualQueueButtonsEnabled(true);
        }
    }

    private async void PdfSignerDownloadButton_Click(object sender, RoutedEventArgs e)
    {
        var item = _selectedQueueItem;
        if (!IsPdfSignerRow(item) || item is null)
        {
            SetStatus("Select a PDF signer job first.", StatusKind.Info);
            return;
        }

        if (_session is null)
        {
            SetStatus($"Sign in as {WorkerProduct.SignInRoleLabel} first.", StatusKind.Info);
            ExpandAccountPanel();
            return;
        }

        var record = item.Record;
        var destination = PdfImageStampService.UniquePath(
            Path.Combine(DefaultDownloadsDirectory(), PdfImageStampService.SuggestedFileName(record, signed: false)));
        SetManualQueueButtonsEnabled(false);
        try
        {
            await RunWithBusyStateAsync(async () =>
            {
                SetStatusSafe($"Downloading {Path.GetFileName(destination)}…", StatusKind.Working);
                var token = await GetFreshIdTokenAsync().ConfigureAwait(false);
                await _pdfImageStampService
                    .DownloadPdfAsync(record, token, destination, preferSigned: false)
                    .ConfigureAwait(false);
                await RunOnUiAsync(() => OpenSavedPath(destination));
                SetStatusSafe($"Saved {Path.GetFileName(destination)} to Downloads.", StatusKind.Success);
                AddActivityEntry($"Downloaded unsigned PDF {Path.GetFileName(destination)}");
            }, offUiThread: true);
        }
        catch (Exception ex)
        {
            SetStatus($"Download failed: {ex.Message}", ex, StatusKind.Error);
            AddActivityEntry($"Download failed: {ex.Message}");
        }
        finally
        {
            SetManualQueueButtonsEnabled(true);
        }
    }

    private static string DefaultDownloadsDirectory()
    {
        var downloads = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Downloads");
        Directory.CreateDirectory(downloads);
        return downloads;
    }

    private static void OpenSavedPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return;
        }

        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
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
            JobDetailBox.Text = $"Sign in as {WorkerProduct.SignInRoleLabel} to load document details.";
            return;
        }

        var jobId = item.Id;
        JobDetailBox.Text = $"Loading siteCalibrations/{jobId}…";
        try
        {
            var token = await GetFreshIdTokenAsync();
            var text = await _firestoreService.FormatSiteCalibrationDocumentAsync(jobId, token);
            // Selection may have changed while loading.
            if (_selectedQueueItem is { } selected
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
                MessageBox.Show(this, "Log file does not exist yet.", WorkerProduct.AppName, MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Could not open log file: {ex.Message}", WorkerProduct.AppName, MessageBoxButton.OK, MessageBoxImage.Error);
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
            if (WorkerProduct.IsEmaapEngineBuild)
            {
                SetStatus("Type captcha + OTP in Chrome. Auto-worker keeps the queue running.", StatusKind.Working);
                ScheduleJobRetry(job, result.Message);
                return;
            }

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
        // eMAAP fill+certify and signed-PDF upload share one Chrome.
        if (sequentialOnly
            || queue.Any(job => job.IsSubmitted || job.IsEligibleForSignedPdfUpload))
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

    private async Task ProcessAllJobsSequentiallyAsync(
        IReadOnlyList<SiteCalibrationRecord> queue,
        bool fromAutoWorker,
        int maxJobs = int.MaxValue)
    {
        var completed = 0;
        var failed = 0;
        string? lastError = null;
        var continueSession = _automationService.IsBrowserConnected;
        var attempts = 0;

        for (var i = 0; i < queue.Count; i++)
        {
            var job = queue[i];
            var batchLabel = $"Job {i + 1} of {queue.Count}";

            SelectJobOnUiThread(job.Id);
            SetStatusSafe($"{batchLabel} · Serial {job.SerialNumber} ({job.NextStepLabel})…", StatusKind.Working);

            var claimed = false;
            try
            {
                if (fromAutoWorker && !IsAutoWorkerStageEnabled(job))
                {
                    AddActivityEntry($"{batchLabel} stopped — process switch off for this queue.");
                    await LoadQueueAsync();
                    if (maxJobs == int.MaxValue)
                    {
                        ReportBatchSummary(queue.Count, completed, failed, lastError, loginStopped: false);
                    }

                    return;
                }

                claimed = await TryClaimCurrentJobAsync(job).ConfigureAwait(false);
                if (!claimed)
                {
                    AddActivityEntry($"{batchLabel} skipped — claimed by another worker ({job.SerialNumber}).");
                    continue;
                }

                attempts++;
                var result = await ProcessJobWithRecoveryAsync(
                    job,
                    _automationService,
                    continueBrowserSession: continueSession || i > 0);

                continueSession = _automationService.IsBrowserConnected;

                if (result.Completed && _session is not null)
                {
                    await _firestoreService.ReleaseClaimAsync(job.Id, _session).ConfigureAwait(false);
                }

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
                        if (maxJobs == int.MaxValue)
                        {
                            ReportBatchSummary(
                                queue.Count,
                                completed,
                                failed,
                                lastError,
                                loginStopped: result.LoginRequired);
                        }

                        return;
                    }
                }

                if (attempts >= maxJobs)
                {
                    await LoadQueueAsync();
                    return;
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
                        $"{batchLabel} — halted. Fix the issue, then turn Auto-run on.");
                    await LoadQueueAsync();
                    if (maxJobs == int.MaxValue)
                    {
                        ReportBatchSummary(queue.Count, completed, failed, lastError, loginStopped: false);
                    }

                    return;
                }

                if (attempts >= maxJobs)
                {
                    await LoadQueueAsync();
                    return;
                }
            }
        }

        await LoadQueueAsync();
        if (maxJobs == int.MaxValue)
        {
            ReportBatchSummary(queue.Count, completed, failed, lastError, loginStopped: false);
        }
    }

    private bool IsAutoWorkerStageEnabled(SiteCalibrationRecord job)
    {
        if (job.IsSubmitted)
        {
            return _processFillQueue;
        }

        if (job.IsEligibleForSignedPdfUpload)
        {
            return _processSignedUploadQueue;
        }

        return _processSignerQueue;
    }

    private async Task ProcessStampBurstAsync(IReadOnlyList<SiteCalibrationRecord> queue)
    {
        if (WorkerProduct.IsEmaapEngineBuild || !_processSignerQueue)
        {
            return;
        }

        var take = queue
            .Where(job => _jobRetries.IsEligible(job.Id))
            .Take(WorkerQueueStagePicker.StampBurstMax)
            .ToList();
        foreach (var job in take)
        {
            if (!_processSignerQueue || !_autoWorkerEnabled || _remotePaused)
            {
                break;
            }

            SelectJobOnUiThread(job.Id);
            var label = string.IsNullOrWhiteSpace(job.CertificateNumber)
                ? job.SerialNumber
                : job.CertificateNumber;
            SetStatusSafe($"PDF signer · {label}…", StatusKind.Working);

            var claimed = await TryClaimCurrentJobAsync(job).ConfigureAwait(false);
            if (!claimed)
            {
                AddActivityEntry($"PDF signer skipped — claimed by another worker ({job.SerialNumber}).");
                continue;
            }

            try
            {
                var result = await ProcessStampJobAsync(job).ConfigureAwait(false);
                if (result.Completed)
                {
                    _jobRetries.Clear(job.Id);
                    SetStatusSafe(result.Message, StatusKind.Success);
                }
                else
                {
                    var max = result.Message.Contains("unsigned PDF", StringComparison.OrdinalIgnoreCase)
                        ? 20
                        : ResolveMaxRetriesFor(job);
                    ScheduleJobRetry(job, result.Message, max);
                    SetStatusSafe(result.Message, StatusKind.Info);
                }

                AddActivityEntry(result.Message);
            }
            catch (Exception ex)
            {
                ScheduleJobRetry(job, ex.Message);
                SetStatusSafe($"PDF signer failed {job.SerialNumber}: {ex.Message}", ex, StatusKind.Error);
                AddActivityEntry($"PDF signer failed {job.SerialNumber}: {ex.Message}");
            }
            finally
            {
                if (_session is not null)
                {
                    await _firestoreService.ReleaseClaimAsync(job.Id, _session).ConfigureAwait(false);
                }
            }
        }
    }

    private async Task<JobPipelineResult> ProcessStampJobAsync(SiteCalibrationRecord job)
    {
        if (_session is null)
        {
            throw new InvalidOperationException($"Sign in as {WorkerProduct.SignInRoleLabel} first.");
        }

        var token = await GetFreshIdTokenAsync().ConfigureAwait(false);
        var outcome = await _pdfImageStampService
            .StampAndUploadAsync(job, token, _session.UserId)
            .ConfigureAwait(false);
        var cert = string.IsNullOrWhiteSpace(job.CertificateNumber) ? job.SerialNumber : job.CertificateNumber;
        return outcome switch
        {
            PdfStampOutcome.Uploaded => new JobPipelineResult(
                true,
                false,
                $"Stamped and uploaded signed PDF for {cert}."),
            PdfStampOutcome.SkippedAlreadySigned => new JobPipelineResult(
                true,
                false,
                $"{cert} already has a signed PDF — skipped stamp."),
            PdfStampOutcome.SkippedNotPdfSigner => new JobPipelineResult(
                true,
                false,
                $"{cert} RC is not PDF signer — skipped stamp."),
            PdfStampOutcome.SkippedDead => new JobPipelineResult(
                true,
                false,
                $"{cert} voided or superseded — skipped stamp."),
            PdfStampOutcome.MissingUnsignedPdf => new JobPipelineResult(
                false,
                false,
                $"No unsigned PDF yet for {cert} — will retry.",
                SoftFail: true),
            _ => new JobPipelineResult(false, false, $"PDF signer unknown result for {cert}.", SoftFail: true),
        };
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

        if (result.SoftFail)
        {
            failed++;
            lastError = result.Message;
            ScheduleJobRetry(job, result.Message);
            SetStatusSafe($"{batchLabel} · {result.Message}", StatusKind.Info);
            AddActivityEntry($"{batchLabel} · {result.Message}");
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
            _ = Dispatcher.InvokeAsync(() => HaltWorkerPipeline(message));
            return;
        }

        _autoWorkerPausedForDoca = true;
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
                    if (!await TryClaimCurrentJobAsync(job).ConfigureAwait(false))
                    {
                        AddActivityEntry($"{label} skipped — claimed by another worker.");
                        continue;
                    }

                    var result = await ProcessJobWithRecoveryAsync(
                        job,
                        automation,
                        continueBrowserSession: i > 0);

                    if (result.Completed && _session is not null)
                    {
                        await _firestoreService.ReleaseClaimAsync(job.Id, _session).ConfigureAwait(false);
                    }

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

                        SetStatusSafe($"{label} — eMaap login required in Chrome {workerIndex + 1}.", StatusKind.Error);
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
                $"Batch paused — eMaap auto-login in progress. {completed} completed so far. {lastError}",
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

    private static Task RunPlaywrightOffUiAsync(Func<Task> action) =>
        Task.Run(async () => await action().ConfigureAwait(false));

    private static Task<T> RunPlaywrightOffUiAsync<T>(Func<Task<T>> action) =>
        Task.Run(async () => await action().ConfigureAwait(false));

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
            throw new InvalidOperationException($"Sign in as {WorkerProduct.SignInRoleLabel} first.");
        }

        if (job.IsEligibleForSignedPdfUpload)
        {
            automation.DocaCredentials = await ResolveDocaCredentialsAsync().ConfigureAwait(false);
            SetStatusSafe(
                $"eMAAP · Upload signed PDF {job.CertificateNumber} ({job.SerialNumber})…",
                StatusKind.Working);
            try
            {
                var uploadToken = await GetFreshIdTokenAsync();
                var message = await automation.UploadEmaapSignedPdfAsync(job, uploadToken);
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

        if (party.FiledUnderRc)
        {
            AddActivityEntry(
                $"PIN outside Kerala — filing serial {current.SerialNumber} under RC name {party.BelongToName}");
        }

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
            throw new InvalidOperationException($"Sign in as {WorkerProduct.SignInRoleLabel} first.");
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
        var generate = _jobs.FirstOrDefault(item => string.Equals(item.Id, jobId, StringComparison.Ordinal));
        if (generate is not null)
        {
            SelectQueueItem(generate);
            return;
        }

        var signer = _pdfSignerJobs.FirstOrDefault(item => string.Equals(item.Id, jobId, StringComparison.Ordinal));
        if (signer is not null)
        {
            SelectQueueItem(signer);
            return;
        }

        var signed = _signedUploadJobs.FirstOrDefault(item => string.Equals(item.Id, jobId, StringComparison.Ordinal));
        if (signed is not null)
        {
            SelectQueueItem(signed);
        }
    }

    private void ApplyCertificateWorkerSession(FirebaseSignInResult session)
    {
        var rcScope = CertificateWorkerIdentity.IsEmaapEngine(session) ? session.UserId : null;
        _firestoreService.QueueRcIdFilter = rcScope;
        _queueListener.ScopeRcId = rcScope;
        EmaapLoginAutomation.PreferManualLoginUntilAuthenticated = WorkerProduct.IsEmaapEngineBuild;
        Title = WorkerProduct.AppName;
    }

    private async Task<bool> TryClaimCurrentJobAsync(SiteCalibrationRecord job)
    {
        if (_session is null)
        {
            return false;
        }

        await GetFreshIdTokenAsync().ConfigureAwait(false);
        if (_session is null)
        {
            return false;
        }

        var claimed = await _firestoreService.TryClaimJobAsync(job.Id, _session).ConfigureAwait(false);
        if (!claimed)
        {
            SetStatusSafe(
                $"Queue skip · {job.SerialNumber} held by another worker.",
                StatusKind.Info);
        }

        return claimed;
    }

    private async Task StartEmaapEngineSessionAsync()
    {
        var hasSavedRc = !string.IsNullOrWhiteSpace(AadharBox.Text)
            && !string.IsNullOrWhiteSpace(PasswordBox.Text);
        if (!hasSavedRc)
        {
            PortalLoginPanel.Visibility = Visibility.Visible;
            ExpandAccountPanel();
            SetStatus(
                "Enter RC Aadhar + password once. This PC saves it and will not ask again.",
                StatusKind.Idle);
            return;
        }

        PortalLoginPanel.Visibility = Visibility.Collapsed;
        await SignInAndLoadAsync();
        if (_session is null)
        {
            PortalLoginPanel.Visibility = Visibility.Visible;
            ExpandAccountPanel();
            SetStatus("RC sign-in failed. Enter Aadhar + password again.", StatusKind.Error);
            return;
        }

        ForceEmaapEngineAutoWorker();
        await StartDocaBrowserAsync();
        BeginWorkerServicesAfterDocaBrowser();
    }

    private void OnEmaapPortalLoggedIn()
    {
        if (!WorkerProduct.IsEmaapEngineBuild)
        {
            return;
        }

        if (_emaapReadyForJobs)
        {
            _ = RunAutoWorkerCycleAsync();
            return;
        }

        _emaapReadyForJobs = true;
        _autoWorkerPausedForDoca = false;
        _telemetry.MarkDocaLoggedIn();
        StartDocaSessionWatchdogTimer();
        MainTabs.SelectedIndex = 0;
        SetStatus("eMAAP login ok. Starting fill & certify now.", StatusKind.Success);
        AddActivityEntry("eMAAP login ok — auto-worker starting immediately.");
        UpdateAutoWorkerStatusText();
        StartAutoWorkerTimers();
        _ = RunAutoWorkerCycleAsync();
    }

    private void ForceEmaapEngineAutoWorker()
    {
        if (!WorkerProduct.IsEmaapEngineBuild)
        {
            return;
        }

        _autoWorkerEnabled = true;
        _autoWorkerPausedForDoca = false;
        _suppressAutoRunCheckBoxEvent = true;
        try
        {
            AutoRunCheckBox.IsChecked = true;
        }
        finally
        {
            _suppressAutoRunCheckBoxEvent = false;
        }

        PersistCredentials();
        UpdateAutoWorkerStatusText();
    }

    private async Task SignInAndLoadAsync()
    {
        await RunWithBusyStateAsync(async () =>
        {
            SetStatus("Signing in…", StatusKind.Working);
            _session = WorkerProduct.IsEmaapEngineBuild
                ? await _authService.SignInAsRcAdminAsync(AadharBox.Text, PasswordBox.Text)
                : await _authService.SignInAsSuperAdminAsync(AadharBox.Text, PasswordBox.Text);
            ApplyCertificateWorkerSession(_session);

            PersistCredentials();
            SyncDocaCredentialsToAllAutomation();
            UpdateSignInSummary();
            SignInExpander.IsExpanded = false;
            if (WorkerProduct.IsEmaapEngineBuild)
            {
                PortalLoginPanel.Visibility = Visibility.Collapsed;
                MainTabs.SelectedIndex = 0;
            }

            await FlushPendingCaptchaReportsAsync();

            SetStatus(
                WorkerProduct.IsEmaapEngineBuild
                    ? "RC verified and saved on this PC. Opening eMAAP — type captcha and OTP in Chrome."
                    : "Signed in. Loading certification queue...",
                StatusKind.Working);
            if (_useRealtimeListener)
            {
                await StartQueueListenerAsync();
            }

            if (!_realtimeListenerActive)
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
        var generate = await _firestoreService.GetPendingCertificationQueueAsync(token).ConfigureAwait(false);
        IReadOnlyList<SiteCalibrationRecord> signer = [];
        IReadOnlyList<SiteCalibrationRecord> signed;
        try
        {
            signer = await _firestoreService.GetPendingPdfSignerQueueAsync(token).ConfigureAwait(false);
        }
        catch
        {
            signer = [];
        }

        try
        {
            signed = await _firestoreService.GetPendingSignedPdfUploadQueueAsync(token).ConfigureAwait(false);
        }
        catch
        {
            signed = [];
        }

        await RunOnUiAsync(() =>
        {
            ApplyQueueRecords(
                generate,
                $"Loaded {generate.Count} fill & certify · {signer.Count} PDF signer · {signed.Count} signed upload.");
            ApplyPdfSignerRecords(signer);
            ApplySignedUploadRecords(signed);
        });
    }

    private void ApplyQueueRecords(
        IReadOnlyList<SiteCalibrationRecord> records,
        string statusMessage,
        bool quietStatus = false)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => ApplyQueueRecords(records, statusMessage, quietStatus));
            return;
        }

        var previousId = _selectedQueueItem?.Id;
        SyncQueueItems(_jobs, records);
        RestoreSelection(previousId);
        UpdateQueueSummary();
        UpdateEmptyState();
        UpdateProcessSubmittedButtonVisibility();
        _ = ShowSelectedJobDocumentAsync(_selectedQueueItem);

        var pending = _jobs.Count(job => job.NeedsPipelineWork);
        var eligible = _jobs.Count(job => job.NeedsPipelineWork && _jobRetries.IsEligible(job.Id));
        if (!quietStatus)
        {
            SetStatus(
                $"{statusMessage} ({eligible}/{pending} fill & certify · {_pdfSignerJobs.Count} PDF signer · {_signedUploadJobs.Count} signed waiting).",
                StatusKind.Success);
        }

        UpdateAutoWorkerStatusText();
    }

    private void ApplySignedUploadRecords(IReadOnlyList<SiteCalibrationRecord> records)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => ApplySignedUploadRecords(records));
            return;
        }

        var previousId = _selectedQueueItem?.Id;
        SyncQueueItems(_signedUploadJobs, records);
        RestoreSelection(previousId);
        UpdateQueueSummary();
        UpdateEmptyState();
        UpdateProcessSubmittedButtonVisibility();
        _ = ShowSelectedJobDocumentAsync(_selectedQueueItem);
        UpdateAutoWorkerStatusText();
    }

    private void ApplyPdfSignerRecords(IReadOnlyList<SiteCalibrationRecord> records)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => ApplyPdfSignerRecords(records));
            return;
        }

        var previousId = _selectedQueueItem?.Id;
        SyncQueueItems(_pdfSignerJobs, records);
        RestoreSelection(previousId);
        UpdateQueueSummary();
        UpdateEmptyState();
        UpdateProcessSubmittedButtonVisibility();
        _ = ShowSelectedJobDocumentAsync(_selectedQueueItem);
        UpdateAutoWorkerStatusText();
    }

    private void SyncQueueItems(
        ObservableCollection<CertificationQueueItem> target,
        IReadOnlyList<SiteCalibrationRecord> records)
    {
        var sameIds = target.Count == records.Count;
        if (sameIds)
        {
            for (var i = 0; i < records.Count; i++)
            {
                if (!string.Equals(target[i].Id, records[i].Id, StringComparison.Ordinal))
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
                target[i] = new CertificationQueueItem(records[i])
                {
                    RetryBadge = _jobRetries.BadgeFor(records[i].Id),
                };
            }

            return;
        }

        target.Clear();
        foreach (var record in records)
        {
            target.Add(new CertificationQueueItem(record)
            {
                RetryBadge = _jobRetries.BadgeFor(record.Id),
            });
        }
    }

    private void RestoreSelection(string? previousId)
    {
        if (!string.IsNullOrWhiteSpace(previousId))
        {
            var keep = _jobs.FirstOrDefault(job => job.Id == previousId)
                ?? _pdfSignerJobs.FirstOrDefault(job => job.Id == previousId)
                ?? _signedUploadJobs.FirstOrDefault(job => job.Id == previousId);
            if (keep is not null)
            {
                SelectQueueItem(keep, scroll: false);
                return;
            }
        }

        SelectQueueItem(
            _jobs.FirstOrDefault() ?? _pdfSignerJobs.FirstOrDefault() ?? _signedUploadJobs.FirstOrDefault(),
            scroll: false);
    }

    private void SelectQueueItem(CertificationQueueItem? item, bool scroll = true)
    {
        _syncingQueueSelection = true;
        try
        {
            if (item is null)
            {
                JobsGrid.SelectedItem = null;
                SignerJobsGrid.SelectedItem = null;
                SignedJobsGrid.SelectedItem = null;
                SetSelectedQueueItem(null);
                return;
            }

            var generate = _jobs.FirstOrDefault(job => job.Id == item.Id);
            if (generate is not null)
            {
                SignerJobsGrid.SelectedItem = null;
                SignedJobsGrid.SelectedItem = null;
                JobsGrid.SelectedItem = generate;
                if (scroll)
                {
                    JobsGrid.ScrollIntoView(generate);
                }

                SetSelectedQueueItem(generate);
                return;
            }

            var signer = _pdfSignerJobs.FirstOrDefault(job => job.Id == item.Id);
            if (signer is not null)
            {
                JobsGrid.SelectedItem = null;
                SignedJobsGrid.SelectedItem = null;
                SignerJobsGrid.SelectedItem = signer;
                if (scroll)
                {
                    SignerJobsGrid.ScrollIntoView(signer);
                }

                SetSelectedQueueItem(signer);
                return;
            }

            var signed = _signedUploadJobs.FirstOrDefault(job => job.Id == item.Id);
            JobsGrid.SelectedItem = null;
            SignerJobsGrid.SelectedItem = null;
            SignedJobsGrid.SelectedItem = signed;
            if (signed is not null && scroll)
            {
                SignedJobsGrid.ScrollIntoView(signed);
            }

            SetSelectedQueueItem(signed);
        }
        finally
        {
            _syncingQueueSelection = false;
        }
    }

    private void UpdateQueueSummary()
    {
        var fillEligible = _processFillQueue
            ? _jobs.Count(item => item.NeedsPipelineWork && _jobRetries.IsEligible(item.Id))
            : 0;
        var signerEligible = _processSignerQueue
            ? _pdfSignerJobs.Count(item => _jobRetries.IsEligible(item.Id))
            : 0;
        var signedEligible = _processSignedUploadQueue
            ? _signedUploadJobs.Count(item => _jobRetries.IsEligible(item.Id))
            : 0;
        var stage = WorkerQueueStagePicker.Next(
            _processFillQueue,
            _processSignerQueue,
            _processSignedUploadQueue,
            fillEligible,
            signerEligible,
            signedEligible,
            _lastEmaapStage);

        if (_session is null)
        {
            QueueCountText.Text = "Sign in to load queues.";
            return;
        }

        QueueCountText.Text = stage switch
        {
            WorkerQueueStage.FillCertify =>
                $"Next: fill & certify ({fillEligible}). Then signed PDF ({signedEligible}) · PDF signer ({signerEligible}).",
            WorkerQueueStage.PdfSigner =>
                $"Next: PDF signer ({signerEligible}). Fill {fillEligible} · signed upload {signedEligible}.",
            WorkerQueueStage.SignedEmaapUpload =>
                $"Next: upload signed PDFs ({signedEligible}). Then fill ({fillEligible}) · PDF signer ({signerEligible}).",
            _ => !_processFillQueue && !_processSignerQueue && !_processSignedUploadQueue
                ? "All process switches off."
                : "Idle — no eligible jobs on ON queues.",
        };
    }

    private void UpdateEmptyState()
    {
        var generateEmpty = _jobs.Count == 0;
        JobsGrid.Visibility = generateEmpty ? Visibility.Collapsed : Visibility.Visible;
        GenerateEmptyText.Visibility = generateEmpty ? Visibility.Visible : Visibility.Collapsed;
        GenerateEmptyText.Text = _session is null
            ? "Sign in to load submitted jobs."
            : _processFillQueue
                ? "None. Next ON queue can run."
                : "Empty. Switch is off — skipped.";
        GenerateQueueTitleText.Text = $"1 · Fill & certify ({_jobs.Count})";
        GenerateQueueHintText.Text = !_processFillQueue
            ? "Off — skipped even if jobs wait"
            : _jobs.Count > 0
                ? "On · submitted · fill → certify → unsigned PDF"
                : "On · empty · next ON queue in order";

        SignerQueueTitleText.Text = $"2 · PDF signer ({_pdfSignerJobs.Count})";
        SignerQueueHintText.Text = !_processSignerQueue
            ? "Off — listed only, not processed"
            : _pdfSignerJobs.Count > 0
                ? "On · auto-stamp bursts between eMAAP jobs"
                : "On · pdf_signer RCs · seq >2304 · no signed PDF";
        var signerEmpty = _pdfSignerJobs.Count == 0;
        SignerJobsGrid.Visibility = signerEmpty ? Visibility.Collapsed : Visibility.Visible;
        SignerEmptyText.Visibility = signerEmpty ? Visibility.Visible : Visibility.Collapsed;
        SignerEmptyText.Text = _session is null
            ? "Sign in to load PDF signer jobs."
            : "None. Certified seq >2304, unsigned, pdf_signer RCs.";

        var signedEmpty = _signedUploadJobs.Count == 0;
        SignedJobsGrid.Visibility = signedEmpty ? Visibility.Collapsed : Visibility.Visible;
        SignedEmptyText.Visibility = signedEmpty ? Visibility.Visible : Visibility.Collapsed;
        SignedEmptyText.Text = _session is null
            ? "Sign in to load signed-upload jobs."
            : _processSignedUploadQueue
                ? "None waiting."
                : "Empty. Switch is off — skipped.";
        SignedQueueTitleText.Text = $"3 · Signed PDF → eMAAP ({_signedUploadJobs.Count})";
        SignedQueueHintText.Text = !_processSignedUploadQueue
            ? "Off — skipped even if jobs wait"
            : _signedUploadJobs.Count > 0
                ? "On · interleave with fill · Issued → Upload Signed PDF"
                : "On · seq >2304 · Firebase signed · not on eMAAP yet";
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
            SelectQueueItem(_pdfSignerJobs.FirstOrDefault() ?? _signedUploadJobs.FirstOrDefault());
            return;
        }

        SelectQueueItem(_jobs[index]);
    }

    private void SelectJobAtIndexAfterRemoval(int removedIndex)
    {
        if (_jobs.Count == 0)
        {
            SelectQueueItem(_pdfSignerJobs.FirstOrDefault() ?? _signedUploadJobs.FirstOrDefault());
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
            : _session.DisplayName;
        var role = CertificateWorkerIdentity.IsEmaapEngine(_session)
            ? "EmaapEngine"
            : "VPS worker";
        SignInSummaryText.Text = $"{summary} · {role}";
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
                MessageBox.Show(this, ex.Message, WorkerProduct.AppName, MessageBoxButton.OK, MessageBoxImage.Warning);
            });
        }
        finally
        {
            await RunOnUiAsync(() =>
            {
                _isBusy = false;
                SignInButton.IsEnabled = true;
                RefreshButton.IsEnabled = true;

                if (_autoWorkerCyclePending && _autoWorkerEnabled && _session is not null && !_remotePaused)
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

        PushStatusHud(message, kind);
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
