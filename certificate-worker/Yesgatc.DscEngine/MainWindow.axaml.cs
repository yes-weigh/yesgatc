using System.Collections.ObjectModel;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Yesgatc.DscEngine.Models;
using Yesgatc.DscEngine.Services;

namespace Yesgatc.DscEngine;

public partial class MainWindow : Window
{
    private readonly ObservableCollection<DscCertificateRecord> _visible = [];
    private readonly List<DscCertificateRecord> _all = [];
    private readonly FirebaseAuthService _auth;
    private readonly DscCertificateListService _certificates;
    private readonly DscSignedPdfService _signedPdfs;
    private readonly LocalCredentialsStore _store = new();
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private readonly DscTokenSession _dscToken = new();

    private FirebaseSignInResult? _session;
    private bool _busy;

    public MainWindow()
    {
        InitializeComponent();
        CertGrid.ItemsSource = _visible;
        var settings = App.Settings;
        _auth = new FirebaseAuthService(settings.Firebase);
        _certificates = new DscCertificateListService(settings.Firebase);
        _signedPdfs = new DscSignedPdfService(settings.Firebase, App.Dsc);
        LoadSaved();
        RefreshTokenHint();
        Closed += (_, _) =>
        {
            _dscToken.Dispose();
            _tokenLock.Dispose();
        };
    }

    private void LoadSaved()
    {
        var saved = _store.Load();
        AadharBox.Text = FirstNonEmpty(saved.SuperAdmin.Aadhar, App.Settings.Credentials.Aadhar);
        PasswordBox.Text = FirstNonEmpty(saved.SuperAdmin.Password, App.Settings.Credentials.Password);
    }

    private void SaveButton_Click(object? sender, RoutedEventArgs e)
    {
        Persist();
        SetStatus("Login saved on this machine.");
    }

    private async void SignInButton_Click(object? sender, RoutedEventArgs e) =>
        await SignInAsync();

    private async void RefreshButton_Click(object? sender, RoutedEventArgs e) =>
        await LoadCertificatesAsync();

    private async void SignButton_Click(object? sender, RoutedEventArgs e) =>
        await SignSelectedAsync();

    private void SignOutButton_Click(object? sender, RoutedEventArgs e)
    {
        _session = null;
        _all.Clear();
        ApplyFilter();
        RefreshButton.IsEnabled = false;
        SignOutButton.IsEnabled = false;
        SignButton.IsEnabled = false;
        SetStatus("Signed out.");
    }

    private void SearchBox_TextChanged(object? sender, TextChangedEventArgs e) => ApplyFilter();

