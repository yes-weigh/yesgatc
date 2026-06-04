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
    public string? ResubmittedFromId { get; init; }
    public string? SealIdentificationNumber { get; init; }

    public bool IsDraft => string.Equals(Status, VerificationStatuses.Draft, StringComparison.OrdinalIgnoreCase);
    public bool IsSubmitted => string.Equals(Status, VerificationStatuses.Submitted, StringComparison.OrdinalIgnoreCase);
    public bool IsApproved => string.Equals(Status, VerificationStatuses.Approved, StringComparison.OrdinalIgnoreCase);
    public bool IsCertified => string.Equals(Status, VerificationStatuses.Certified, StringComparison.OrdinalIgnoreCase);
    public bool HasCertificate => IsCertified || !string.IsNullOrWhiteSpace(CertificatePdfUrl);
    public bool IsReadyToCertify => IsApproved && !IsCertified;
    public bool NeedsCertificatePdfUpload =>
        string.IsNullOrWhiteSpace(CertificatePdfUrl) && (IsApproved || IsCertified);
    public bool NeedsPipelineWork => IsSubmitted || IsReadyToCertify || NeedsCertificatePdfUpload;

    public string NextStepLabel
    {
        get
        {
            if (IsSubmitted)
            {
                return "Phase 1 · Submit on DOCA";
            }

            if (IsReadyToCertify)
            {
                return "Phase 2 · Certify on DOCA";
            }

            if (NeedsCertificatePdfUpload)
            {
                return "Upload PDF to Firebase";
            }

            return "Complete";
        }
    }

    public string PipelineDateDisplay =>
        IsSubmitted ? SubmittedAtDisplay
        : IsApproved ? ApprovedAtDisplay
        : CertifiedAtDisplay;

    public string CertificationStatusLabel =>
        !string.IsNullOrWhiteSpace(CertificatePdfUrl)
            ? "PDF in Firebase"
            : IsCertified
                ? "Certified (no PDF)"
                : "Awaiting certify";

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
