using System.Text.RegularExpressions;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>Certificates Issued row actions: leftover manual “Upload Signed PDF” or PDF-signer “Sign and Upload”.</summary>
internal static class EmaapIssuedSignButtons
{
    public static bool IsSignOrUploadLabel(string? label)
    {
        var text = Regex.Replace(label ?? string.Empty, @"\s+", " ").Trim();
        if (text.Length == 0)
        {
            return false;
        }

        return Regex.IsMatch(text, @"upload\s*signed\s*pdf", RegexOptions.IgnoreCase)
            || Regex.IsMatch(text, @"sign\s*(?:and|&)\s*upload", RegexOptions.IgnoreCase)
            || Regex.IsMatch(text, @"^sign\s*pdf$", RegexOptions.IgnoreCase);
    }
}
