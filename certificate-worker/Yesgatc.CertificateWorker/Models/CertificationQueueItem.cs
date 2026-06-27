namespace Yesgatc.CertificateWorker.Models;

public sealed class CertificationQueueItem
{
    public CertificationQueueItem(SiteCalibrationRecord record)
    {
        Record = record;
    }

    public SiteCalibrationRecord Record { get; }

    public string Id => Record.Id;
    public string RcCenterName => Record.RcCenterName;
    public string CustomerName => Record.CustomerName;
    public string ProductName => Record.ProductName;
    public string SerialNumber => Record.SerialNumber;
    public string VerificationTypeLabel => Record.VerificationTypeLabel;
    public string StatusLabel => Record.StatusLabel;
    public string NextStepLabel => Record.NextStepLabel;
    public string PipelineDateDisplay => Record.PipelineDateDisplay;

    public bool NeedsPipelineWork => Record.IsEligibleForWorkerQueue;

    public string RetryBadge { get; set; } = string.Empty;
}
