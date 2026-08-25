namespace Yesgatc.DscEngine.Models;

public enum DscSignStatus
{
    NotSigned,
    Signed,
    Voided,
}

public sealed class DscCertificateRecord
{
    public const int LegacySignedSequenceMax = 2304;

    public string Id { get; init; } = string.Empty;
    public string CertificateNumber { get; init; } = string.Empty;
    public string SerialNumber { get; init; } = string.Empty;
    public string CustomerName { get; init; } = string.Empty;
    public string ProductName { get; init; } = string.Empty;
    public string VerificationType { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string? CertifiedAt { get; init; }
    public string? CertificatePdfUrl { get; init; }
    public string? CertificatePdfPath { get; init; }
    public string? EmaapCertificatePdfUrl { get; init; }
    public string? SignedCertificatePdfUrl { get; init; }
    public string? SignedCertificatePdfPath { get; init; }
    public string? CertificateVoidedAt { get; init; }
    public string? SupersededByResubmissionId { get; init; }

    public bool IsVoided => !string.IsNullOrWhiteSpace(CertificateVoidedAt);
    public bool IsSuperseded => !string.IsNullOrWhiteSpace(SupersededByResubmissionId);

    public bool IsIssuedCertificate =>
        string.Equals(Status, "certified", StringComparison.OrdinalIgnoreCase)
        && !string.IsNullOrWhiteSpace(CertificateNumber);

    public bool IsAfterLegacySequence =>
        ParseSequence(CertificateNumber) is int sequence && sequence > LegacySignedSequenceMax;

    public string VerificationTypeLabel => VerificationType switch
    {
        "RV" => "RV",
        "OV" => "OV",
        _ => string.IsNullOrWhiteSpace(VerificationType) ? "—" : VerificationType,
    };

    public string CertifiedAtDisplay => FormatTimestamp(CertifiedAt);

    public DscSignStatus SignStatus => ResolveSignStatus();

    public string SignStatusLabel => SignStatus switch
    {
        DscSignStatus.Voided => "Voided",
        DscSignStatus.Signed => "Signed",
        _ => "Not signed",
    };

    public DscCertificateRecord WithSignedPdf(string url, string? path = null) =>
        new()
        {
            Id = Id,
            CertificateNumber = CertificateNumber,
            SerialNumber = SerialNumber,
            CustomerName = CustomerName,
            ProductName = ProductName,
            VerificationType = VerificationType,
            Status = Status,
            CertifiedAt = CertifiedAt,
            CertificatePdfUrl = CertificatePdfUrl,
            CertificatePdfPath = CertificatePdfPath,
            EmaapCertificatePdfUrl = EmaapCertificatePdfUrl,
            SignedCertificatePdfUrl = url,
            SignedCertificatePdfPath = path ?? SignedCertificatePdfPath,
            CertificateVoidedAt = CertificateVoidedAt,
            SupersededByResubmissionId = SupersededByResubmissionId,
        };

    public static int? ParseSequence(string? certificateNumber)
    {
        var tail = (certificateNumber ?? "").Trim().Split('/').LastOrDefault() ?? "";
        return int.TryParse(tail, out var sequence) && sequence > 0 ? sequence : null;
    }

    private DscSignStatus ResolveSignStatus()
    {
        if (IsVoided)
        {
            return DscSignStatus.Voided;
        }

        if (!string.IsNullOrWhiteSpace(SignedCertificatePdfUrl))
        {
            return DscSignStatus.Signed;
        }

        var sequence = ParseSequence(CertificateNumber);
        if (sequence is not null && sequence <= LegacySignedSequenceMax)
        {
            return DscSignStatus.Signed;
        }

        return DscSignStatus.NotSigned;
    }

    private static string FormatTimestamp(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "—";
        }

        return DateTime.TryParse(value, out var parsed)
            ? parsed.ToLocalTime().ToString("dd MMM yyyy HH:mm")
            : value;
    }
}
