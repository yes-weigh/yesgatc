using System.IO;

namespace Yesgatc.CertificateWorker.Services;

internal static class WorkerProduct
{
#if EMAAP_ENGINE
    public const bool IsEmaapEngineBuild = true;
    public const bool IsDscEngineBuild = false;
    public const string AppName = "EmaapEngine";
    public const string ExeFileName = "EmaapEngine.exe";
    public const string DataFolderName = "EmaapEngine";
    public const string KnownInstallPath = @"C:\YesGATC\EmaapEngine";
    public const string AutostartName = "EmaapEngine";
    public const string SignInRoleLabel = "RC Admin";
#elif DSC_ENGINE
    public const bool IsEmaapEngineBuild = false;
    public const bool IsDscEngineBuild = true;
    public const string AppName = "YesGATC DSC Engine";
    public const string ExeFileName = "DscEngine.exe";
    public const string DataFolderName = "DscEngine";
    public const string KnownInstallPath = @"C:\YesGATC\DscEngine";
    public const string AutostartName = "YesGATC DSC Engine";
    public const string SignInRoleLabel = "RC Admin";
#else
    public const bool IsEmaapEngineBuild = false;
    public const bool IsDscEngineBuild = false;
    public const string AppName = "YesGATC Certificate Worker";
    public const string ExeFileName = "Yesgatc.CertificateWorker.exe";
    public const string DataFolderName = "CertificateWorker";
    public const string KnownInstallPath = @"C:\YesGATC\CertificateWorker";
    public const string AutostartName = "YesGATC Certificate Worker";
    public const string SignInRoleLabel = "Super Admin";
#endif

    public static string DataRoot
    {
        get
        {
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "YesGATC",
                DataFolderName);
            Directory.CreateDirectory(path);
            return path;
        }
    }
}
