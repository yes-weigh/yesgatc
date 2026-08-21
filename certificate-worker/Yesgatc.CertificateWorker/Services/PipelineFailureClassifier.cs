namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Classifies eMAAP worker errors for Firebase status updates.
/// Permanent → status=rejected. Recoverable exhausted → pipelineFailedPhase=submit.
/// </summary>
public static class PipelineFailureClassifier
{
    public enum Outcome
    {
        /// <summary>Keep retrying — do not patch Firebase failure fields yet.</summary>
        Retry,

        /// <summary>status stays submitted; pipelineFailedPhase=submit (Failed at submit).</summary>
        FailedSubmit,

        /// <summary>Reopen as draft so RC/VCT can fix and resubmit.</summary>
        Rejected,
    }

    public static Outcome Classify(string? error, bool retryExhausted)
    {
        var message = error ?? string.Empty;
        if (IsPermanentDataFailure(message))
        {
            return Outcome.Rejected;
        }

        // PDF HALT / resume path — mark failed_submit so UI shows it, but keep pending cert.
        if (message.Contains("HALT", StringComparison.OrdinalIgnoreCase))
        {
            return Outcome.FailedSubmit;
        }

        return retryExhausted ? Outcome.FailedSubmit : Outcome.Retry;
    }

    public static bool IsPermanentDataFailure(string? error)
    {
        var message = error ?? string.Empty;
        if (string.IsNullOrWhiteSpace(message))
        {
            return false;
        }

        // Login / browser / OTP — never permanent.
        if (message.Contains("login", StringComparison.OrdinalIgnoreCase)
            || message.Contains("OTP", StringComparison.OrdinalIgnoreCase)
            || message.Contains("captcha", StringComparison.OrdinalIgnoreCase)
            || message.Contains("browser disconnected", StringComparison.OrdinalIgnoreCase)
            || message.Contains("browser was closed", StringComparison.OrdinalIgnoreCase)
            || message.Contains("Timeout", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        string[] needles =
        [
            "Serial number plate photo is required",
            "Standard weight photo is missing",
            "productId",
            "product ",
            " not found",
            "customerId",
            "party name",
            "party address",
            "party pincode",
            "zohoInvoice",
            "manufacturingYear",
            "RC id is missing",
            "maximumCapacity",
            "verificationScaleInterval",
            "modelApprovalNo",
            "manufacturerBrandSeries",
            "minimumCapacity",
            "already exists",
            "duplicate",
            "Record already",
        ];

        return needles.Any(n => message.Contains(n, StringComparison.OrdinalIgnoreCase));
    }
}
