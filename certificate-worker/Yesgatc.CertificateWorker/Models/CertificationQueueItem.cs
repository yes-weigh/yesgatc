using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace Yesgatc.CertificateWorker.Models;

public sealed class CertificationQueueItem : INotifyPropertyChanged
{
    private string _retryBadge = string.Empty;

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
    public string CertificateNumber => Record.CertificateNumber?.Trim() is { Length: > 0 } number
        ? number
        : "—";
    public string TypeShort =>
        Record.IsRv ? "RV" : Record.IsOv ? "OV" : string.IsNullOrWhiteSpace(Record.VerificationType) ? "—" : Record.VerificationType;
    public string StatusLabel => Record.StatusLabel;
    public string NextStepLabel => Record.NextStepLabel;
    public string PipelineDateDisplay => Record.PipelineDateDisplay;

    public bool NeedsPipelineWork => Record.IsEligibleForWorkerQueue;

    public string RetryBadge
    {
        get => _retryBadge;
        set
        {
            if (string.Equals(_retryBadge, value, StringComparison.Ordinal))
            {
                return;
            }

            _retryBadge = value;
            OnPropertyChanged();
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
