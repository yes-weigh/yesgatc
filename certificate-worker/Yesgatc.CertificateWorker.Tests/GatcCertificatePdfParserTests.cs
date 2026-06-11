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

    private const string Interweighing993CertificateText = """
        Certificate No: IND/GATC/KL/26/04/26/993 Date of Verification: 01-06-2026
        I hereby certify that I have this day verified and stamped/rejected the under mentioned Non-automatic weighing instruments of Accuracy Class III (upto
        150kg),etc. belonging to M/s-INTERWEIGHING PVT LTD,Address-49/470 D1 3RD FLOOR,ASIAN TOWER,VYTTILA,COCHIN,KERALA-682019,
        Ernakulam,Kerala,682019, Ph:- 8590601636
        Type of Instrument Manufacturer / Model / Brand / Series Designation Serial Number Year of Manufacture Accuracy Class (III) Maximum Capacity (Max upto 150 kg) Minimum Capacity (Min) Verification Scale Interval (e) Unit of Measurement:kg Actual Scale Interval (d) No. of Verification Intervals (n = Max / e) Maximum Permissible Error (MPE)
        Electronic YESWEIGH Y09591 2026 III 50kg 100g 5g kg 5g 10000 7.5g
        Visual Examination Zero Setting / Zero Tracking Test
        Supply Voltage (if electronic) Verification Seal Affixed Pass Pass Pass Pass Pass Pass Pass 28.3 79 230 V AC Yes IND/KL/26/ 04/B26 Nill
        Next verification falls due on or before: 2027-05-31
        Model Approval No(s) - IND/09/25/468
        """;

    private const string InterweighingCertificateText = """
        Certificate No: IND/GATC/KL/26/04/26/883 Date of Verification: 31-05-2026
        I hereby certify that I have this day verified and stamped/rejected the under mentioned Non-automatic weighing instruments of Accuracy Class III (upto
        150kg),etc. belonging to M/s-INTERWEIGHING PVT LTD,Address-49/470 D1 3RD FLOOR,ASIAN TOWER,VYTTILA,COCHIN,KERALA-682019,
        Ernakulam,Kerala,682019, Ph:- 8590601636
        Type of Instrument Manufacturer / Model / Brand / Series Designation Serial Number Year of Manufacture Accuracy Class (III) Maximum Capacity (Max upto 150 kg) Minimum Capacity (Min) Verification Scale Interval (e) Unit of Measurement:kg Actual Scale Interval (d) No. of Verification Intervals (n = Max / e) Maximum Permissible Error (MPE)
        Electronic YESWEIGH Y09724 2026 III 20kg 40g 2g kg 2g 10000 3g
        Visual Examination Zero Setting / Zero Tracking Test
        Next verification falls due on or before: 2027-05-30
        Model Approval No(s) - IND/09/20/23
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

    [Fact]
    public void ParseText_extracts_interweighing_993_with_supply_voltage_if_electronic()
    {
        var result = GatcCertificatePdfParser.ParseText(Interweighing993CertificateText);

        Assert.Equal("IND/GATC/KL/26/04/26/993", result.CertificateNumber);
        Assert.Equal("Y09591", result.SerialNumber);
        Assert.Equal("YESWEIGH", result.ManufacturerModel);
        Assert.Equal("50kg", result.MaxCapacity);
        Assert.Equal("5g", result.VerificationScaleIntervalE);
        Assert.Equal("2026-06-01", result.VerificationDate);
        Assert.Equal("ok", result.ParseStatus);
    }

    [Fact]
    public void ParseText_extracts_instrument_row_when_mpe_is_split_before_visual()
    {
        const string text = """
            Certificate No: IND/GATC/KL/26/04/26/993 Date of Verification: 01-06-2026
            belonging to M/s-INTERWEIGHING PVT LTD,Address-49/470 D1 3RD FLOOR,ASIAN TOWER,VYTTILA,COCHIN,KERALA-682019,
            Ernakulam,Kerala,682019, Ph:- 8590601636
            Maximum Permissible Error (MPE) Electronic YESWEIGH Y09591 2026 III 50kg 100g 5g kg 5g 10000 7.5 g Visual Examination
            """;

        var result = GatcCertificatePdfParser.ParseText(text);

        Assert.Equal("Y09591", result.SerialNumber);
        Assert.Equal("50kg", result.MaxCapacity);
        Assert.Equal("5g", result.VerificationScaleIntervalE);
        Assert.Equal("7.5g", result.MaximumPermissibleError);
        Assert.Equal("ok", result.ParseStatus);
    }

    [Fact]
    public void ParseText_extracts_instrument_row_without_electronic_prefix()
    {
        const string text = """
            Certificate No: IND/GATC/KL/26/04/26/993 Date of Verification: 01-06-2026
            belonging to M/s-INTERWEIGHING PVT LTD,Address-49/470 D1 3RD FLOOR,ASIAN TOWER,VYTTILA,COCHIN,KERALA-682019,
            Ernakulam,Kerala,682019, Ph:- 8590601636
            YESWEIGH Y09591 2026 III 50kg 100g 5g kg 5g 10000 7.5g Visual Examination
            """;

        var result = GatcCertificatePdfParser.ParseText(text);

        Assert.Equal("YESWEIGH", result.ManufacturerModel);
        Assert.Equal("Y09591", result.SerialNumber);
        Assert.Equal("50kg", result.MaxCapacity);
        Assert.Equal("5g", result.VerificationScaleIntervalE);
        Assert.Equal("ok", result.ParseStatus);
    }

    [Fact]
    public void ParseText_extracts_interweighing_certificate_with_dd_mm_yyyy_dates()
    {
        var result = GatcCertificatePdfParser.ParseText(InterweighingCertificateText);

        Assert.Equal("IND/GATC/KL/26/04/26/883", result.CertificateNumber);
        Assert.Equal("INTERWEIGHING PVT LTD", result.OwnerName);
        Assert.Contains("ASIAN TOWER", result.OwnerAddress);
        Assert.Equal("8590601636", result.OwnerPhone);
        Assert.Equal("Y09724", result.SerialNumber);
        Assert.Equal("YESWEIGH", result.ManufacturerModel);
        Assert.Equal("20kg", result.MaxCapacity);
        Assert.Equal("2g", result.VerificationScaleIntervalE);
        Assert.Equal("2026-05-31", result.VerificationDate);
        Assert.Equal("2027-05-30", result.NextVerificationDue);
        Assert.Equal("ok", result.ParseStatus);
    }
}
