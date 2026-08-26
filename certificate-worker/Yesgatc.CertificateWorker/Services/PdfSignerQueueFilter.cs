using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Certified jobs for Super Admin “PDF signer” RCs, seq &gt; 2304, not yet signed.
/// </summary>
internal static class PdfSignerQueueFilter
{
    public static IReadOnlyList<SiteCalibrationRecord> Apply(
        IEnumerable<SiteCalibrationRecord> records,
        IReadOnlySet<string> pdfSignerRcIds,
        string? rcId = null)
    {
        if (pdfSignerRcIds.Count == 0)
        {
            return [];
        }

        return records
            .Where(record => record.IsEligibleForPdfSignerQueue)
            .Where(record => pdfSignerRcIds.Contains(record.RcId))
            .Where(record =>
                string.IsNullOrWhiteSpace(rcId)
                || string.Equals(record.RcId, rcId, StringComparison.Ordinal))
            .OrderBy(record => SiteCalibrationRecord.ParseCertificateSequence(record.CertificateNumber) ?? int.MaxValue)
            .ThenBy(record => record.CertifiedAt ?? record.Id)
            .ToList();
    }
}
