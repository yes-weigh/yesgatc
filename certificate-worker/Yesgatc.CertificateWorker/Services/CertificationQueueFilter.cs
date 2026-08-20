using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>Single production stage: Submitted → eMAAP fill+certify → PDF → Firebase certified.</summary>
internal static class CertificationQueueFilter
{
    public static IReadOnlyList<SiteCalibrationRecord> Apply(
        IEnumerable<SiteCalibrationRecord> records,
        string? rcId = null) =>
        records
            .Where(record => record.IsEligibleForWorkerQueue)
            .Where(record =>
                string.IsNullOrWhiteSpace(rcId)
                || string.Equals(record.RcId, rcId, StringComparison.Ordinal))
            .OrderByDescending(record => record.SubmittedAt ?? record.Id)
            .ToList();
}
