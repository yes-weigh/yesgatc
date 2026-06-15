using System.Collections.Frozen;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Maps pincode API district spellings to labels used on the DOCA website.
/// </summary>
public static class DocaDistrictAliases
{
    private static readonly FrozenDictionary<string, string> Aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["Kasargod"] = "Kasaragod",
        ["Kasargode"] = "Kasaragod",
    }.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);

    public static string NormalizeForDoca(string district)
    {
        var trimmed = district?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(trimmed))
        {
            return trimmed;
        }

        return Aliases.TryGetValue(trimmed, out var canonical) ? canonical : trimmed;
    }
}
