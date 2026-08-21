using System.IO;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Chrome blocks Playwright on the real User Data profile (pages stay about:blank).
/// Mirror the chosen profile into a YesGATC folder Playwright can automate.
/// </summary>
public static class ChromeProfileMirror
{
    private static readonly string[] SkipDirectoryNames =
    [
        "Cache",
        "Code Cache",
        "GPUCache",
        "GrShaderCache",
        "ShaderCache",
        "Service Worker\\CacheStorage",
        "optimization_guide_prediction_model_downloads",
    ];

    private static readonly string[] SkipFileNames =
    [
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
        "lockfile",
    ];

    public static string MirrorUserDataDir =>
        Path.Combine(
            WorkerProduct.DataRoot,
            "chrome-system-mirror");

    public static string MirrorDefaultProfileDir => Path.Combine(MirrorUserDataDir, "Default");

    public static void InvalidateMirror()
    {
        var marker = Path.Combine(MirrorUserDataDir, ".synced-from");
        try
        {
            if (File.Exists(marker))
            {
                File.Delete(marker);
            }
        }
        catch (IOException)
        {
        }
    }

    public static void SyncFromSystemProfile(string sourceProfileDir, bool force = false)
    {
        if (!Directory.Exists(sourceProfileDir))
        {
            throw new InvalidOperationException($"Chrome profile not found: {sourceProfileDir}");
        }

        var marker = Path.Combine(MirrorUserDataDir, ".synced-from");
        var sourceKey = Path.GetFullPath(sourceProfileDir);
        if (!force
            && Directory.Exists(MirrorDefaultProfileDir)
            && File.Exists(marker)
            && string.Equals(File.ReadAllText(marker).Trim(), sourceKey, StringComparison.OrdinalIgnoreCase))
        {
            // Refresh cookies/login state on each sync request when Chrome is closed.
            CopyLoginArtifacts(sourceProfileDir, MirrorDefaultProfileDir);
            return;
        }

        Directory.CreateDirectory(MirrorUserDataDir);
        if (Directory.Exists(MirrorDefaultProfileDir))
        {
            try
            {
                Directory.Delete(MirrorDefaultProfileDir, recursive: true);
            }
            catch (IOException)
            {
                // Fall through — overwrite files.
            }
        }

        Directory.CreateDirectory(MirrorDefaultProfileDir);
        CopyDirectory(sourceProfileDir, MirrorDefaultProfileDir);
        File.WriteAllText(marker, sourceKey);
    }

    /// <summary>Fast path: cookies + local storage used by DeepSeek / Google login.</summary>
    private static void CopyLoginArtifacts(string source, string dest)
    {
        string[] files =
        [
            "Cookies",
            "Cookies-journal",
            "Login Data",
            "Login Data-journal",
            "Web Data",
            "Web Data-journal",
            "Preferences",
            "Secure Preferences",
            "Network\\Cookies",
            "Network\\Cookies-journal",
        ];

        foreach (var relative in files)
        {
            var from = Path.Combine(source, relative);
            var to = Path.Combine(dest, relative);
            if (!File.Exists(from))
            {
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(to)!);
            try
            {
                File.Copy(from, to, overwrite: true);
            }
            catch (IOException)
            {
                // Locked while Chrome open — keep previous mirror copy.
            }
        }

        foreach (var folder in new[] { "Local Storage", "Session Storage", "IndexedDB" })
        {
            var fromDir = Path.Combine(source, folder);
            var toDir = Path.Combine(dest, folder);
            if (!Directory.Exists(fromDir))
            {
                continue;
            }

            try
            {
                if (Directory.Exists(toDir))
                {
                    Directory.Delete(toDir, recursive: true);
                }

                CopyDirectory(fromDir, toDir);
            }
            catch (IOException)
            {
                // ignore locked files
            }
        }
    }

    private static void CopyDirectory(string sourceDir, string destDir)
    {
        Directory.CreateDirectory(destDir);

        foreach (var file in Directory.EnumerateFiles(sourceDir))
        {
            var name = Path.GetFileName(file);
            if (SkipFileNames.Contains(name, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            var destFile = Path.Combine(destDir, name);
            try
            {
                File.Copy(file, destFile, overwrite: true);
            }
            catch (IOException)
            {
                // skip locked
            }
        }

        foreach (var dir in Directory.EnumerateDirectories(sourceDir))
        {
            var name = Path.GetFileName(dir);
            if (ShouldSkipDirectory(name))
            {
                continue;
            }

            CopyDirectory(dir, Path.Combine(destDir, name));
        }
    }

    private static bool ShouldSkipDirectory(string name)
    {
        foreach (var skip in SkipDirectoryNames)
        {
            if (name.Equals(skip, StringComparison.OrdinalIgnoreCase)
                || skip.EndsWith(name, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return name.Equals("Cache", StringComparison.OrdinalIgnoreCase)
            || name.Equals("Code Cache", StringComparison.OrdinalIgnoreCase)
            || name.Equals("GPUCache", StringComparison.OrdinalIgnoreCase);
    }
}
