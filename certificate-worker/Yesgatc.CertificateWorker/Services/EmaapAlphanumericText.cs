using System.Text;
using System.Text.RegularExpressions;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// eMAAP Generate Certificates text fields (Address, Belongs to) reject punctuation.
/// Portal hint: "Alpha numerice allowed".
/// </summary>
internal static class EmaapAlphanumericText
{
    public const int AddressMaxLength = 200;
    public const int BelongToMaxLength = 50;
    public const int RemarksMaxLength = 50;

    private static readonly Regex Ampersand = new("&amp;|&", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex MultiSpace = new(@"\s+", RegexOptions.Compiled);

    public static string Sanitize(string? value, int maxLength = 0)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var text = Ampersand.Replace(value.Trim(), " AND ");
        var chars = new StringBuilder(text.Length);
        foreach (var c in text)
        {
            if (char.IsLetterOrDigit(c) || c == ' ')
            {
                chars.Append(c);
            }
            else
            {
                chars.Append(' ');
            }
        }

        var cleaned = MultiSpace.Replace(chars.ToString(), " ").Trim();
        if (maxLength > 0 && cleaned.Length > maxLength)
        {
            return cleaned[..maxLength].Trim();
        }

        return cleaned;
    }

    public static string Require(string? value, int maxLength, string fieldLabel)
    {
        var cleaned = Sanitize(value, maxLength);
        if (string.IsNullOrWhiteSpace(cleaned))
        {
            throw new InvalidOperationException(
                $"eMAAP {fieldLabel} is empty after removing punctuation.");
        }

        return cleaned;
    }

    public static bool IsAccepted(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.All(c => char.IsLetterOrDigit(c) || c == ' ');
}
