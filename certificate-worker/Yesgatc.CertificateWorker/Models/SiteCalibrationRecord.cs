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
    public string? SupersededByResubmissionId { get; init; }
    public string? CertificateVoidedAt { get; init; }
    public string? SealIdentificationNumber { get; init; }

    public bool IsSuperseded => !string.IsNullOrWhiteSpace(SupersededByResubmissionId);
    public bool IsVoided => !string.IsNullOrWhiteSpace(CertificateVoidedAt);

    public bool IsRv =>
        string.Equals(VerificationType, "RV", StringComparison.OrdinalIgnoreCase);

    public bool IsOv =>
        string.Equals(VerificationType, "OV", StringComparison.OrdinalIgnoreCase);

    /// <summary>Submitted jobs only (OV + RV). eMAAP fill → certify → PDF in one pass.</summary>
    public bool IsEligibleForWorkerQueue =>
        NeedsPipelineWork && !IsSuperseded && !IsVoided;

    public bool IsDraft => string.Equals(Status, VerificationStatuses.Draft, StringComparison.OrdinalIgnoreCase);
    public bool IsSubmitted => string.Equals(Status, VerificationStatuses.Submitted, StringComparison.OrdinalIgnoreCase);
    public bool IsApproved => string.Equals(Status, VerificationStatuses.Approved, StringComparison.OrdinalIgnoreCase);
    public bool IsCertified => string.Equals(Status, VerificationStatuses.Certified, StringComparison.OrdinalIgnoreCase);
    public bool HasCertificate => IsCertified || !string.IsNullOrWhiteSpace(CertificatePdfUrl);

    /// <summary>Single production stage: Submitted → eMAAP fill+certify → PDF → Firebase certified.</summary>
    public bool NeedsPipelineWork => IsSubmitted;

    public string NextStepLabel => IsSubmitted ? "eMAAP · Fill & certify" : "Complete";

    public string PipelineDateDisplay =>
        IsSubmitted ? SubmittedAtDisplay
        : IsApproved ? ApprovedAtDisplay
        : CertifiedAtDisplay;

    public string CertificationStatusLabel =>
        !string.IsNullOrWhiteSpace(CertificatePdfUrl)
            ? "PDF in Firebase"
            : IsCertified
                ? "Certified (no PDF)"
                : IsSubmitted
                    ? "Awaiting eMAAP"
                    : "—";

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
