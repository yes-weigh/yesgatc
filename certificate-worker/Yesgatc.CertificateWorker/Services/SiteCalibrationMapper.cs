using Google.Cloud.Firestore;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

internal static class SiteCalibrationMapper
{
    public static SiteCalibrationRecord FromSnapshot(
        DocumentSnapshot snapshot,
        IReadOnlyDictionary<string, string> rcNames)
    {
        var rcId = ReadString(snapshot, "rcId");
        return new SiteCalibrationRecord
        {
            Id = snapshot.Id,
            RcId = rcId,
            RcCenterName = rcNames.TryGetValue(rcId, out var name) ? name : "—",
            Status = ReadString(snapshot, "status", "draft"),
            VerificationType = ReadString(snapshot, "verificationType"),
            CustomerName = ReadString(snapshot, "customerName"),
            ProductName = ReadString(snapshot, "productName"),
            SerialNumber = ReadString(snapshot, "serialNumber"),
            SubmittedAt = ReadOptionalString(snapshot, "submittedAt"),
            ApprovedAt = ReadOptionalString(snapshot, "approvedAt"),
            CertifiedAt = ReadOptionalString(snapshot, "certifiedAt"),
            CertificatePdfUrl = ReadOptionalString(snapshot, "certificatePdfUrl"),
            ResubmittedFromId = ReadOptionalString(snapshot, "resubmittedFromId"),
            SealIdentificationNumber = ReadOptionalString(snapshot, "sealIdentificationNumber"),
        };
    }

    public static SiteCalibrationRecord FromRestFields(
        string id,
        IReadOnlyDictionary<string, System.Text.Json.JsonElement> fields,
        IReadOnlyDictionary<string, string> rcNames)
    {
        var rcId = FirestoreFieldReader.ReadString(fields, "rcId");
        return new SiteCalibrationRecord
        {
            Id = id,
            RcId = rcId,
            RcCenterName = rcNames.TryGetValue(rcId, out var name) ? name : "—",
            Status = FirestoreFieldReader.ReadString(fields, "status", "draft"),
            VerificationType = FirestoreFieldReader.ReadString(fields, "verificationType"),
            CustomerName = FirestoreFieldReader.ReadString(fields, "customerName"),
            ProductName = FirestoreFieldReader.ReadString(fields, "productName"),
            SerialNumber = FirestoreFieldReader.ReadString(fields, "serialNumber"),
            SubmittedAt = FirestoreFieldReader.ReadString(fields, "submittedAt"),
            ApprovedAt = FirestoreFieldReader.ReadString(fields, "approvedAt"),
            CertifiedAt = FirestoreFieldReader.ReadString(fields, "certifiedAt"),
            CertificatePdfUrl = FirestoreFieldReader.ReadString(fields, "certificatePdfUrl"),
            ResubmittedFromId = FirestoreFieldReader.ReadString(fields, "resubmittedFromId"),
            SealIdentificationNumber = FirestoreFieldReader.ReadString(fields, "sealIdentificationNumber"),
        };
    }

    private static string ReadString(DocumentSnapshot snapshot, string field, string fallback = "") =>
        snapshot.TryGetValue<string>(field, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.Trim()
            : fallback;

    private static string? ReadOptionalString(DocumentSnapshot snapshot, string field) =>
        snapshot.TryGetValue<string>(field, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.Trim()
            : null;
}
