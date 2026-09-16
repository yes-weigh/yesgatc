using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class EmaapSubmitDialogTests
{
    [Fact]
    public void Success_is_record_saved_only()
    {
        Assert.True(EmaapSubmitDialog.IsSuccess("Record saved successfully\nOK"));
        Assert.False(EmaapSubmitDialog.IsFailure("Record saved successfully\nOK"));
    }

    [Fact]
    public void Confirm_button_alone_is_not_success()
    {
        Assert.False(EmaapSubmitDialog.IsSuccess("OK"));
        Assert.False(EmaapSubmitDialog.IsFailure("OK"));
    }

    [Theory]
    [InlineData("Serial number already exists")]
    [InlineData("Record already exist for this instrument")]
    [InlineData("Duplicate serial number X00366")]
    [InlineData("Something went wrong")]
    public void Other_alerts_are_failures(string text)
    {
        Assert.False(EmaapSubmitDialog.IsSuccess(text));
        Assert.True(EmaapSubmitDialog.IsFailure(text));
    }
}
