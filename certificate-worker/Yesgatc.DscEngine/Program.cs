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

        var officerArg = args.SkipWhile(arg => !string.Equals(arg, "--probe-officer", StringComparison.OrdinalIgnoreCase)).Skip(1).FirstOrDefault();
        if (officerArg is not null)
        {
            var bytes = File.ReadAllBytes(officerArg);
            var rect = OfficerStampAnchor.Find(bytes, new Models.DscStampLayout());
            Console.WriteLine(rect is null
                ? "Officer label not found."
                : $"Officer stamp {rect.GetX():0.0},{rect.GetY():0.0} {rect.GetWidth():0.0}x{rect.GetHeight():0.0} right={rect.GetRight():0.0}");
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
