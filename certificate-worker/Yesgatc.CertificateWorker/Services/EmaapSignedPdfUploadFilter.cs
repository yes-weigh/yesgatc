using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>After generate queue is empty: certified rows with a signed PDF still missing eMAAP upload.</summary>
internal static class EmaapSignedPdfUploadFilter
{
    public static IReadOnlyList<SiteCalibrationRecord> Apply(
        IEnumerable<SiteCalibrationRecord> records,
        string? rcId = null) =>
        records
            .Where(record => record.IsEligibleForSignedPdfUpload)
            .Where(record =>
                string.IsNullOrWhiteSpace(rcId)
                || string.Equals(record.RcId, rcId, StringComparison.Ordinal))
            .OrderBy(record => SiteCalibrationRecord.ParseCertificateSequence(record.CertificateNumber) ?? int.MaxValue)
            .ThenBy(record => record.CertifiedAt ?? record.Id)
            .ToList();
}
