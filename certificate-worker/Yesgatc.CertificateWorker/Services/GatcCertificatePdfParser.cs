using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
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
        @"(?<!\bif\s)(?<![(\-])(Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z0-9-]+)\s+(20\d{2})\s+(I{1,3}|IV)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+\.?\d*\s*[a-zA-Z]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex InstrumentRowBeforeVisualRegex = new(
        @"(?:MPE\)|Maximum Permissible Error \(MPE\))\s+(?<!\bif\s)(Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z0-9-]+)\s+(20\d{2})\s+(I{1,3}|IV)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+\.?\d*\s*g)(?=\s+Visual\b)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>When PdfPig omits the instrument-type prefix or splits MPE (e.g. "7.5 g").</summary>
    private static readonly Regex InstrumentModelSerialRegex = new(
        @"(?<![\w(/])([A-Z][A-Z0-9]{2,})\s+([A-Z][A-Z0-9-]{3,})\s+(20\d{2})\s+(I{1,3}|IV)\s+(\d+\.?\d*\s*kg)\s+(\S+)\s+(\d+\.?\d*\s*g)\s+kg\s+(\S+)\s+(\d+)\s+(\d+\.?\d*)\s*g(?=\s+Visual\b)",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

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

        if (TryParseInstrumentRow(text, out var instrument)
            || TryParseInstrumentColumnLayout(rawText, out instrument)
            || TryParseInstrumentScattered(text, out instrument))
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
            foreach (Match match in regex.Matches(text))
            {
                if (TryBuildInstrumentRowFromTypedMatch(match, out fields) && IsPlausibleInstrumentRow(fields))
                {
                    return true;
                }
            }
        }

        foreach (Match match in InstrumentModelSerialRegex.Matches(text))
        {
            fields = new InstrumentRowFields
            {
                InstrumentType = "Electronic",
                ManufacturerModel = CleanValue(match.Groups[1].Value),
                SerialNumber = CleanValue(match.Groups[2].Value),
                YearOfManufacture = match.Groups[3].Value,
                AccuracyClass = match.Groups[4].Value,
                MaxCapacity = CleanMassUnit(match.Groups[5].Value),
                MinCapacity = CleanMassUnit(match.Groups[6].Value),
                VerificationScaleIntervalE = CleanMassUnit(match.Groups[7].Value),
                UnitOfMeasurement = CleanValue(match.Groups[8].Value),
                ActualScaleIntervalD = CleanMassUnit(match.Groups[9].Value),
                VerificationIntervalsN = match.Groups[10].Value,
                MaximumPermissibleError = CleanMassUnit($"{match.Groups[11].Value}g"),
            };

            if (IsPlausibleInstrumentRow(fields))
            {
                return true;
            }
        }

        fields = new InstrumentRowFields();
        return false;
    }

    /// <summary>
    /// DOCA GATC PDFs often lay out the instrument table in columns; PdfPig reads each row as
    /// "Electronic Visual Pass …", "YESWEIGH Zero Pass …", etc. Collect the first cell down the column.
    /// </summary>
    private static bool TryParseInstrumentColumnLayout(string rawText, out InstrumentRowFields fields)
    {
        fields = new InstrumentRowFields();
        var lines = rawText
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Where(line => line.Length > 0)
            .ToList();

        var start = lines.FindIndex(line =>
            Regex.IsMatch(line, @"^(Electronic|Mechanical|Hybrid)\b", RegexOptions.IgnoreCase));

        if (start < 0)
        {
            return false;
        }

        var tokens = new List<string>();
        for (var i = start; i < lines.Count; i++)
        {
            var line = lines[i];
            if (i > start && Regex.IsMatch(line, @"^Visual\b", RegexOptions.IgnoreCase))
            {
                break;
            }

            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
            {
                continue;
            }

            if (i > start && IsVerificationTestColumnLabel(parts[0]))
            {
                break;
            }

            tokens.Add(parts[0]);
            if (tokens.Count >= 12)
            {
                break;
            }
        }

        return TryMapInstrumentTokens(tokens, out fields);
    }

    private static bool IsVerificationTestColumnLabel(string token) =>
        token.Equals("Visual", StringComparison.OrdinalIgnoreCase)
        || token.Equals("Pass", StringComparison.OrdinalIgnoreCase)
        || token.Equals("Ambient", StringComparison.OrdinalIgnoreCase)
        || token.Equals("Supply", StringComparison.OrdinalIgnoreCase);

    private static bool TryMapInstrumentTokens(IReadOnlyList<string> tokens, out InstrumentRowFields fields)
    {
        fields = new InstrumentRowFields();
        if (tokens.Count < 8)
        {
            return false;
        }

        fields = new InstrumentRowFields
        {
            InstrumentType = CleanValue(tokens[0]),
            ManufacturerModel = CleanValue(tokens[1]),
            SerialNumber = CleanValue(tokens[2]),
            YearOfManufacture = tokens[3],
            AccuracyClass = tokens[4],
            MaxCapacity = CleanMassUnit(tokens[5]),
            MinCapacity = tokens.Count > 6 ? CleanMassUnit(tokens[6]) : string.Empty,
            VerificationScaleIntervalE = tokens.Count > 7 ? CleanMassUnit(tokens[7]) : string.Empty,
            UnitOfMeasurement = tokens.Count > 8 ? CleanValue(tokens[8]) : string.Empty,
            ActualScaleIntervalD = tokens.Count > 9 ? CleanMassUnit(tokens[9]) : string.Empty,
            VerificationIntervalsN = tokens.Count > 10 ? tokens[10] : string.Empty,
            MaximumPermissibleError = tokens.Count > 11 ? CleanMassUnit(tokens[11]) : string.Empty,
        };

        return IsPlausibleInstrumentRow(fields);
    }

    /// <summary>Find model/serial/capacity tokens anywhere in flattened text when row patterns fail.</summary>
    private static bool TryParseInstrumentScattered(string text, out InstrumentRowFields fields)
    {
        fields = new InstrumentRowFields();

        Match brandMatch = Regex.Match(
            text,
            @"\bYESWEIGH\s+([A-Z][A-Z0-9-]{4,})\b",
            RegexOptions.CultureInvariant);
        string instrumentType = "Electronic";
        string model = "YESWEIGH";
        string serial;

        if (brandMatch.Success)
        {
            serial = brandMatch.Groups[1].Value;
        }
        else
        {
            brandMatch = Regex.Match(
                text,
                @"\b(Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z][A-Z0-9-]{4,})\b",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (!brandMatch.Success)
            {
                return false;
            }

            instrumentType = brandMatch.Groups[1].Value;
            model = brandMatch.Groups[2].Value;
            serial = brandMatch.Groups[3].Value;
        }

        var classMatch = Regex.Match(
            text,
            @"\b(20\d{2})\s+(I{1,3}|IV)\s+(\d+\.?\d*\s*kg)\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!classMatch.Success)
        {
            return false;
        }

        var chainMatch = Regex.Match(
            text,
            @"\b(\d+\.?\d*\s*g)\s+(\d+\.?\d*\s*g)\s+kg\s+(\d+\.?\d*\s*g)\s+(\d+)\s+(\d+\.?\d*\s*g)\b",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        fields = new InstrumentRowFields
        {
            InstrumentType = CleanValue(instrumentType),
            ManufacturerModel = CleanValue(model),
            SerialNumber = CleanValue(serial),
            YearOfManufacture = classMatch.Groups[1].Value,
            AccuracyClass = classMatch.Groups[2].Value,
            MaxCapacity = CleanMassUnit(classMatch.Groups[3].Value),
            MinCapacity = chainMatch.Success ? CleanMassUnit(chainMatch.Groups[1].Value) : string.Empty,
            VerificationScaleIntervalE = chainMatch.Success ? CleanMassUnit(chainMatch.Groups[2].Value) : string.Empty,
            UnitOfMeasurement = "kg",
            ActualScaleIntervalD = chainMatch.Success ? CleanMassUnit(chainMatch.Groups[3].Value) : string.Empty,
            VerificationIntervalsN = chainMatch.Success ? chainMatch.Groups[4].Value : string.Empty,
            MaximumPermissibleError = chainMatch.Success ? CleanMassUnit(chainMatch.Groups[5].Value) : string.Empty,
        };

        return IsPlausibleInstrumentRow(fields);
    }

    private static bool TryBuildInstrumentRowFromTypedMatch(Match match, out InstrumentRowFields fields)
    {
        if (match.Groups.Count < 13)
        {
            fields = new InstrumentRowFields();
            return false;
        }

        fields = new InstrumentRowFields
        {
            InstrumentType = CleanValue(match.Groups[1].Value),
            ManufacturerModel = CleanValue(match.Groups[2].Value),
            SerialNumber = CleanValue(match.Groups[3].Value),
            YearOfManufacture = match.Groups[4].Value,
            AccuracyClass = match.Groups[5].Value,
            MaxCapacity = CleanMassUnit(match.Groups[6].Value),
            MinCapacity = CleanMassUnit(match.Groups[7].Value),
            VerificationScaleIntervalE = CleanMassUnit(match.Groups[8].Value),
            UnitOfMeasurement = CleanValue(match.Groups[9].Value),
            ActualScaleIntervalD = CleanMassUnit(match.Groups[10].Value),
            VerificationIntervalsN = match.Groups[11].Value,
            MaximumPermissibleError = CleanMassUnit(match.Groups[12].Value),
        };
        return true;
    }

    private static bool IsPlausibleInstrumentRow(InstrumentRowFields fields) =>
        !string.IsNullOrWhiteSpace(fields.SerialNumber)
        && fields.YearOfManufacture.StartsWith("20", StringComparison.Ordinal)
        && fields.MaxCapacity.Contains("kg", StringComparison.OrdinalIgnoreCase)
        && fields.VerificationScaleIntervalE.Contains('g', StringComparison.OrdinalIgnoreCase)
        && !fields.ManufacturerModel.Equals("Verification", StringComparison.OrdinalIgnoreCase);

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
            var rowText = ReconstructTextByWordRows(page);
            if (!string.IsNullOrWhiteSpace(rowText))
            {
                builder.AppendLine(rowText);
            }

            if (!string.IsNullOrWhiteSpace(page.Text))
            {
                builder.AppendLine(page.Text);
            }
        }

        return builder.ToString();
    }

    private static string ReconstructTextByWordRows(Page page)
    {
        var words = page.GetWords().ToList();
        if (words.Count == 0)
        {
            return string.Empty;
        }

        const double rowTolerance = 4.0;
        var rowMap = new Dictionary<long, List<Word>>();

        foreach (var word in words)
        {
            var rowKey = (long)Math.Round(word.BoundingBox.Bottom / rowTolerance);
            if (!rowMap.TryGetValue(rowKey, out var rowWords))
            {
                rowWords = new List<Word>();
                rowMap[rowKey] = rowWords;
            }

            rowWords.Add(word);
        }

        return string.Join(
            Environment.NewLine,
            rowMap.Keys
                .OrderByDescending(key => key)
                .Select(key => string.Join(
                    " ",
                    rowMap[key]
                        .OrderBy(word => word.BoundingBox.Left)
                        .Select(word => word.Text))));
    }

    private static string NormalizeText(string text) =>
        Regex.Replace(
            Regex.Replace(text.Replace('\u00a0', ' '), @"[\r\n\t]+", " ")
                .Replace("Permissibl e", "Permissible", StringComparison.OrdinalIgnoreCase),
            @"\s+",
            " ").Trim();

    private static string CleanValue(string value) =>
        Regex.Replace(value.Trim(), @"\s+", " ");

    private static string CleanMassUnit(string value) =>
        Regex.Replace(
            CleanValue(value),
            @"(\d+\.?\d*)\s+([a-zA-Z]+)",
            "$1$2",
            RegexOptions.CultureInvariant);

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
