using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class PipelineFailureClassifierTests
{
    [Theory]
    [InlineData("Serial number plate photo is required")]
    [InlineData("productId ABC not found")]
    [InlineData("party name is empty")]
    [InlineData("zohoInvoiceNumber missing")]
    [InlineData("Record already exists for serial")]
    [InlineData("eMAAP rejected submit: Serial number already exist")]
    [InlineData("eMAAP did not issue a new certificate for serial X00366")]
    public void Permanent_data_errors_reject(string error)
    {
        Assert.True(PipelineFailureClassifier.IsPermanentDataFailure(error));
        Assert.Equal(
            PipelineFailureClassifier.Outcome.Rejected,
            PipelineFailureClassifier.Classify(error, retryExhausted: false));
    }

    [Theory]
    [InlineData("eMAAP login required")]
    [InlineData("OTP code needed")]
    [InlineData("captcha failed")]
    [InlineData("browser disconnected")]
    [InlineData("Timeout waiting for page")]
    [InlineData("Could not download serial number plate photo (503).")]
    public void Transient_errors_never_permanent(string error)
    {
        Assert.False(PipelineFailureClassifier.IsPermanentDataFailure(error));
        Assert.Equal(
            PipelineFailureClassifier.Outcome.Retry,
            PipelineFailureClassifier.Classify(error, retryExhausted: false));
    }

    [Fact]
    public void Halt_marks_failed_submit_immediately()
    {
        var outcome = PipelineFailureClassifier.Classify(
            "HALT: PDF download failed for IND/GATC/KL/26/04/26/2338",
            retryExhausted: false);
        Assert.Equal(PipelineFailureClassifier.Outcome.FailedSubmit, outcome);
    }

    [Fact]
    public void Exhausted_recoverable_marks_failed_submit()
    {
        var outcome = PipelineFailureClassifier.Classify(
            "Could not click Submit on eMAAP form",
            retryExhausted: true);
        Assert.Equal(PipelineFailureClassifier.Outcome.FailedSubmit, outcome);
    }
}
