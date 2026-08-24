using Net.Pkcs11Interop.Common;
using Net.Pkcs11Interop.HighLevelAPI;

namespace Yesgatc.DscEngine.Services;

internal sealed record DscPkcs11Library(string Path, AppType AppType);

internal static class DscPkcs11Locator
{
    public const string ProxKeyCspName = "PROXKey CSP India V3.0";
    public const string ProxKeyKspName = "PROXKey KSP India V3.0";

    public static readonly string WatchdataCertDirectory =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            "Watchdata", "WD PROXKey", "Cert");

    public static readonly string InnalTCertDirectory =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            "Precision Biometric", "InnaIT", "InnaITDSC", "Certificates");

    public static IReadOnlyList<string> CandidateLibraries(string? configured)
    {
        var system = Environment.GetFolderPath(Environment.SpecialFolder.System);
        var wow = Environment.GetFolderPath(Environment.SpecialFolder.SystemX86);
        var list = new List<string>();
        if (!string.IsNullOrWhiteSpace(configured))
        {
            list.Add(configured.Trim());
        }

        list.Add(Path.Combine(system, "InnaITPKCS11Driver.dll"));
        list.Add(Path.Combine(system, "Watchdata", ProxKeyCspName, "WDPKCS.dll"));
        list.Add(Path.Combine(system, "SignatureP11.dll"));
        if (!string.Equals(wow, system, StringComparison.OrdinalIgnoreCase))
        {
            list.Add(Path.Combine(wow, "InnaITPKCS11Driver.dll"));
            list.Add(Path.Combine(wow, "Watchdata", ProxKeyCspName, "WDPKCS.dll"));
            list.Add(Path.Combine(wow, "SignatureP11.dll"));
        }

        return list
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static IReadOnlyList<string> AuthorityDirectories()
    {
        return new[] { InnalTCertDirectory, WatchdataCertDirectory }
            .Where(Directory.Exists)
            .ToList();
    }

    public static DscPkcs11Library? FindLibrary(string? configured)
    {
        DscPkcs11Library? fallback = null;
        foreach (var path in CandidateLibraries(configured))
        {
            if (!File.Exists(path))
            {
                continue;
            }

            foreach (var appType in new[] { AppType.MultiThreaded, AppType.SingleThreaded })
            {
                var load = new DscPkcs11Library(path, appType);
                fallback ??= load;
                try
                {
                    if (HasPresentToken(load))
                    {
                        return load;
                    }
                }
                catch
                {
                }
            }
        }

        return fallback;
    }

    public static bool HasPresentToken(DscPkcs11Library load)
    {
        var factories = new Pkcs11InteropFactories();
        using var library = factories.Pkcs11LibraryFactory.LoadPkcs11Library(
            factories,
            load.Path,
            load.AppType);
        return library.GetSlotList(SlotsType.WithOrWithoutTokenPresent)
            .Any(slot =>
            {
                try
                {
                    return slot.GetSlotInfo().SlotFlags.TokenPresent;
                }
                catch
                {
                    return false;
                }
            });
    }
}
