namespace Yesgatc.CertificateWorker.Models;

public sealed record GatcCertificatePdfExtract
{
    public const int ParserVersion = 4;

    public string ParseStatus { get; init; } = "failed";
    public string ParseError { get; init; } = string.Empty;
    public string ParsedAt { get; init; } = string.Empty;
    public int ParserVersionValue { get; init; } = ParserVersion;

    public string CertificateNumber { get; init; } = string.Empty;
    public string VerificationDate { get; init; } = string.Empty;
    public string OwnerName { get; init; } = string.Empty;
    public string OwnerAddress { get; init; } = string.Empty;
    public string OwnerPhone { get; init; } = string.Empty;

    public string InstrumentType { get; init; } = string.Empty;
    public string ManufacturerModel { get; init; } = string.Empty;
    public string SerialNumber { get; init; } = string.Empty;
    public string YearOfManufacture { get; init; } = string.Empty;
    public string AccuracyClass { get; init; } = string.Empty;
    public string MaxCapacity { get; init; } = string.Empty;
    public string MinCapacity { get; init; } = string.Empty;
    public string VerificationScaleIntervalE { get; init; } = string.Empty;
    public string ActualScaleIntervalD { get; init; } = string.Empty;
    public string UnitOfMeasurement { get; init; } = string.Empty;
    public string VerificationIntervalsN { get; init; } = string.Empty;
    public string MaximumPermissibleError { get; init; } = string.Empty;

    public string NextVerificationDue { get; init; } = string.Empty;
    public string ModelApprovalNos { get; init; } = string.Empty;
    public string SealIdentificationNos { get; init; } = string.Empty;

    public Dictionary<string, object?> ToFirestoreMap()
    {
        static string S(string? v) => v?.Trim() ?? string.Empty;

        return new Dictionary<string, object?>
        {
            ["parseStatus"] = S(ParseStatus),
            ["parseError"] = S(ParseError),
            ["parsedAt"] = S(ParsedAt),
            ["parserVersion"] = ParserVersionValue,
            ["certificateNumber"] = S(CertificateNumber),
            ["verificationDate"] = S(VerificationDate),
            ["ownerName"] = S(OwnerName),
            ["ownerAddress"] = S(OwnerAddress),
            ["ownerPhone"] = S(OwnerPhone),
            ["instrumentType"] = S(InstrumentType),
            ["manufacturerModel"] = S(ManufacturerModel),
            ["serialNumber"] = S(SerialNumber),
            ["yearOfManufacture"] = S(YearOfManufacture),
            ["accuracyClass"] = S(AccuracyClass),
            ["maxCapacity"] = S(MaxCapacity),
            ["minCapacity"] = S(MinCapacity),
            ["verificationScaleIntervalE"] = S(VerificationScaleIntervalE),
            ["actualScaleIntervalD"] = S(ActualScaleIntervalD),
            ["unitOfMeasurement"] = S(UnitOfMeasurement),
            ["verificationIntervalsN"] = S(VerificationIntervalsN),
            ["maximumPermissibleError"] = S(MaximumPermissibleError),
            ["nextVerificationDue"] = S(NextVerificationDue),
            ["modelApprovalNos"] = S(ModelApprovalNos),
            ["sealIdentificationNos"] = S(SealIdentificationNos),
        };
    }
}

public sealed class DocaCertificateSummary
{
    public string Id { get; init; } = string.Empty;
    public string GenerateCertificate { get; init; } = string.Empty;
    public string CertificatePdfPath { get; init; } = string.Empty;
    public string CertificatePdfUrl { get; init; } = string.Empty;
    public string PdfParseStatus { get; init; } = string.Empty;
    public int PdfParserVersion { get; init; }
}

public sealed class DocaEnrichProgressState
{
    public string Status { get; init; } = "idle";
    public string StatusMessage { get; init; } = string.Empty;
    public int TotalRows { get; init; }
    public int ProcessedRows { get; init; }
    public int ParsedRows { get; init; }
    public int SkippedRows { get; init; }
    public int FailedRows { get; init; }
    public string StartedAt { get; init; } = string.Empty;
    public string LastProgressAt { get; init; } = string.Empty;
    public string LastError { get; init; } = string.Empty;
    public DocaEnrichLastProcessed? LastProcessed { get; init; }
}

public sealed class DocaEnrichLastProcessed
{
    public string Certificate { get; init; } = string.Empty;
    public string Action { get; init; } = string.Empty;
    public string ProcessedAt { get; init; } = string.Empty;
    public GatcCertificatePdfExtract? Extract { get; init; }
}
