using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Microsoft.Extensions.Configuration;
using PdfSharp.Fonts;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.EmaapEngine;

public partial class App : Application
{
    public static WorkerSettings Settings { get; private set; } = new();

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
        PlaywrightBootstrap.ConfigureBrowserPath();
        GlobalFontSettings.UseWindowsFontsUnderWindows = true;
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: true)
            .Build();
        Settings = configuration.Get<WorkerSettings>() ?? new WorkerSettings();
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow = new MainWindow();
        }

        base.OnFrameworkInitializationCompleted();
    }
}
