using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class GatcCertificatePdfParserTests
{
    private const string SampleCertificateText = """
        Certificate No: IND/GATC/KL/26/04/26/1313
        This is to certify that the following weighing instrument belonging to M/s-ACCURATE TRADE LINKS, Address- TC 26/640 (3) FUTURE CENTRE OOTTUKUZHY ROAD TRIVANDRUM -695001, Thiruvananthapuram,Kerala,695001, Ph:- 9847141007
        has been verified on Date of Verification: 2026-06-09
        Electronic YESWEIGH A75660 2026 III 30kg 100g 5g kg 5g 6000 7.5g
        Next verification falls due on or before: 2027-06-09
        """;

    [Fact]
    public void ParseText_extracts_sample_certificate_fields()
    {
        var result = GatcCertificatePdfParser.ParseText(SampleCertificateText);

        Assert.Equal("IND/GATC/KL/26/04/26/1313", result.CertificateNumber);
        Assert.Equal("ACCURATE TRADE LINKS", result.OwnerName);
        Assert.Contains("FUTURE CENTRE", result.OwnerAddress);
        Assert.Equal("9847141007", result.OwnerPhone);
        Assert.Equal("A75660", result.SerialNumber);
        Assert.Equal("YESWEIGH", result.ManufacturerModel);
        Assert.Equal("30kg", result.MaxCapacity);
        Assert.Equal("5g", result.VerificationScaleIntervalE);
        Assert.Equal("2026-06-09", result.VerificationDate);
        Assert.Equal("2027-06-09", result.NextVerificationDue);
        Assert.Equal("ok", result.ParseStatus);
    }
}
