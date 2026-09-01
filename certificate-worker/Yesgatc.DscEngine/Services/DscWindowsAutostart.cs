using System.Diagnostics;
using Microsoft.Win32;
using Yesgatc.CertificateWorker.Services;

namespace Yesgatc.DscEngine.Services;

internal static class DscWindowsAutostart
{
    public static string ResolveExePath()
    {
        var process = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(process) && File.Exists(process))
        {
            return Path.GetFullPath(process);
        }

        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, WorkerProduct.ExeFileName));
    }

    public static void EnsureRegistered()
    {
        var exe = ResolveExePath();
        var launch = $"\"{exe}\"";
        using (var key = Registry.CurrentUser.CreateSubKey(
                   @"Software\Microsoft\Windows\CurrentVersion\Run",
                   writable: true))
        {
            key?.SetValue(WorkerProduct.AutostartName, launch);
        }

        RunSchtasks(
            $"/Create /TN \"{WorkerProduct.AutostartName}\" /TR \"{launch.Replace("\"", "\\\"")}\" /SC ONLOGON /RL LIMITED /F");
    }

    public static void Unregister()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                writable: true);
            key?.DeleteValue(WorkerProduct.AutostartName, throwOnMissingValue: false);
        }
        catch
        {
        }

        try
        {
            RunSchtasks($"/Delete /TN \"{WorkerProduct.AutostartName}\" /F");
        }
        catch
        {
        }
    }

    private static void RunSchtasks(string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "schtasks.exe",
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        });
        process?.WaitForExit(20_000);
    }
}
