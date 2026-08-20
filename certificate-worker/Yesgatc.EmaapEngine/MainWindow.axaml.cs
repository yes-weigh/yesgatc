using System.Collections.ObjectModel;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;

namespace Yesgatc.EmaapEngine;

public partial class MainWindow : Window
{
    private readonly ObservableCollection<string> _jobLines = [];
    private readonly List<SiteCalibrationRecord> _jobs = [];
    private readonly FirebaseAuthService _auth;
    private readonly FirestoreService _firestore;
    private readonly FirestoreQueueListener _listener;
    private readonly PartyDetailsService _party;
    private readonly InstrumentDetailsService _instrument;
    private readonly AutomationService _automation;
    private readonly LocalCredentialsStore _store = new();
    private readonly JobRetryTracker _retries = new();
    private readonly WorkerPresenceService _presence;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);

    private FirebaseSignInResult? _session;
    private bool _busy;
    private bool _cyclePending;
    private DispatcherTimer? _heartbeat;

    public MainWindow()
    {
        InitializeComponent();
        EmaapLoginAutomation.PreferManualLoginUntilAuthenticated = true;

        var settings = App.Settings;
        _auth = new FirebaseAuthService(settings.Firebase);
        _firestore = new FirestoreService(settings.Firebase);
        _listener = new FirestoreQueueListener(settings.Firebase, settings.AutoWorker.ListenerTokenRefreshMinutes);
        _listener.ResolveIdToken = () => GetFreshIdTokenAsync();
        _listener.QueueUpdated += records => Dispatcher.UIThread.Post(() => OnQueueUpdated(records));
        _listener.ListenerError += message => Dispatcher.UIThread.Post(() => SetStatus(message));
        _party = new PartyDetailsService(settings.Firebase);
        _instrument = new InstrumentDetailsService(settings.Firebase);
        _presence = new WorkerPresenceService(settings.Firebase);
        _automation = new AutomationService(settings.Automation, _firestore)
        {
            Firebase = settings.Firebase,
            ResolveFirebaseIdToken = ct => GetFreshIdTokenAsync(ct),
        };

        JobsList.ItemsSource = _jobLines;
        LoadSaved();
        SyncEmaapCreds();
        Closed += async (_, _) => await ShutdownAsync();
    }

    private DocaCredentialSettings EmbeddedEmaap() => new()
    {
        Email = App.Settings.Automation.DocaCredentials.Email.Trim(),
        Password = App.Settings.Automation.DocaCredentials.Password,
    };

    private void LoadSaved()
    {
        var saved = _store.Load();
        AadharBox.Text = FirstNonEmpty(saved.SuperAdmin.Aadhar, App.Settings.Credentials.Aadhar);
        PasswordBox.Text = FirstNonEmpty(saved.SuperAdmin.Password, App.Settings.Credentials.Password);
        AutoRunCheckBox.IsChecked = saved.AutoWorkerEnabled ?? App.Settings.AutoWorker.Enabled;
    }

    private void SaveButton_Click(object? sender, RoutedEventArgs e)
    {
        Persist();
        SetStatus("Saved locally.");
    }

    private async void SignInButton_Click(object? sender, RoutedEventArgs e) =>
        await SignInAndStartAsync();

    private async Task SignInAndStartAsync()
    {
        if (_busy)
        {
            return;
        }

        _busy = true;
        SignInButton.IsEnabled = false;
        try
        {
            SetStatus("Signing in…");
            Persist();
            SyncEmaapCreds();
            SetStatus("Preparing browser…");
            PlaywrightBootstrap.EnsureChromium();
            _session = await _auth.SignInAsRcAdminAsync(AadharBox.Text ?? "", PasswordBox.Text ?? "");
            _firestore.QueueRcIdFilter = _session.UserId;
            _listener.ScopeRcId = _session.UserId;
            SetStatus($"Signed in as {_session.DisplayName}. Loading queue…");
            await _listener.StartAsync();
            await LoadQueueAsync();
            await _automation.EnsureBrowserReadyAsync();
            StartHeartbeat();
            SetStatus("Signed in. Browser open — type captcha and OTP in the eMAAP window, then Auto-run certifies.");
            Log($"Signed in {_session.DisplayName}");
            if (AutoRunCheckBox.IsChecked == true)
            {
                await RunCycleAsync();
            }
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
            Log(ex.Message);
        }
        finally
        {
            _busy = false;
            SignInButton.IsEnabled = true;
            if (_cyclePending)
            {
                _cyclePending = false;
                _ = RunCycleAsync();
            }
        }
    }

    private void OnQueueUpdated(IReadOnlyList<SiteCalibrationRecord> records)
    {
        ApplyQueue(records);
        if (AutoRunCheckBox.IsChecked == true && !_busy)
        {
            _ = RunCycleAsync();
        }
        else if (_busy)
        {
            _cyclePending = true;
        }
    }

    private async Task LoadQueueAsync()
    {
        if (_session is null)
        {
            return;
        }

        var token = await GetFreshIdTokenAsync();
        var records = await _firestore.GetPendingCertificationQueueAsync(token);
        ApplyQueue(records);
    }

    private void ApplyQueue(IReadOnlyList<SiteCalibrationRecord> records)
    {
        _jobs.Clear();
        _jobs.AddRange(records.Where(item => item.IsEligibleForWorkerQueue));
        _jobLines.Clear();
        foreach (var job in _jobs)
        {
            _jobLines.Add($"{job.SerialNumber}  ·  {job.CustomerName}  ·  {job.NextStepLabel}");
        }

        QueueHintText.Text = _jobs.Count == 0
            ? "No submitted jobs for this RC."
            : $"{_jobs.Count} submitted job(s).";
    }

    private async Task RunCycleAsync()
    {
        if (_busy || _session is null || AutoRunCheckBox.IsChecked != true)
        {
            return;
        }

        var queue = _jobs.Where(job => _retries.IsEligible(job.Id)).ToList();
        if (queue.Count == 0)
        {
            return;
        }

        _busy = true;
        try
        {
            var continueSession = _automation.IsBrowserConnected;
            for (var i = 0; i < queue.Count; i++)
            {
                var job = queue[i];
                SetStatus($"Job {i + 1}/{queue.Count} · {job.SerialNumber}…");
                if (!await _firestore.TryClaimJobAsync(job.Id, _session))
                {
                    Log($"Skip {job.SerialNumber} — claimed by another worker.");
                    continue;
                }

                try
                {
                    var result = await ProcessJobAsync(job);
                    if (result.Completed)
                    {
                        await _firestore.ReleaseClaimAsync(job.Id, _session);
                        _retries.Clear(job.Id);
                        Log(result.Message);
                    }
                    else
                    {
                        Log($"{job.SerialNumber}: {result.Message}");
                        if (result.LoginRequired)
                        {
                            SetStatus("Paused — finish captcha/OTP in the browser, Auto-run continues after login.");
                            return;
                        }

                        if (PipelineFailureClassifier.IsPermanentDataFailure(result.Message))
                        {
                            await _firestore.RecordRejectionAsync(job.Id, result.Message, await GetFreshIdTokenAsync());
                            _retries.MarkExhausted(job.Id, result.Message, App.Settings.AutoWorker.MaxSubmitRetries);
                        }
                        else
                        {
                            _retries.Schedule(
                                job.Id,
                                result.Message,
                                TimeSpan.FromSeconds(App.Settings.AutoWorker.RetryDelaySeconds),
                                App.Settings.AutoWorker.MaxSubmitRetries);
                            await _firestore.RecordSubmitFailureAsync(
                                job.Id,
                                result.Message,
                                await GetFreshIdTokenAsync(),
                                retryExhausted: _retries.IsExhausted(job.Id));
                        }

                        if (result.HaltBatch)
                        {
                            SetStatus(result.Message);
                            return;
                        }
                    }
                }
                catch (Exception ex)
                {
                    Log($"{job.SerialNumber} failed: {ex.Message}");
                    SetStatus(ex.Message);
                    return;
                }

                continueSession = _automation.IsBrowserConnected;
                _ = continueSession;
            }

            await LoadQueueAsync();
            SetStatus("Idle — watching queue.");
        }
        finally
        {
            _busy = false;
            if (_cyclePending)
            {
                _cyclePending = false;
                _ = RunCycleAsync();
            }
        }
    }

    private async Task<(bool Completed, bool LoginRequired, bool HaltBatch, string Message)> ProcessJobAsync(
        SiteCalibrationRecord job)
    {
        var creds = EmbeddedEmaap();
        if (string.IsNullOrWhiteSpace(creds.Email) || string.IsNullOrWhiteSpace(creds.Password))
        {
            return (false, true, false, "eMAAP login is not configured in this build.");
        }

        _automation.DocaCredentials = creds;
        await _automation.EnsureBrowserReadyAsync();
        var gate = await _automation.EnsureDocaSessionForJobAsync();
        if (gate is not null)
        {
            return (false, true, false, gate.Message);
        }

        if (_session is null)
        {
            return (false, true, false, "Not signed in.");
        }

        var token = await GetFreshIdTokenAsync();
        var party = await _party.ResolveForJobAsync(job, job.RcId, token);
        var instrument = await _instrument.ResolveForJobAsync(job, job.RcId, token);
        try
        {
            var message = await _automation.FillEmaapCertificateGenerationAsync(job, party, instrument, token);
            return (true, false, false, message);
        }
        catch (EmaapMandatoryStepException ex)
        {
            return (false, false, true, ex.Message);
        }
        catch (Exception ex) when (
            ex.Message.Contains("login", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("OTP", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("Sign in to eMAAP", StringComparison.OrdinalIgnoreCase))
        {
            return (false, true, false, ex.Message);
        }
    }

    private void StartHeartbeat()
    {
        _heartbeat?.Stop();
        _heartbeat = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        _heartbeat.Tick += async (_, _) =>
        {
            if (_session is null)
            {
                return;
            }

            try
            {
                var token = await GetFreshIdTokenAsync();
                await _presence.HeartbeatAsync(_session, token, StatusText.Text ?? "");
            }
            catch
            {
            }
        };
        _heartbeat.Start();
        _ = Dispatcher.UIThread.InvokeAsync(async () =>
        {
            if (_session is null)
            {
                return;
            }

            try
            {
                var token = await GetFreshIdTokenAsync();
                await _presence.HeartbeatAsync(_session, token, StatusText.Text ?? "");
            }
            catch
            {
            }
        });
    }

    private async Task ShutdownAsync()
    {
        _heartbeat?.Stop();
        try
        {
            await _listener.StopAsync();
            if (_session is not null)
            {
                var token = await GetFreshIdTokenAsync();
                await _presence.ClearAsync(_session with { IdToken = token });
            }
        }
        catch
        {
        }

        await _automation.DisposeAsync();
        _tokenLock.Dispose();
    }

    private async Task<string> GetFreshIdTokenAsync(CancellationToken cancellationToken = default)
    {
        if (_session is null)
        {
            throw new InvalidOperationException("Sign in first.");
        }

        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            _session = await _auth.RefreshIdTokenAsync(_session, cancellationToken);
            return _session.IdToken;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    private void Persist()
    {
        var emaap = EmbeddedEmaap();
        _store.SaveAll(
            AadharBox.Text ?? "",
            PasswordBox.Text ?? "",
            emaap.Email,
            emaap.Password,
            autoWorkerEnabled: AutoRunCheckBox.IsChecked);
        SyncEmaapCreds();
    }

    private void SyncEmaapCreds()
    {
        _automation.DocaCredentials = EmbeddedEmaap();
    }

    private void SetStatus(string text) => StatusText.Text = text;

    private void Log(string text)
    {
        var line = $"{DateTime.Now:HH:mm:ss}  {text}{Environment.NewLine}";
        LogBox.Text = line + (LogBox.Text ?? "");
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
}
