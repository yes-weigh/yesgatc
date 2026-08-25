using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Yesgatc.DscEngine.Models;

namespace Yesgatc.DscEngine.Services;

public sealed class DscCertificateListService
{
    private readonly FirestoreDocumentClient _documents;

    public DscCertificateListService(FirebaseSettings settings)
    {
        _documents = new FirestoreDocumentClient(settings);
    }

    public async Task<IReadOnlyList<DscCertificateRecord>> ListIssuedForRcAsync(
        string rcUid,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(rcUid))
        {
            throw new InvalidOperationException("RC session is missing.");
        }

        var rows = await _documents.QueryEqualAsync(
            "siteCalibrations",
            "rcId",
            rcUid,
            idToken,
            cancellationToken);

        return rows
            .Select(row => Map(row.Id, row.Fields))
            .Where(record =>
                record.IsIssuedCertificate
                && !record.IsSuperseded
                && record.IsAfterLegacySequence)
            .OrderByDescending(record => record.CertifiedAt ?? record.CertificateNumber)
            .ToList();
    }

    private static DscCertificateRecord Map(
        string id,
        IReadOnlyDictionary<string, System.Text.Json.JsonElement> fields) =>
        new()
        {
            Id = id,
            CertificateNumber = FirestoreFieldReader.ReadString(fields, "certificateNumber"),
            SerialNumber = FirestoreFieldReader.ReadString(fields, "serialNumber"),
            CustomerName = FirestoreFieldReader.ReadString(fields, "customerName"),
            ProductName = FirestoreFieldReader.ReadString(fields, "productName"),
            VerificationType = FirestoreFieldReader.ReadString(fields, "verificationType"),
            Status = FirestoreFieldReader.ReadString(fields, "status"),
            CertifiedAt = EmptyToNull(FirestoreFieldReader.ReadString(fields, "certifiedAt")),
            CertificatePdfUrl = EmptyToNull(FirestoreFieldReader.ReadString(fields, "certificatePdfUrl")),
            CertificatePdfPath = EmptyToNull(FirestoreFieldReader.ReadString(fields, "certificatePdfPath")),
            EmaapCertificatePdfUrl = EmptyToNull(FirestoreFieldReader.ReadString(fields, "emaapCertificatePdfUrl")),
            SignedCertificatePdfUrl = EmptyToNull(FirestoreFieldReader.ReadString(fields, "signedCertificatePdfUrl")),
            SignedCertificatePdfPath = EmptyToNull(FirestoreFieldReader.ReadString(fields, "signedCertificatePdfPath")),
            CertificateVoidedAt = EmptyToNull(FirestoreFieldReader.ReadString(fields, "certificateVoidedAt")),
            SupersededByResubmissionId = EmptyToNull(FirestoreFieldReader.ReadString(fields, "supersededByResubmissionId")),
        };

    private static string? EmptyToNull(string value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;
}
