namespace Yesgatc.CertificateWorker.Services;

internal enum WorkerQueueStage
{
    FillCertify,
    PdfSigner,
    SignedEmaapUpload,
}

/// <summary>
/// One job (or a short stamp burst), then re-pick.
/// Fill vs signed-upload: never two fills in a row while signed PDFs wait.
/// After any eMAAP job the auto-worker stamps a burst, then picks again.
/// </summary>
internal static class WorkerQueueStagePicker
{
    public const int StampBurstMax = 8;

    public static WorkerQueueStage? NextEmaap(
        bool processFill,
        bool processSigned,
        int fillEligibleCount,
        int signedEligibleCount,
        WorkerQueueStage? lastEmaapStage)
    {
        if (processSigned
            && signedEligibleCount > 0
            && lastEmaapStage == WorkerQueueStage.FillCertify)
        {
            return WorkerQueueStage.SignedEmaapUpload;
        }

        if (processFill && fillEligibleCount > 0)
        {
            return WorkerQueueStage.FillCertify;
        }

        if (processSigned && signedEligibleCount > 0)
        {
            return WorkerQueueStage.SignedEmaapUpload;
        }

        return null;
    }

    public static WorkerQueueStage? Next(
        bool processFill,
        bool processSigner,
        bool processSigned,
        int fillEligibleCount,
        int signerEligibleCount,
        int signedEligibleCount,
        WorkerQueueStage? lastEmaapStage = null)
    {
        var emaap = NextEmaap(
            processFill,
            processSigned,
            fillEligibleCount,
            signedEligibleCount,
            lastEmaapStage);
        if (emaap is not null)
        {
            return emaap;
        }

        if (processSigner && signerEligibleCount > 0)
        {
            return WorkerQueueStage.PdfSigner;
        }

        return null;
    }
}
