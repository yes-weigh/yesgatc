namespace Yesgatc.CertificateWorker.Services;

internal static class EmaapCertificatePdfSerial
{
    public static string Compact(string? value) =>
        new string((value ?? string.Empty).Where(char.IsLetterOrDigit).ToArray());

    public static bool TextContainsSerial(string? pdfText, string? serial)
    {
        var needle = Compact(serial);
        var haystack = Compact(pdfText);
        return needle.Length >= 3
            && haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);
    }
}
