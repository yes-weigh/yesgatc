using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>Single production stage: Submitted → eMAAP fill+certify → PDF → Firebase certified.</summary>
internal static class CertificationQueueFilter
{
    public static IReadOnlyList<SiteCalibrationRecord> Apply(IEnumerable<SiteCalibrationRecord> records) =>
        records
            .Where(record => record.IsEligibleForWorkerQueue)
            .OrderByDescending(record => record.SubmittedAt ?? record.Id)
            .ToList();
}
