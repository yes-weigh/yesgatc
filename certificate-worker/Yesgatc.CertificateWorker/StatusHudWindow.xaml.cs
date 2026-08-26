using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace Yesgatc.CertificateWorker;

/// <summary>
/// Always-on-top status HUD. Stays visible above Chrome / other apps via Topmost + periodic Win32 reassert.
/// </summary>
public partial class StatusHudWindow : Window
{
    private static readonly IntPtr HwndTopmost = new(-1);
    private const uint SwpNomove = 0x0002;
    private const uint SwpNosize = 0x0001;
    private const uint SwpNoactivate = 0x0010;
    private const uint SwpShowwindow = 0x0040;

    private readonly DispatcherTimer _topmostTimer;
    private bool _collapsed;
    private bool _overlayAllowed;
    private string _fullMessage = string.Empty;
    private string _contextLine = string.Empty;

    public StatusHudWindow()
    {
        InitializeComponent();
        Loaded += (_, _) => PlaceBottomRight();
        SourceInitialized += (_, _) =>
        {
            if (_overlayAllowed)
            {
                ReassertTopmost();
            }
        };

        // Soft interval — avoid fighting Chrome for focus every tick.
        _topmostTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
        _topmostTimer.Tick += (_, _) =>
        {
            if (_overlayAllowed && IsVisible)
            {
                ReassertTopmost();
            }
        };
        _topmostTimer.Start();
    }

    public void UpdateStatus(string stateLabel, string message, Brush? dotBrush)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => UpdateStatus(stateLabel, message, dotBrush));
            return;
        }

        StateText.Text = stateLabel;
        TimestampText.Text = DateTime.Now.ToString("HH:mm:ss");
        _fullMessage = message ?? string.Empty;
        MessageText.Text = _collapsed ? Truncate(_fullMessage, 48) : _fullMessage;
        if (dotBrush is not null)
        {
            StateDot.Fill = dotBrush;
        }

        if (_overlayAllowed)
        {
            ShowOverlay();
        }
    }

    public void UpdateContext(string? contextLine)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => UpdateContext(contextLine));
            return;
        }

        _contextLine = contextLine?.Trim() ?? string.Empty;
        if (_collapsed || string.IsNullOrEmpty(_contextLine))
        {
            ContextText.Visibility = Visibility.Collapsed;
            ContextText.Text = string.Empty;
            return;
        }

        ContextText.Text = _contextLine;
        ContextText.Visibility = Visibility.Visible;
    }

    /// <summary>
    /// Show only when the main worker window is not the foreground window.
    /// HUD itself does not count as the main window.
    /// </summary>
    public void FollowMainWindowForeground(IntPtr mainWindowHandle)
    {
        if (!Dispatcher.CheckAccess())
        {
            _ = Dispatcher.InvokeAsync(() => FollowMainWindowForeground(mainWindowHandle));
            return;
        }

        if (mainWindowHandle == IntPtr.Zero)
        {
            SetOverlayAllowed(false);
            return;
        }

        var foreground = GetForegroundWindow();
        var hudHandle = new WindowInteropHelper(this).Handle;
        var mainIsForeground = foreground != hudHandle
            && WindowIsSelfOrOwnedBy(foreground, mainWindowHandle);
        SetOverlayAllowed(!mainIsForeground);
    }

    private void SetOverlayAllowed(bool allowed)
    {
        _overlayAllowed = allowed;
        if (allowed)
        {
            ShowOverlay();
            return;
        }

        if (IsVisible)
        {
            Hide();
        }
    }

    private void ShowOverlay()
    {
        if (!IsVisible)
        {
            Show();
        }

        ReassertTopmost();
    }

    protected override void OnClosed(EventArgs e)
    {
        _topmostTimer.Stop();
        base.OnClosed(e);
    }

    private void RootBorder_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left)
        {
            try
            {
                DragMove();
            }
            catch
            {
                // Ignore if drag starts while mouse already released.
            }
        }
    }

    private void CollapseButton_Click(object sender, RoutedEventArgs e)
    {
        _collapsed = !_collapsed;
        CollapseButton.Content = _collapsed ? "+" : "−";
        CollapseButton.ToolTip = _collapsed ? "Expand" : "Collapse";
        MessageText.Text = _collapsed ? Truncate(_fullMessage, 48) : _fullMessage;
        UpdateContext(_contextLine);
    }

    private void PlaceBottomRight()
    {
        var work = SystemParameters.WorkArea;
        UpdateLayout();
        Left = work.Right - ActualWidth - 24;
        Top = work.Bottom - ActualHeight - 24;
    }

    private void ReassertTopmost()
    {
        if (!_overlayAllowed)
        {
            return;
        }

        try
        {
            // Keep Topmost=true; do NOT flip false→true (steals focus / freezes peers).
            if (!Topmost)
            {
                Topmost = true;
            }

            var helper = new WindowInteropHelper(this);
            if (helper.Handle != IntPtr.Zero)
            {
                SetWindowPos(
                    helper.Handle,
                    HwndTopmost,
                    0,
                    0,
                    0,
                    0,
                    SwpNomove | SwpNosize | SwpNoactivate | SwpShowwindow);
            }
        }
        catch
        {
            // HUD must never crash the worker.
        }
    }

    private static bool WindowIsSelfOrOwnedBy(IntPtr hwnd, IntPtr root)
    {
        for (var i = 0; i < 16 && hwnd != IntPtr.Zero; i++)
        {
            if (hwnd == root)
            {
                return true;
            }

            var owner = GetWindow(hwnd, GwOwner);
            hwnd = owner != IntPtr.Zero ? owner : GetParent(hwnd);
        }

        return false;
    }

    private static string Truncate(string text, int max)
    {
        if (string.IsNullOrEmpty(text) || text.Length <= max)
        {
            return text;
        }

        return text[..(max - 1)] + "…";
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int cx,
        int cy,
        uint uFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    private const uint GwOwner = 4;
}
