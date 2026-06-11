using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public static class GatcCertificatePdfParser
{
    private static readonly Regex OwnerBlockRegex = new(
        @"belonging to\s+M/s-([^,]+?)\s*,\s*Address[-:\s]*(.+?)\s*,\s*Ph:?[-\s]*([\d\s]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex CertificateNumberRegex = new(
        @"Certificate No\.?\s*:?\s*(IND/GATC/[^\s]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex VerificationDateRegex = new(
        @"Date of Verification\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex NextVerificationRegex = new(
        @"Next verification falls due on or before\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex InstrumentRowRegex = new(
        @"\b(Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z0-9-]+)\s+(20\d{2})\s+(I{1,3}|IV)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex InstrumentRowBeforeVisualRegex = new(
        @"(?:MPE\)|Maximum Permissible Error \(MPE\))\s+(Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z0-9-]+)\s+(20\d{2})\s+(I{1,3}|IV)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)(?=\s+Visual\b)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex ModelApprovalRegex = new(
        @"Model Approval No\.?\s*:?\s*([^\r\n]+?)(?=\s*(?:Seal|Certificate|Date of|Verification Fee|$))",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex SealIdentificationRegex = new(
        @"Seal Identification No\.?\s*:?\s*([^\r\n]+?)(?=\s*(?:Certificate|Date of|Next verification|Model Approval|$))",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static GatcCertificatePdfExtract Parse(byte[] pdfBytes)
    {
        if (pdfBytes.Length == 0)
        {
            return Failed("PDF file is empty.");
        }

        try
        {
            using var document = PdfDocument.Open(pdfBytes);
            var text = ExtractText(document);
            return ParseText(text);
        }
        catch (Exception ex)
        {
            return Failed(ex.Message);
        }
    }

    internal static GatcCertificatePdfExtract ParseText(string rawText)
    {
        var text = NormalizeText(rawText);
        if (string.IsNullOrWhiteSpace(text))
        {
            return Failed("PDF contains no extractable text.");
        }

        var extract = new GatcCertificatePdfExtract
        {
            ParsedAt = DateTimeOffset.UtcNow.ToString("O"),
            ParserVersionValue = GatcCertificatePdfExtract.ParserVersion,
        };

        var ownerMatch = OwnerBlockRegex.Match(text);
        if (ownerMatch.Success)
        {
            extract = extract with
            {
                OwnerName = CleanValue(ownerMatch.Groups[1].Value),
                OwnerAddress = CleanValue(ownerMatch.Groups[2].Value),
                OwnerPhone = CleanPhone(ownerMatch.Groups[3].Value),
            };
        }

        var certMatch = CertificateNumberRegex.Match(text);
        if (certMatch.Success)
        {
            extract = extract with { CertificateNumber = CleanValue(certMatch.Groups[1].Value) };
        }

        var verificationMatch = VerificationDateRegex.Match(text);
        if (verificationMatch.Success)
        {
            extract = extract with { VerificationDate = NormalizeDate(verificationMatch.Groups[1].Value) };
        }

        var nextDueMatch = NextVerificationRegex.Match(text);
        if (nextDueMatch.Success)
        {
            extract = extract with { NextVerificationDue = NormalizeDate(nextDueMatch.Groups[1].Value) };
        }

        if (TryParseInstrumentRow(text, out var instrument))
        {
            extract = extract with
            {
                InstrumentType = instrument.InstrumentType,
                ManufacturerModel = instrument.ManufacturerModel,
                SerialNumber = instrument.SerialNumber,
                YearOfManufacture = instrument.YearOfManufacture,
                AccuracyClass = instrument.AccuracyClass,
                MaxCapacity = instrument.MaxCapacity,
                MinCapacity = instrument.MinCapacity,
                VerificationScaleIntervalE = instrument.VerificationScaleIntervalE,
                UnitOfMeasurement = instrument.UnitOfMeasurement,
                ActualScaleIntervalD = instrument.ActualScaleIntervalD,
                VerificationIntervalsN = instrument.VerificationIntervalsN,
                MaximumPermissibleError = instrument.MaximumPermissibleError,
            };
        }

        var modelApprovalMatch = ModelApprovalRegex.Match(text);
        if (modelApprovalMatch.Success)
        {
            extract = extract with { ModelApprovalNos = CleanValue(modelApprovalMatch.Groups[1].Value) };
        }

        var sealMatch = SealIdentificationRegex.Match(text);
        if (sealMatch.Success)
        {
            extract = extract with { SealIdentificationNos = CleanValue(sealMatch.Groups[1].Value) };
        }

        var status = DetermineStatus(extract);
        return extract with
        {
            ParseStatus = status.Status,
            ParseError = status.Error,
        };
    }

    private static bool TryParseInstrumentRow(string text, out InstrumentRowFields fields)
    {
        foreach (var regex in new[] { InstrumentRowBeforeVisualRegex, InstrumentRowRegex })
        {
            var match = regex.Match(text);
            if (!match.Success)
            {
                continue;
            }

            fields = new InstrumentRowFields
            {
                InstrumentType = CleanValue(match.Groups[1].Value),
                ManufacturerModel = CleanValue(match.Groups[2].Value),
                SerialNumber = CleanValue(match.Groups[3].Value),
                YearOfManufacture = match.Groups[4].Value,
                AccuracyClass = match.Groups[5].Value,
                MaxCapacity = CleanValue(match.Groups[6].Value),
                MinCapacity = CleanValue(match.Groups[7].Value),
                VerificationScaleIntervalE = CleanValue(match.Groups[8].Value),
                UnitOfMeasurement = CleanValue(match.Groups[9].Value),
                ActualScaleIntervalD = CleanValue(match.Groups[10].Value),
                VerificationIntervalsN = match.Groups[11].Value,
                MaximumPermissibleError = CleanValue(match.Groups[12].Value),
            };
            return true;
        }

        fields = new InstrumentRowFields();
        return false;
    }

    private sealed class InstrumentRowFields
    {
        public string InstrumentType { get; init; } = string.Empty;
        public string ManufacturerModel { get; init; } = string.Empty;
        public string SerialNumber { get; init; } = string.Empty;
        public string YearOfManufacture { get; init; } = string.Empty;
        public string AccuracyClass { get; init; } = string.Empty;
        public string MaxCapacity { get; init; } = string.Empty;
        public string MinCapacity { get; init; } = string.Empty;
        public string VerificationScaleIntervalE { get; init; } = string.Empty;
        public string UnitOfMeasurement { get; init; } = string.Empty;
        public string ActualScaleIntervalD { get; init; } = string.Empty;
        public string VerificationIntervalsN { get; init; } = string.Empty;
        public string MaximumPermissibleError { get; init; } = string.Empty;
    }

    private static string ExtractText(PdfDocument document)
    {
        var builder = new StringBuilder();
        foreach (var page in document.GetPages())
        {
            builder.AppendLine(page.Text);
        }

        return builder.ToString();
    }

    private static string NormalizeText(string text) =>
        Regex.Replace(
            Regex.Replace(text.Replace('\u00a0', ' '), @"[\r\n\t]+", " ")
                .Replace("Permissibl e", "Permissible", StringComparison.OrdinalIgnoreCase),
            @"\s+",
            " ").Trim();

    private static string CleanValue(string value) =>
        Regex.Replace(value.Trim(), @"\s+", " ");

    private static string CleanPhone(string value) =>
        Regex.Replace(value, @"[^\d]", string.Empty).Trim();

    private static string NormalizeDate(string value)
    {
        var trimmed = value.Trim();
        if (DateTime.TryParseExact(trimmed, "dd-MM-yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dmy))
        {
            return dmy.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        if (DateTime.TryParseExact(trimmed, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var ymd))
        {
            return ymd.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        return trimmed;
    }

    private static (string Status, string Error) DetermineStatus(GatcCertificatePdfExtract extract)
    {
        var hasSerial = !string.IsNullOrWhiteSpace(extract.SerialNumber);
        var hasCapacity = !string.IsNullOrWhiteSpace(extract.MaxCapacity);
        var hasOwner = !string.IsNullOrWhiteSpace(extract.OwnerName) || !string.IsNullOrWhiteSpace(extract.OwnerAddress);
        var hasInterval = !string.IsNullOrWhiteSpace(extract.VerificationScaleIntervalE);

        if (hasSerial && hasCapacity && hasInterval)
        {
            return ("ok", string.Empty);
        }

        if (hasSerial || hasCapacity || hasOwner || !string.IsNullOrWhiteSpace(extract.CertificateNumber))
        {
            return ("partial", string.Empty);
        }

        return ("failed", "Could not locate instrument or owner details in the PDF text.");
    }

    private static GatcCertificatePdfExtract Failed(string error) =>
        new()
        {
            ParseStatus = "failed",
            ParseError = error,
            ParsedAt = DateTimeOffset.UtcNow.ToString("O"),
            ParserVersionValue = GatcCertificatePdfExtract.ParserVersion,
        };
}
