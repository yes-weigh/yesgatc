using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// After eMAAP has the DSC PDF, the unsigned Firebase copy under certificate-pdf/ is surplus.
/// </summary>
internal static class UnsignedCertificatePdfCleanup
{
    public static string? ResolveStoragePath(SiteCalibrationRecord job)
    {
        if (IsSafeUnsignedPath(job.CertificatePdfPath, job.Id, job.SignedCertificatePdfPath))
        {
            return job.CertificatePdfPath!.Trim();
        }

        var fromUrl = TryParseStoragePath(job.CertificatePdfUrl);
        return IsSafeUnsignedPath(fromUrl, job.Id, job.SignedCertificatePdfPath) ? fromUrl : null;
    }

    public static bool IsSafeUnsignedPath(string? path, string jobId, string? signedPath)
    {
        var trimmed = path?.Trim();
        if (string.IsNullOrWhiteSpace(trimmed) || string.IsNullOrWhiteSpace(jobId))
        {
            return false;
        }

        var normalized = trimmed.Replace('\\', '/');
        var signed = signedPath?.Trim().Replace('\\', '/');
        if (!string.IsNullOrWhiteSpace(signed)
            && string.Equals(normalized, signed, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var prefix = $"siteCalibrations/{jobId.Trim()}/certificate-pdf/";
        return normalized.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    public static string? TryParseStoragePath(string? downloadUrl)
    {
        if (string.IsNullOrWhiteSpace(downloadUrl))
        {
            return null;
        }

        if (!Uri.TryCreate(downloadUrl.Trim(), UriKind.Absolute, out var uri))
        {
            return null;
        }

        var match = System.Text.RegularExpressions.Regex.Match(
            uri.AbsolutePath,
            @"/o/(.+)$",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!match.Success)
        {
            return null;
        }

        return Uri.UnescapeDataString(match.Groups[1].Value);
    }
}
