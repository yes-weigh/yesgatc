namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// eMAAP SweetAlert after Submit Certificate Details.
/// Any OK button is not success — only "Record saved successfully".
/// </summary>
internal static class EmaapSubmitDialog
{
    public static bool IsSuccess(string? text) =>
        Contains(text, "Record saved successfully");

    public static bool IsFailure(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || IsSuccess(text))
        {
            return false;
        }

        var compact = Compact(text);
        if (compact.Length < 6)
        {
            return false;
        }

        if (compact.Equals("OK", StringComparison.OrdinalIgnoreCase)
            || compact.Equals("Okay", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return true;
    }

    public static string Summarize(string? text)
    {
        var compact = Compact(text);
        if (string.IsNullOrWhiteSpace(compact))
        {
            return "unknown eMAAP alert";
        }

        return compact.Length <= 220 ? compact : compact[..220].Trim();
    }

    private static bool Contains(string? text, string needle) =>
        (text ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0;

    private static string Compact(string? text) =>
        string.Join(' ', (text ?? string.Empty)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
