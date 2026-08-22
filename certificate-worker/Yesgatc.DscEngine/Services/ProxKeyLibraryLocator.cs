namespace Yesgatc.DscEngine.Services;

internal static class ProxKeyLibraryLocator
{
    public const string CspName = "PROXKey CSP India V3.0";
    public const string KspName = "PROXKey KSP India V3.0";

    public static readonly string WatchdataCertDirectory =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            "Watchdata", "WD PROXKey", "Cert");

    public static IReadOnlyList<string> CandidateLibraries(string? configured)
    {
        var system = Environment.GetFolderPath(Environment.SpecialFolder.System);
        var wow = Environment.GetFolderPath(Environment.SpecialFolder.SystemX86);
        var list = new List<string>();
        if (!string.IsNullOrWhiteSpace(configured))
        {
            list.Add(configured.Trim());
        }

        list.Add(Path.Combine(system, "Watchdata", CspName, "WDPKCS.dll"));
        list.Add(Path.Combine(system, "SignatureP11.dll"));
        if (!string.Equals(wow, system, StringComparison.OrdinalIgnoreCase))
        {
            list.Add(Path.Combine(wow, "Watchdata", CspName, "WDPKCS.dll"));
            list.Add(Path.Combine(wow, "SignatureP11.dll"));
        }

        return list
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static string? FindExistingLibrary(string? configured) =>
        CandidateLibraries(configured).FirstOrDefault(File.Exists);
}
