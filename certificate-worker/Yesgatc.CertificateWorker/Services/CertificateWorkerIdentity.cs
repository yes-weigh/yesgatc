using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

internal static class CertificateWorkerIdentity
{
    public const string KindVps = "vps";
    public const string KindEmaapEngine = "emaapengine";

    public static bool IsSuperAdmin(FirebaseSignInResult? session) =>
        string.Equals(session?.Role, "super_admin", StringComparison.OrdinalIgnoreCase);

    public static bool IsEmaapEngine(FirebaseSignInResult? session) =>
        string.Equals(session?.Role, "rc_admin", StringComparison.OrdinalIgnoreCase);

    public static string Kind(FirebaseSignInResult? session) =>
        IsEmaapEngine(session) ? KindEmaapEngine : KindVps;

    public static string WorkerId(FirebaseSignInResult session)
    {
        if (IsEmaapEngine(session))
        {
            return session.UserId;
        }

        var machine = new string((Environment.MachineName ?? "vps")
            .Select(ch => char.IsLetterOrDigit(ch) ? ch : '-')
            .ToArray())
            .Trim('-');
        if (string.IsNullOrWhiteSpace(machine))
        {
            machine = "vps";
        }

        return $"vps-{machine}";
    }
}
