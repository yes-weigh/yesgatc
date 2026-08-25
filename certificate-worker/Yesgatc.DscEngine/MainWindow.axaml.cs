using System.Collections.ObjectModel;
using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
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
    private readonly DscLocalPrefsStore _prefsStore = new();
    private DscLocalPrefs _prefs = new();

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
        LoadStampPrefs();
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
        PersistStampPrefs();
        SetStatus("Login and stamp position saved on this machine.");
    }

    private void StampPlaceBox_SelectionChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (!IsInitialized)
        {
            return;
        }

        var custom = SelectedPlacement() == "Custom";
        StampXBox.IsVisible = custom;
        StampYBox.IsVisible = custom;
        PersistStampPrefs();
    }

    private async void SignInButton_Click(object? sender, RoutedEventArgs e) =>
        await SignInAsync();

    private async void RefreshButton_Click(object? sender, RoutedEventArgs e) =>
        await LoadCertificatesAsync();

    private async void SignAllButton_Click(object? sender, RoutedEventArgs e) =>
        await SignRecordsAsync(_all.Where(item => item.SignStatus == DscSignStatus.NotSigned).ToList(), upload: true);

    private async void SignButton_Click(object? sender, RoutedEventArgs e) =>
        await SignSelectedAsync(upload: true);

    private async void SignLocalButton_Click(object? sender, RoutedEventArgs e) =>
        await SignSelectedAsync(upload: false);

    private async void DownloadButton_Click(object? sender, RoutedEventArgs e) =>
        await DownloadSelectedAsync();

    private void SignOutButton_Click(object? sender, RoutedEventArgs e)
    {
        _session = null;
        _all.Clear();
        ApplyFilter();
        RefreshButton.IsEnabled = false;
        SignOutButton.IsEnabled = false;
        SignButton.IsEnabled = false;
        SignAllButton.IsEnabled = false;
        SignLocalButton.IsEnabled = false;
        DownloadButton.IsEnabled = false;
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
        UpdateActionButtons();

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
            UpdateActionButtons();
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
            SetStatus($"{_session.DisplayName}  ·  {CountSummary()}");
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
        }
        finally
        {
            _busy = false;
            RefreshButton.IsEnabled = _session is not null;
            UpdateActionButtons();
        }
    }

    private async Task SignSelectedAsync(bool upload)
    {
        var selected = SelectedRows()
            .Where(item => item.SignStatus != DscSignStatus.Voided)
            .ToList();
        if (selected.Count == 0)
        {
            SetStatus("Select one or more rows, or use Sign all unsigned.");
            return;
        }

        await SignRecordsAsync(selected, upload);
    }

    private async Task SignRecordsAsync(IReadOnlyList<DscCertificateRecord> records, bool upload)
    {
        if (_busy || _session is null)
        {
            return;
        }

        if (records.Count == 0)
        {
            SetStatus("Nothing to sign.");
            return;
        }

        if (!await EnsureTokenUnlockedAsync())
        {
            return;
        }

        _busy = true;
        SignButton.IsEnabled = false;
        SignAllButton.IsEnabled = false;
        SignLocalButton.IsEnabled = false;
        RefreshButton.IsEnabled = false;
        try
        {
            var ok = 0;
            var failed = new List<string>();
            var saved = new List<string>();
            var downloads = DefaultDownloadDirectory();
            var total = records.Count;
            for (var i = 0; i < records.Count; i++)
            {
                var record = records[i];
                SetStatus(upload
                    ? $"Signing {i + 1}/{total}  ·  {record.CertificateNumber}  ·  {CountSummary()}"
                    : $"Signing {i + 1}/{total} to Downloads  ·  {record.CertificateNumber}");
                try
                {
                    _session = _session with { IdToken = await GetFreshIdTokenAsync() };
                    PersistStampPrefs();
                    if (upload)
                    {
                        var updated = await _signedPdfs.SignAndUploadAsync(
                            record,
                            _dscToken,
                            _session,
                            CurrentStampLayout());
                        ReplaceRecord(updated);
                    }
                    else
                    {
                        saved.Add(await _signedPdfs.SignAndSaveLocalAsync(
                            record,
                            _dscToken,
                            _session,
                            downloads,
                            CurrentStampLayout()));
                    }

                    ok++;
                    ApplyFilter();
                }
                catch (Exception ex)
                {
                    failed.Add($"{record.CertificateNumber}: {ex.Message}");
                    if (IsFatalTokenError(ex))
                    {
                        break;
                    }
                }
            }

            ApplyFilter();
            if (upload)
            {
                SetStatus(failed.Count == 0
                    ? $"Signed & uploaded {ok}. Unsigned PDF kept. Signed PDF stored separately.  ·  {CountSummary()}"
                    : $"Signed {ok}/{total}. Failed {failed.Count}: {failed[0]}  ·  {CountSummary()}");
            }
            else
            {
                OpenSaved(saved);
                SetStatus(failed.Count == 0
                    ? saved.Count == 1
                        ? $"Signed locally · {Path.GetFileName(saved[0])} · Downloads (not uploaded)."
                        : $"Signed {saved.Count} locally · Downloads (not uploaded)."
                    : $"Signed {ok}/{total} locally. Failed {failed.Count}: {failed[0]}");
            }
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
        }
        finally
        {
            _busy = false;
            RefreshButton.IsEnabled = _session is not null;
            UpdateActionButtons();
        }
    }

    private async Task DownloadSelectedAsync()
    {
        if (_busy || _session is null)
        {
            return;
        }

        var selected = SelectedRows()
            .Where(item => item.SignStatus == DscSignStatus.Signed)
            .ToList();
        if (selected.Count == 0)
        {
            SetStatus("Select one or more signed certificates.");
            return;
        }

        _busy = true;
        DownloadButton.IsEnabled = false;
        try
        {
            var saved = new List<string>();
            if (selected.Count == 1)
            {
                var record = selected[0];
                var pick = await StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
                {
                    Title = "Save signed certificate",
                    SuggestedFileName = DscSignedPdfService.SuggestedSignedFileName(record),
                    DefaultExtension = "pdf",
                    FileTypeChoices =
                    [
                        new FilePickerFileType("PDF") { Patterns = ["*.pdf"] },
                    ],
                });
                if (pick is null)
                {
                    SetStatus("Download cancelled.");
                    return;
                }

                var path = pick.TryGetLocalPath()
                    ?? Path.Combine(DefaultDownloadDirectory(), DscSignedPdfService.SuggestedSignedFileName(record));
                _session = _session with { IdToken = await GetFreshIdTokenAsync() };
                saved.Add(await _signedPdfs.DownloadSignedPdfAsync(record, _session.IdToken, path));
            }
            else
            {
                var folder = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
                {
                    Title = "Save signed certificates to folder",
                    AllowMultiple = false,
                });
                var directory = folder.Count > 0
                    ? folder[0].TryGetLocalPath()
                    : null;
                if (string.IsNullOrWhiteSpace(directory))
                {
                    SetStatus("Download cancelled.");
                    return;
                }

                foreach (var record in selected)
                {
                    SetStatus($"Downloading {record.CertificateNumber}…");
                    _session = _session with { IdToken = await GetFreshIdTokenAsync() };
                    var path = Path.Combine(directory, DscSignedPdfService.SuggestedSignedFileName(record));
                    saved.Add(await _signedPdfs.DownloadSignedPdfAsync(record, _session.IdToken, path));
                }
            }

            OpenSaved(saved);
            SetStatus(saved.Count == 1
                ? $"Downloaded {Path.GetFileName(saved[0])}."
                : $"Downloaded {saved.Count} signed PDFs.");
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
        }
        finally
        {
            _busy = false;
            UpdateActionButtons();
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

        CountText.Text = CountSummary(filtered.Count);
        UpdateActionButtons();
    }

    private string CountSummary(int? shown = null)
    {
        var signed = _all.Count(item => item.SignStatus == DscSignStatus.Signed);
        var unsigned = _all.Count(item => item.SignStatus == DscSignStatus.NotSigned);
        var core = $"{_all.Count} issued · {signed} signed · {unsigned} not signed";
        if (shown is int n && n != _all.Count)
        {
            return $"{n} shown · {core}";
        }

        return core;
    }

    private void CertGrid_LoadingRow(object? sender, DataGridRowEventArgs e)
    {
        var signed = e.Row.DataContext is DscCertificateRecord record
            && record.SignStatus == DscSignStatus.Signed;
        var voided = e.Row.DataContext is DscCertificateRecord row
            && row.SignStatus == DscSignStatus.Voided;
        e.Row.Classes.Set("dsc-signed", signed);
        e.Row.Classes.Set("dsc-voided", voided);
    }

    private static bool IsFatalTokenError(Exception ex)
    {
        var text = ex.Message;
        return text.Contains("PIN", StringComparison.OrdinalIgnoreCase)
            || text.Contains("PKCS#11", StringComparison.OrdinalIgnoreCase)
            || text.Contains("CKR_", StringComparison.OrdinalIgnoreCase)
            || (text.Contains("token", StringComparison.OrdinalIgnoreCase)
                && (text.Contains("not present", StringComparison.OrdinalIgnoreCase)
                    || text.Contains("removed", StringComparison.OrdinalIgnoreCase)
                    || text.Contains("unlock", StringComparison.OrdinalIgnoreCase)));
    }

    private void UpdateActionButtons()
    {
        var selected = SelectedRows().ToList();
        var canSign = !_busy
            && _session is not null
            && selected.Any(item => item.SignStatus != DscSignStatus.Voided);
        var unsigned = _all.Count(item => item.SignStatus == DscSignStatus.NotSigned);
        SignButton.IsEnabled = canSign;
        SignAllButton.IsEnabled = !_busy && _session is not null && unsigned > 0;
        SignLocalButton.IsEnabled = canSign;
        DownloadButton.IsEnabled = !_busy
            && _session is not null
            && selected.Any(item => item.SignStatus == DscSignStatus.Signed);
    }

    private void RefreshTokenHint()
    {
        try
        {
            if (_dscToken.IsUnlocked)
            {
                HintText.Text =
                    $"Token unlocked · {_dscToken.SigningCertificate?.SubjectCn} · PIN cached this session.";
                return;
            }

            var info = DscTokenSession.Describe(App.Dsc.Pkcs11Library);
            HintText.Text = info.TokenPresent
                ? $"Token present · {info.TokenLabel} · PIN once, then Sign & upload."
                : "No DSC token. Plug in InnalT or WD PROXKey.";
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

    private void LoadStampPrefs()
    {
        _prefs = _prefsStore.Load();
        if (string.Equals(_prefs.StampPlacement, "BottomRight", StringComparison.OrdinalIgnoreCase))
        {
            _prefs.StampPlacement = "Officer";
        }
        StampXBox.Text = _prefs.CustomX.ToString("0");
        StampYBox.Text = _prefs.CustomY.ToString("0");
        var index = 0;
        foreach (var obj in StampPlaceBox.Items)
        {
            if (obj is ComboBoxItem item
                && string.Equals(item.Tag as string, _prefs.StampPlacement, StringComparison.OrdinalIgnoreCase))
            {
                StampPlaceBox.SelectedIndex = index;
                break;
            }

            index++;
        }

        var custom = SelectedPlacement() == "Custom";
        StampXBox.IsVisible = custom;
        StampYBox.IsVisible = custom;
    }

    private void PersistStampPrefs()
    {
        _prefs.StampPlacement = SelectedPlacement();
        if (float.TryParse(StampXBox.Text, out var x))
        {
            _prefs.CustomX = x;
        }

        if (float.TryParse(StampYBox.Text, out var y))
        {
            _prefs.CustomY = y;
        }

        _prefsStore.Save(_prefs);
    }

    private string SelectedPlacement() =>
        StampPlaceBox.SelectedItem is ComboBoxItem item && item.Tag is string tag && tag.Length > 0
            ? tag
            : "BottomRight";

    private DscStampLayout CurrentStampLayout() =>
        new()
        {
            Placement = SelectedPlacement(),
            Width = App.Dsc.StampWidth,
            Height = App.Dsc.StampHeight,
            Margin = Math.Max(App.Dsc.StampMarginRight, App.Dsc.StampMarginBottom),
            CustomX = float.TryParse(StampXBox.Text, out var x) ? x : _prefs.CustomX,
            CustomY = float.TryParse(StampYBox.Text, out var y) ? y : _prefs.CustomY,
        };

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

    private static string DefaultDownloadDirectory()
    {
        var downloads = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Downloads");
        Directory.CreateDirectory(downloads);
        return downloads;
    }

    private static void OpenSaved(IReadOnlyList<string> paths)
    {
        if (paths.Count == 0)
        {
            return;
        }

        var target = paths.Count == 1 ? paths[0] : Path.GetDirectoryName(paths[0]);
        if (string.IsNullOrWhiteSpace(target) || !Path.Exists(target))
        {
            return;
        }

        Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
    }

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
