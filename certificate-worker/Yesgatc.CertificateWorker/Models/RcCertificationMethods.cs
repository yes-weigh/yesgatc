namespace Yesgatc.CertificateWorker.Models;

internal static class RcCertificationMethods
{
    public const string PdfSigner = "pdf_signer";

    public static bool IsPdfSigner(string? value) =>
        string.Equals(value, PdfSigner, StringComparison.OrdinalIgnoreCase);
}
