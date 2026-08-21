namespace Yesgatc.CertificateWorker.Services;

internal static class EmaapPortalLogin
{
#if EMAAP_ENGINE
    internal const string Email = "admin@yesweigh.in";
    internal const string Password = "Weigh@123!789";
#else
    internal const string Email = "";
    internal const string Password = "";
#endif
}
