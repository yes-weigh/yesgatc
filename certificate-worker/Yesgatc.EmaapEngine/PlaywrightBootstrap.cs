using Yesgatc.CertificateWorker.Services;

namespace Yesgatc.EmaapEngine;

internal static class PlaywrightBootstrap
{
    public static void ConfigureBrowserPath()
    {
        var bundled = Path.Combine(AppContext.BaseDirectory, "ms-playwright");
        var data = Path.Combine(WorkerProduct.DataRoot, "ms-playwright");
        var path = HasChromium(bundled) ? bundled : data;
        Directory.CreateDirectory(path);
        Environment.SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", path);
    }

    public static void EnsureChromium()
    {
        ConfigureBrowserPath();
        var path = Environment.GetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH") ?? "";
        if (HasChromium(path))
        {
            return;
        }

        Microsoft.Playwright.Program.Main(["install", "chromium"]);
    }

    private static bool HasChromium(string browsersRoot)
    {
        if (string.IsNullOrWhiteSpace(browsersRoot) || !Directory.Exists(browsersRoot))
        {
            return false;
        }

        return Directory.EnumerateFiles(browsersRoot, "Google Chrome for Testing", SearchOption.AllDirectories)
            .Any();
    }
}
