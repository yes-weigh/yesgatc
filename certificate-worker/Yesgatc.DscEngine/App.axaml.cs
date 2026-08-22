using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Microsoft.Extensions.Configuration;
using Yesgatc.CertificateWorker.Models;
using Yesgatc.DscEngine.Models;

namespace Yesgatc.DscEngine;

public partial class App : Application
{
    public static WorkerSettings Settings { get; private set; } = new();
    public static DscSettings Dsc { get; private set; } = new();

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
            .AddJsonFile("appsettings.local.json", optional: true, reloadOnChange: true)
            .Build();
        Settings = configuration.Get<WorkerSettings>() ?? new WorkerSettings();
        Dsc = configuration.GetSection("Dsc").Get<DscSettings>() ?? new DscSettings();
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
