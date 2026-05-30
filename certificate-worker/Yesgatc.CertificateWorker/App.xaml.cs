using System.Windows;
using System.Windows.Threading;
using Microsoft.Extensions.Configuration;
using PdfSharp.Fonts;
using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;

namespace Yesgatc.CertificateWorker;

public partial class App : Application
{
    public static WorkerSettings Settings { get; private set; } = new();
    public static AutomationService? AutomationService { get; set; }

    protected override void OnStartup(StartupEventArgs e)
    {
        GlobalFontSettings.UseWindowsFontsUnderWindows = true;

        DispatcherUnhandledException += App_DispatcherUnhandledException;

        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: true)
            .Build();

        Settings = configuration.Get<WorkerSettings>() ?? new WorkerSettings();
        base.OnStartup(e);
    }

    private void App_DispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        MessageBox.Show(
            e.Exception.ToString(),
            "Certificate Worker — unexpected error",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
        e.Handled = true;
    }

    protected override void OnExit(ExitEventArgs e)
    {
        AutomationService?.DisposeAsync().AsTask().GetAwaiter().GetResult();
        base.OnExit(e);
    }
}
