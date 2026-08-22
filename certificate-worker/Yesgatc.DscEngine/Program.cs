using Avalonia;
using System;
using Yesgatc.DscEngine.Services;

namespace Yesgatc.DscEngine;

internal static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        if (args.Any(arg => string.Equals(arg, "--probe", StringComparison.OrdinalIgnoreCase)))
        {
            var text = DscTokenSession.Probe();
            Console.WriteLine(text);
            File.WriteAllText(Path.Combine(Path.GetTempPath(), "yesgatc-dsc-probe.txt"), text);
            return;
        }

        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace();
}
