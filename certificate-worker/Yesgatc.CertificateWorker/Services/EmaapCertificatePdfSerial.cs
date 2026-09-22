using System.IO;
using UglyToad.PdfPig;

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

    /// <summary>
    /// False when the file is missing, unreadable, or the serial is not in the text.
    /// Never fail-open — a PDF we cannot read must not be bound to a job.
    /// </summary>
    public static bool FileContainsSerial(string? pdfPath, string? serial)
    {
        var needle = Compact(serial);
        if (needle.Length < 3 || string.IsNullOrWhiteSpace(pdfPath) || !File.Exists(pdfPath))
        {
            return false;
        }

        try
        {
            using var document = PdfDocument.Open(pdfPath);
            foreach (var page in document.GetPages())
            {
                if (TextContainsSerial(page.Text, serial))
                {
                    return true;
                }
            }

            return false;
        }
        catch
        {
            return false;
        }
    }
}
