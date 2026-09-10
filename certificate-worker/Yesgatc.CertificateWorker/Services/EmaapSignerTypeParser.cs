using System.Text.RegularExpressions;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>Read eMAAP GATC profile / dashboard text for signer type. No hardcoded RC names.</summary>
internal static class EmaapSignerTypeParser
{
    private static readonly Regex Labeled = new(
        @"(?:signing\s*(?:method|type)|certificate\s*signing|signer\s*type|user\s*type|digital\s*sign(?:ing)?)\s*[:\-]?\s*(pdf\s*signer|pdf\s*signatory|manual\s*upload|manual\s*sign(?:ing)?|auto\s*dsc)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string? TryParse(string? pageText)
    {
        if (string.IsNullOrWhiteSpace(pageText))
        {
            return null;
        }

        var text = Regex.Replace(pageText, @"\s+", " ").Trim();
        var labeled = Labeled.Match(text);
        if (labeled.Success)
        {
            return NormalizeToken(labeled.Groups[1].Value);
        }

        var pdf = Regex.IsMatch(text, @"\bPDF\s*Signer\b", RegexOptions.IgnoreCase);
        var manual = Regex.IsMatch(text, @"\bManual\s*Upload\b", RegexOptions.IgnoreCase);
        if (pdf && !manual)
        {
            return RcCertificationMethods.PdfSigner;
        }

        return null;
    }

    private static string NormalizeToken(string raw)
    {
        var compact = Regex.Replace(raw, @"\s+", " ").Trim();
        if (Regex.IsMatch(compact, @"pdf\s*sign", RegexOptions.IgnoreCase))
        {
            return RcCertificationMethods.PdfSigner;
        }

        if (Regex.IsMatch(compact, @"manual", RegexOptions.IgnoreCase))
        {
            return RcCertificationMethods.ManualUpload;
        }

        return RcCertificationMethods.AutoDsc;
    }
}
