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
    public string? CertificatePdfPath { get; init; }
    public string? CertificateNumber { get; init; }
    public string? SignedCertificatePdfUrl { get; init; }
    public string? SignedCertificatePdfPath { get; init; }
    public string? EmaapSignedPdfUploadedAt { get; init; }
    /// <summary>Set when eMAAP generated a cert but PDF sync failed — resume download-only.</summary>
    public string? EmaapIssuedCertificateNumber { get; init; }
    public string? PipelineFailedPhase { get; init; }
    public string? PipelineFailureMessage { get; init; }
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

    public bool IsRejected =>
        string.Equals(Status, VerificationStatuses.Rejected, StringComparison.OrdinalIgnoreCase);

    public bool IsFailedAtSubmit =>
        IsSubmitted
        && string.Equals(PipelineFailedPhase, "submit", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Failed-at-submit blocks the queue unless PDF-only resume is possible
    /// (pending eMAAP cert number, or submit already succeeded).
    /// </summary>
    public bool HasBlockingSubmitFailure =>
        IsFailedAtSubmit
        && string.IsNullOrWhiteSpace(EmaapIssuedCertificateNumber)
        && (PipelineFailureMessage is null
            || PipelineFailureMessage.IndexOf("submit succeeded", StringComparison.OrdinalIgnoreCase) < 0);

    /// <summary>Submitted jobs only (OV + RV). eMAAP fill → certify → PDF in one pass.</summary>
    public bool IsEligibleForWorkerQueue =>
        NeedsPipelineWork && !IsSuperseded && !IsVoided && !HasBlockingSubmitFailure;

    public bool IsDraft => string.Equals(Status, VerificationStatuses.Draft, StringComparison.OrdinalIgnoreCase);
    public bool IsSubmitted => string.Equals(Status, VerificationStatuses.Submitted, StringComparison.OrdinalIgnoreCase);
    public bool IsApproved => string.Equals(Status, VerificationStatuses.Approved, StringComparison.OrdinalIgnoreCase);
    public bool IsCertified => string.Equals(Status, VerificationStatuses.Certified, StringComparison.OrdinalIgnoreCase);
    public bool HasCertificate => IsCertified || !string.IsNullOrWhiteSpace(CertificatePdfUrl);

    public const int LegacySignedSequenceMax = 2304;

    public static int? ParseCertificateSequence(string? certificateNumber)
    {
        var tail = (certificateNumber ?? "").Trim().Split('/').LastOrDefault() ?? "";
        return int.TryParse(tail, out var sequence) && sequence > 0 ? sequence : null;
    }

    public bool IsAfterLegacySequence =>
        ParseCertificateSequence(CertificateNumber) is int sequence && sequence > LegacySignedSequenceMax;

    /// <summary>Certified, seq &gt; 2304, signed PDF in Firebase, not yet pushed to eMAAP.</summary>
    public bool IsEligibleForSignedPdfUpload =>
        IsCertified
        && !IsSuperseded
        && !IsVoided
        && IsAfterLegacySequence
        && !string.IsNullOrWhiteSpace(SignedCertificatePdfUrl)
        && string.IsNullOrWhiteSpace(EmaapSignedPdfUploadedAt);

    /// <summary>Single production stage: Submitted → eMAAP fill+certify → PDF → Firebase certified.</summary>
    public bool NeedsPipelineWork => IsSubmitted;

    public string NextStepLabel =>
        IsSubmitted
            ? "eMAAP · Fill & certify"
            : IsEligibleForSignedPdfUpload
                ? "eMAAP · Upload signed PDF"
                : "Complete";

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
