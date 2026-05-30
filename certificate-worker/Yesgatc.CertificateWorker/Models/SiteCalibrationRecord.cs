namespace Yesgatc.CertificateWorker.Models;

public sealed class SiteCalibrationRecord
{
    public string Id { get; init; } = string.Empty;
    public string RcId { get; init; } = string.Empty;
    public string RcCenterName { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string VerificationType { get; init; } = string.Empty;
    public string CustomerName { get; init; } = string.Empty;
    public string ProductName { get; init; } = string.Empty;
    public string SerialNumber { get; init; } = string.Empty;
    public string? SubmittedAt { get; init; }
    public string? ApprovedAt { get; init; }
    public string? CertifiedAt { get; init; }
    public string? CertificatePdfUrl { get; init; }
    public string? SealIdentificationNumber { get; init; }

    public bool IsDraft => string.Equals(Status, VerificationStatuses.Draft, StringComparison.OrdinalIgnoreCase);
    public bool IsSubmitted => string.Equals(Status, VerificationStatuses.Submitted, StringComparison.OrdinalIgnoreCase);
    public bool IsApproved => string.Equals(Status, VerificationStatuses.Approved, StringComparison.OrdinalIgnoreCase);
    public bool IsCertified => string.Equals(Status, VerificationStatuses.Certified, StringComparison.OrdinalIgnoreCase);
    public bool HasCertificate => IsCertified || !string.IsNullOrWhiteSpace(CertificatePdfUrl);
    public bool IsReadyToCertify => IsApproved && !IsCertified;

    public string StatusLabel => VerificationStatuses.Label(Status);

    public string VerificationTypeLabel => VerificationType switch
    {
        "OV" => "Initial (OV)",
        "RV" => "Re-verification (RV)",
        _ => VerificationType,
    };

    public string SubmittedAtDisplay => FormatTimestamp(SubmittedAt);
    public string ApprovedAtDisplay => FormatTimestamp(ApprovedAt);
    public string CertifiedAtDisplay => FormatTimestamp(CertifiedAt);

    public string CertificationStatusLabel => IsCertified ? "Certified" : "Awaiting DOCA";

    private static string FormatTimestamp(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "—";
        }

        if (DateTime.TryParse(value, out var parsed))
        {
            return parsed.ToLocalTime().ToString("dd MMM yyyy HH:mm");
        }

        return value;
    }
}
