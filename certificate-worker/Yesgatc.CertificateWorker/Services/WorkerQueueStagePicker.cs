namespace Yesgatc.CertificateWorker.Services;

internal enum WorkerQueueStage
{
    FillCertify,
    PdfSigner,
    SignedEmaapUpload,
}

/// <summary>
/// One Chrome for eMAAP. Auto-run drains signed uploads (short, last-mile), then a fill
/// streak, then drain again. Stamp bursts run after each eMAAP batch (local, no portal).
/// </summary>
internal static class WorkerQueueStagePicker
{
    public const int StampBurstMax = 8;
    public const int FillStreakMax = 5;
    public const int SignedDrainMax = 5;

    public static int EmaapBatchMaxJobs(WorkerQueueStage stage) =>
        stage == WorkerQueueStage.FillCertify ? FillStreakMax : SignedDrainMax;

    /// <summary>
    /// Signed drain whenever uploads are waiting, except immediately after a drain
    /// (then fill streak). Startup with both queues waiting drains signed first.
    /// </summary>
    public static WorkerQueueStage? NextEmaap(
        bool processFill,
        bool processSigned,
        int fillEligibleCount,
        int signedEligibleCount,
        WorkerQueueStage? lastEmaapStage)
    {
        var signedWaiting = processSigned && signedEligibleCount > 0;
        var fillWaiting = processFill && fillEligibleCount > 0;

        if (signedWaiting && lastEmaapStage != WorkerQueueStage.SignedEmaapUpload)
        {
            return WorkerQueueStage.SignedEmaapUpload;
        }

        if (fillWaiting)
        {
            return WorkerQueueStage.FillCertify;
        }

        if (signedWaiting)
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
