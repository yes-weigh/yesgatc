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

    [Fact]
    public void FileContainsSerial_missing_file_is_false()
    {
        Assert.False(EmaapCertificatePdfSerial.FileContainsSerial(
            @"C:\missing-yesgatc-certificate.pdf",
            "YJ01414"));
    }

    [Fact]
    public void FileContainsSerial_unreadable_is_not_fail_open()
    {
        var path = Path.Combine(Path.GetTempPath(), $"yesgatc-not-a-pdf-{Guid.NewGuid():N}.pdf");
        File.WriteAllText(path, "not a pdf");
        try
        {
            Assert.False(EmaapCertificatePdfSerial.FileContainsSerial(path, "YJ01414"));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void FileContainsSerial_local_4006_pdf_if_present()
    {
        var path = Path.Combine(
            Path.GetTempPath(),
            "yesgatc-certs-4006",
            "IND-GATC-KL-26-04-26-4006.pdf");
        if (!File.Exists(path))
        {
            return;
        }

        Assert.True(EmaapCertificatePdfSerial.FileContainsSerial(path, "YJ01414"));
        Assert.False(EmaapCertificatePdfSerial.FileContainsSerial(path, "YJ01418"));
        Assert.False(EmaapCertificatePdfSerial.FileContainsSerial(path, "Y10337"));
    }
}
