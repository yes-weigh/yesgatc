using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Registers the worker to start when Windows starts / the user logs on.
/// Uses HKCU Run (logon) + a scheduled task (logon + delayed startup).
/// Requires an interactive desktop for Chrome — after reboot, RDP in or use auto-logon.
/// </summary>
public static class WindowsAutostartService
{
    public const string TaskName = "YesGATC Certificate Worker";
    public const string RunValueName = "YesGATC Certificate Worker";
    private const string KnownInstallPath = @"C:\YesGATC\CertificateWorker";

    public static string ResolveInstallDirectory()
    {
        var baseDir = Path.GetFullPath(AppContext.BaseDirectory.TrimEnd(
            Path.DirectorySeparatorChar,
            Path.AltDirectorySeparatorChar));

        var knownExe = Path.Combine(KnownInstallPath, "Yesgatc.CertificateWorker.exe");
        if (File.Exists(knownExe)
            && string.Equals(
                Path.GetFullPath(KnownInstallPath),
                baseDir,
                StringComparison.OrdinalIgnoreCase))
        {
            return KnownInstallPath;
        }

        return baseDir;
    }

    public static string ResolveExePath() =>
        Path.Combine(ResolveInstallDirectory(), "Yesgatc.CertificateWorker.exe");

    public static string BuildLaunchCommand(string installDir)
    {
        var startScript = Path.Combine(installDir, "start-worker.ps1");
        if (File.Exists(startScript))
        {
            return
                $"powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{startScript}\" -InstallPath \"{installDir}\"";
        }

        var exe = Path.Combine(installDir, "Yesgatc.CertificateWorker.exe");
        return $"\"{exe}\"";
    }

    public static bool IsRegistered()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                writable: false);
            if (key?.GetValue(RunValueName) is string value && !string.IsNullOrWhiteSpace(value))
            {
                return true;
            }
        }
        catch
        {
            // ignore
        }

        return TaskExists();
    }

    public static void EnsureRegistered()
    {
        var installDir = ResolveInstallDirectory();
        var launch = BuildLaunchCommand(installDir);
        RegisterRunKey(launch);

        // Prefer full PowerShell registration (logon + delayed startup + Run key).
        if (TryRegisterFullTaskViaPowerShell(installDir))
        {
            return;
        }

        // Dev / missing script — at least ONLOGON via schtasks.
        RegisterScheduledTaskLogonOnly(launch);
    }

    public static void Unregister()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                writable: true);
            key?.DeleteValue(RunValueName, throwOnMissingValue: false);
        }
        catch
        {
            // ignore
        }

        try
        {
            RunSchtasks($"/Delete /TN \"{TaskName}\" /F");
        }
        catch
        {
            // ignore
        }
    }

    private static void RegisterRunKey(string launchCommand)
    {
        using var key = Registry.CurrentUser.CreateSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run",
            writable: true);
        key?.SetValue(RunValueName, launchCommand);
    }

    private static void RegisterScheduledTaskLogonOnly(string launchCommand)
    {
        var tr = launchCommand.Replace("\"", "\\\"");
        RunSchtasks($"/Create /TN \"{TaskName}\" /TR \"{tr}\" /SC ONLOGON /RL LIMITED /F");
    }

    private static bool TryRegisterFullTaskViaPowerShell(string installDir)
    {
        var registerScript = Path.Combine(installDir, "register-autostart.ps1");
        if (!File.Exists(registerScript))
        {
            return false;
        }

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments =
                    $"-NoProfile -ExecutionPolicy Bypass -File \"{registerScript}\" -InstallPath \"{installDir}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = installDir,
            };
            using var process = Process.Start(psi);
            if (process is null)
            {
                return false;
            }

            process.WaitForExit(45_000);
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private static bool TaskExists()
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "schtasks.exe",
                Arguments = $"/Query /TN \"{TaskName}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var process = Process.Start(psi);
            if (process is null)
            {
                return false;
            }

            process.WaitForExit(10_000);
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private static void RunSchtasks(string arguments)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "schtasks.exe",
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var process = Process.Start(psi);
        process?.WaitForExit(30_000);
    }
}