    private void StatusFilterBox_SelectionChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (IsInitialized)
        {
            ApplyFilter();
        }
    }

    private void CertGrid_SelectionChanged(object? sender, SelectionChangedEventArgs e) =>
        UpdateSignButton();

    private async Task SignInAsync()
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
            _session = await _auth.SignInAsRcAdminAsync(AadharBox.Text ?? "", PasswordBox.Text ?? "");
            RefreshButton.IsEnabled = true;
            SignOutButton.IsEnabled = true;
            SetStatus($"Signed in as {_session.DisplayName}. Loading certificates…");
            await LoadCertificatesAsync();
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
        }
        finally
        {
            _busy = false;
            SignInButton.IsEnabled = true;
            UpdateSignButton();
        }
    }

    private async Task LoadCertificatesAsync()
    {
        if (_session is null)
        {
            SetStatus("Sign in first.");
            return;
        }

        if (_busy && _all.Count > 0)
        {
            return;
        }

        _busy = true;
        RefreshButton.IsEnabled = false;
        try
        {
            var token = await GetFreshIdTokenAsync();
            var records = await _certificates.ListIssuedForRcAsync(_session.UserId, token);
            _all.Clear();
            _all.AddRange(records);
            ApplyFilter();
            var unsigned = _all.Count(item => item.SignStatus == DscSignStatus.NotSigned);
            SetStatus(
                $"{_session.DisplayName}  ·  {_all.Count} issued  ·  {unsigned} not signed");
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
        }
        finally
        {
            _busy = false;
            RefreshButton.IsEnabled = _session is not null;
            UpdateSignButton();
        }
    }

    private async Task SignSelectedAsync()
    {
        if (_busy || _session is null)
        {
            return;
        }

        var selected = SelectedRows()
            .Where(item => item.SignStatus == DscSignStatus.NotSigned)
            .ToList();
        if (selected.Count == 0)
        {
            SetStatus("Select one or more unsigned certified certificates.");
            return;
        }

        if (!await EnsureTokenUnlockedAsync())
        {
            return;
        }

        _busy = true;
        SignButton.IsEnabled = false;
        RefreshButton.IsEnabled = false;
        try
        {
            var ok = 0;
            foreach (var record in selected)
            {
                SetStatus($"Signing {record.CertificateNumber}…");
                _session = _session with { IdToken = await GetFreshIdTokenAsync() };
                var updated = await _signedPdfs.SignAndUploadAsync(record, _dscToken, _session);
                ReplaceRecord(updated);
                ok++;
            }

            ApplyFilter();
            SetStatus(
                $"Signed & uploaded {ok}. Token: {_dscToken.SigningCertificate?.SubjectCn}");
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
        }
        finally
        {
            _busy = false;
            RefreshButton.IsEnabled = _session is not null;
            UpdateSignButton();
        }
    }

    private async Task<bool> EnsureTokenUnlockedAsync()
    {
        if (_dscToken.IsUnlocked)
        {
            return true;
        }

        var pinWindow = new PinWindow();
        var pin = await pinWindow.ShowDialog<string?>(this);
        if (string.IsNullOrWhiteSpace(pin))
        {
            SetStatus("PIN cancelled.");
            return false;
        }

        try
        {
            await Task.Run(() => _dscToken.Unlock(pin, App.Dsc.Pkcs11Library));
            RefreshTokenHint();
            return true;
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
            RefreshTokenHint();
            return false;
        }
    }

    private void ReplaceRecord(DscCertificateRecord updated)
    {
        var index = _all.FindIndex(item => item.Id == updated.Id);
        if (index >= 0)
        {
            _all[index] = updated;
        }
    }

    private IEnumerable<DscCertificateRecord> SelectedRows() =>
        CertGrid.SelectedItems.OfType<DscCertificateRecord>();

    private void ApplyFilter()
    {
        var query = (SearchBox.Text ?? "").Trim();
        var compact = Compact(query);
        var statusIndex = StatusFilterBox.SelectedIndex;

        IEnumerable<DscCertificateRecord> rows = _all;
        rows = statusIndex switch
        {
            1 => rows.Where(item => item.SignStatus == DscSignStatus.NotSigned),
            2 => rows.Where(item => item.SignStatus == DscSignStatus.Signed),
            3 => rows.Where(item => item.SignStatus == DscSignStatus.Voided),
            _ => rows,
        };

        if (compact.Length > 0)
        {
            rows = rows.Where(item =>
                Compact(item.CertificateNumber).Contains(compact, StringComparison.Ordinal)
                || Compact(item.SerialNumber).Contains(compact, StringComparison.Ordinal)
                || Compact(item.CustomerName).Contains(compact, StringComparison.Ordinal));
        }

        var filtered = rows.ToList();
        _visible.Clear();
        foreach (var item in filtered)
        {
            _visible.Add(item);
        }

        CountText.Text = filtered.Count == _all.Count
            ? $"{filtered.Count} certificate{(filtered.Count == 1 ? "" : "s")}"
            : $"{filtered.Count} of {_all.Count} certificates";
        UpdateSignButton();
    }

    private void UpdateSignButton()
    {
        SignButton.IsEnabled = !_busy
            && _session is not null
            && SelectedRows().Any(item => item.SignStatus == DscSignStatus.NotSigned);
    }

    private void RefreshTokenHint()
    {
        try
        {
            if (_dscToken.IsUnlocked)
            {
                HintText.Text =
                    $"PROXKey unlocked · {_dscToken.SigningCertificate?.SubjectCn} · PIN cached this session.";
                return;
            }

            var info = DscTokenSession.Describe(App.Dsc.Pkcs11Library);
            HintText.Text = info.TokenPresent
                ? $"PROXKey present · {info.TokenLabel} · PIN once, then Sign & upload."
                : "PROXKey not present. Plug in WD PROXKey.";
        }
        catch (Exception ex)
        {
            HintText.Text = ex.Message;
        }
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
        _store.Save(new StoredCredentials
        {
            SuperAdmin = new CredentialSettings
            {
                Aadhar = (AadharBox.Text ?? "").Trim(),
                Password = PasswordBox.Text ?? "",
            },
        });
    }

    private void SetStatus(string text) => StatusText.Text = text;

    private static string Compact(string value) =>
        new string(value.Where(ch => !char.IsWhiteSpace(ch) && ch is not '/' and not '-').ToArray())
            .ToLowerInvariant();

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
