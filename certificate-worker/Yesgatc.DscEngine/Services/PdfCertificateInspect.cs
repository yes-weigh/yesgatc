using System.Text;
using iText.Forms;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;

namespace Yesgatc.DscEngine.Services;

internal static class PdfCertificateInspect
{
    public const string DscFieldName = "YesGATC-DSC";

    public static bool HasSignedDscField(byte[] pdf)
    {
        if (pdf.Length < 5)
        {
            return false;
        }

        try
        {
            using var input = new MemoryStream(pdf, writable: false);
            using var reader = new PdfReader(input);
            using var document = new PdfDocument(reader);
            var form = PdfAcroForm.GetAcroForm(document, false);
            var field = form?.GetField(DscFieldName);
            return field?.GetPdfObject().Get(PdfName.V) is not null;
        }
        catch
        {
            return false;
        }
    }

    public static bool ContainsSerial(byte[] pdf, string? serial)
    {
        var needle = Compact(serial);
        if (needle.Length < 3 || pdf.Length < 5)
        {
            return false;
        }

        try
        {
            using var input = new MemoryStream(pdf, writable: false);
            using var reader = new PdfReader(input);
            using var document = new PdfDocument(reader);
            var text = new StringBuilder();
            for (var page = 1; page <= document.GetNumberOfPages(); page++)
            {
                text.Append(PdfTextExtractor.GetTextFromPage(document.GetPage(page)));
            }

            return Compact(text.ToString()).Contains(needle, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static string Compact(string? value) =>
        new string((value ?? string.Empty).Where(char.IsLetterOrDigit).ToArray());
}
