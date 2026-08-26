using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class WorkerQueueStagePickerTests
{
    [Fact]
    public void Next_fill_first_when_all_wait_and_no_last_emaap()
    {
        var stage = WorkerQueueStagePicker.Next(
            processFill: true,
            processSigner: true,
            processSigned: true,
            fillEligibleCount: 2,
            signerEligibleCount: 4,
            signedEligibleCount: 3);

        Assert.Equal(WorkerQueueStage.FillCertify, stage);
    }

    [Fact]
    public void NextEmaap_after_fill_prefers_signed_even_if_fill_still_waits()
    {
        var stage = WorkerQueueStagePicker.NextEmaap(
            processFill: true,
            processSigned: true,
            fillEligibleCount: 5,
            signedEligibleCount: 1,
            lastEmaapStage: WorkerQueueStage.FillCertify);

        Assert.Equal(WorkerQueueStage.SignedEmaapUpload, stage);
    }

    [Fact]
    public void NextEmaap_after_signed_allows_fill_again()
    {
        var stage = WorkerQueueStagePicker.NextEmaap(
            processFill: true,
            processSigned: true,
            fillEligibleCount: 2,
            signedEligibleCount: 4,
            lastEmaapStage: WorkerQueueStage.SignedEmaapUpload);

        Assert.Equal(WorkerQueueStage.FillCertify, stage);
    }

    [Fact]
    public void Next_signed_before_signer_when_fill_off()
    {
        var stage = WorkerQueueStagePicker.Next(
            processFill: false,
            processSigner: true,
            processSigned: true,
            fillEligibleCount: 5,
            signerEligibleCount: 9,
            signedEligibleCount: 1);

        Assert.Equal(WorkerQueueStage.SignedEmaapUpload, stage);
    }

    [Fact]
    public void Next_signer_when_no_emaap_work()
    {
        var stage = WorkerQueueStagePicker.Next(
            processFill: true,
            processSigner: true,
            processSigned: true,
            fillEligibleCount: 0,
            signerEligibleCount: 12,
            signedEligibleCount: 0,
            lastEmaapStage: WorkerQueueStage.FillCertify);

        Assert.Equal(WorkerQueueStage.PdfSigner, stage);
    }

    [Fact]
    public void Next_skips_fill_when_switch_off()
    {
        var stage = WorkerQueueStagePicker.Next(
            processFill: false,
            processSigner: true,
            processSigned: false,
            fillEligibleCount: 5,
            signerEligibleCount: 1,
            signedEligibleCount: 2);

        Assert.Equal(WorkerQueueStage.PdfSigner, stage);
    }

    [Fact]
    public void Next_signed_when_earlier_switches_off()
    {
        var stage = WorkerQueueStagePicker.Next(
            processFill: false,
            processSigner: false,
            processSigned: true,
            fillEligibleCount: 9,
            signerEligibleCount: 9,
            signedEligibleCount: 1);

        Assert.Equal(WorkerQueueStage.SignedEmaapUpload, stage);
    }

    [Fact]
    public void Next_skips_empty_on_queues()
    {
        var stage = WorkerQueueStagePicker.Next(
            processFill: true,
            processSigner: true,
            processSigned: true,
            fillEligibleCount: 0,
            signerEligibleCount: 0,
            signedEligibleCount: 2);

        Assert.Equal(WorkerQueueStage.SignedEmaapUpload, stage);
    }

    [Fact]
    public void Next_null_when_all_switches_off()
    {
        var stage = WorkerQueueStagePicker.Next(
            processFill: false,
            processSigner: false,
            processSigned: false,
            fillEligibleCount: 3,
            signerEligibleCount: 3,
            signedEligibleCount: 3);

        Assert.Null(stage);
    }

    [Fact]
    public void Next_null_when_on_queues_empty()
    {
        var stage = WorkerQueueStagePicker.Next(
            processFill: true,
            processSigner: true,
            processSigned: true,
            fillEligibleCount: 0,
            signerEligibleCount: 0,
            signedEligibleCount: 0);

        Assert.Null(stage);
    }
}

public sealed class PdfStampPrecheckTests
{
    [Fact]
    public void Precheck_skips_existing_signed_pdf()
    {
        var skip = PdfImageStampService.Precheck(
            voided: false,
            superseded: false,
            alreadySigned: true,
            isPdfSignerRc: true);

        Assert.Equal(PdfStampOutcome.SkippedAlreadySigned, skip);
    }

    [Fact]
    public void Precheck_skips_non_pdf_signer_rc()
    {
        var skip = PdfImageStampService.Precheck(
            voided: false,
            superseded: false,
            alreadySigned: false,
            isPdfSignerRc: false);

        Assert.Equal(PdfStampOutcome.SkippedNotPdfSigner, skip);
    }

    [Fact]
    public void Precheck_skips_voided()
    {
        var skip = PdfImageStampService.Precheck(
            voided: true,
            superseded: false,
            alreadySigned: false,
            isPdfSignerRc: true);

        Assert.Equal(PdfStampOutcome.SkippedDead, skip);
    }

    [Fact]
    public void Precheck_null_when_ready_to_stamp()
    {
        Assert.Null(PdfImageStampService.Precheck(
            voided: false,
            superseded: false,
            alreadySigned: false,
            isPdfSignerRc: true));
    }
}
