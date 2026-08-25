using Avalonia.Controls;
using Avalonia.Interactivity;

namespace Yesgatc.DscEngine;

public partial class PinWindow : Window
{
    public PinWindow()
    {
        InitializeComponent();
        Opened += (_, _) => PinBox.Focus();
    }

    private void Unlock_Click(object? sender, RoutedEventArgs e) =>
        Close(PinBox.Text ?? "");

    private void Cancel_Click(object? sender, RoutedEventArgs e) =>
        Close(null);
}
