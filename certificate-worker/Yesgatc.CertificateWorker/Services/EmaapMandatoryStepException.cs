namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Thrown when eMAAP submit/generate succeeded but a mandatory follow-up failed
/// (PDF download or Firebase mark-certified). Callers must halt the batch.
/// </summary>
public sealed class EmaapMandatoryStepException : InvalidOperationException
{
    public EmaapMandatoryStepException(string message)
        : base(message)
    {
    }

    public EmaapMandatoryStepException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
