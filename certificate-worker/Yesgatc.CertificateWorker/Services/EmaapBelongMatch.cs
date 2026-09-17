namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// eMAAP Belongs-to cells truncate, drop punctuation, and occasionally typo a letter
/// (Sony vs Sory). Match on token overlap after stripping punctuation.
/// </summary>
internal static class EmaapBelongMatch
{
    public static bool Matches(string? wantRaw, string? haystack)
    {
        var want = Normalize(wantRaw);
        var have = Normalize(haystack);
        if (string.IsNullOrEmpty(want) || string.IsNullOrEmpty(have))
        {
            return false;
        }

        if (have.Contains(want, StringComparison.Ordinal)
            || want.Contains(have, StringComparison.Ordinal))
        {
            return true;
        }

        var cap = want.Length <= 50 ? want : want[..50].Trim();
        if (cap.Length >= 8
            && (have.Contains(cap, StringComparison.Ordinal)
                || cap.Contains(have, StringComparison.Ordinal)))
        {
            return true;
        }

        var wantT = Tokens(want);
        var haveT = Tokens(have);
        if (wantT.Count == 0 || haveT.Count == 0)
        {
            return false;
        }

        var hits = wantT.Count(t => haveT.Any(h =>
            h == t
            || (t.Length >= 4 && h.Length >= 4 && (h.Contains(t) || t.Contains(h)))));
        return hits >= Math.Min(3, wantT.Count) || hits >= wantT.Count - 1;
    }

    public static string Normalize(string? value)
    {
        var chars = new System.Text.StringBuilder((value ?? string.Empty).Length);
        foreach (var c in value ?? string.Empty)
        {
            chars.Append(char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : ' ');
        }

        return string.Join(' ', chars.ToString().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    private static List<string> Tokens(string normalized) =>
        normalized.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(t => t.Length >= 2)
            .ToList();
}
