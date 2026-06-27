using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

internal static class CertificationQueueFilter
{
    public static IReadOnlyList<SiteCalibrationRecord> Apply(IEnumerable<SiteCalibrationRecord> records)
    {
        var list = records
            .Where(record => record.IsEligibleForWorkerQueue)
            .ToList();

        var activeSerialKeys = BuildActiveSerialKeys(list);

        return list
            .Where(record => !ShouldSkipApprovedForSerial(record, activeSerialKeys))
            .OrderBy(record => record.IsSubmitted ? 0 : 1)
            .ThenByDescending(record => record.IsSubmitted
                ? record.SubmittedAt ?? record.Id
                : record.ApprovedAt ?? record.SubmittedAt ?? record.Id)
            .ToList();
    }

    private static HashSet<string> BuildActiveSerialKeys(IReadOnlyList<SiteCalibrationRecord> records)
    {
        var keys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var record in records)
        {
            var serialKey = SerialKey(record);
            if (serialKey is null)
            {
                continue;
            }

            if (record.IsSubmitted)
            {
                keys.Add(serialKey);
                continue;
            }

            if (record.IsCertified && !string.IsNullOrWhiteSpace(record.CertificatePdfUrl))
            {
                keys.Add(serialKey);
            }
        }

        return keys;
    }

    private static bool ShouldSkipApprovedForSerial(
        SiteCalibrationRecord record,
        IReadOnlySet<string> activeSerialKeys)
    {
        if (!record.IsApproved)
        {
            return false;
        }

        var serialKey = SerialKey(record);
        return serialKey is not null && activeSerialKeys.Contains(serialKey);
    }

    private static string? SerialKey(SiteCalibrationRecord record)
    {
        var rcId = record.RcId.Trim();
        var serial = record.SerialNumber.Trim();
        if (string.IsNullOrWhiteSpace(rcId) || string.IsNullOrWhiteSpace(serial))
        {
            return null;
        }

        return $"{rcId}\0{serial}".ToLowerInvariant();
    }
}
