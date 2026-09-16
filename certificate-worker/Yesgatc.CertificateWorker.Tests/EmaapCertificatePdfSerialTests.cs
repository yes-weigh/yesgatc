using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class EmaapCertificatePdfSerialTests
{
    [Fact]
    public void Matches_compact_serial_in_pdf_text()
    {
        Assert.True(EmaapCertificatePdfSerial.TextContainsSerial(
            "Serial Number X00366 Year of Manufacture",
            "X00366"));
    }

    [Fact]
    public void Rejects_other_serial()
    {
        Assert.False(EmaapCertificatePdfSerial.TextContainsSerial(
            "Serial Number TD12843",
            "X00366"));
    }
}
