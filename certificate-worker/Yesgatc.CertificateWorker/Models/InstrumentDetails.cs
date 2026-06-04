namespace Yesgatc.CertificateWorker.Models;

public sealed class InstrumentDetails
{
    public string TypeOfInstrument { get; init; } = "Electronic";
    public string Manufacturer { get; init; } = string.Empty;
    public string YearOfManufacture { get; init; } = string.Empty;
    public string AccuracyClass { get; init; } = "III";
    public string MaximumCapacity { get; init; } = string.Empty;
    public string MinimumCapacity { get; init; } = string.Empty;
    public string VerificationScaleInterval { get; init; } = string.Empty;
    public string ActualScaleInterval { get; init; } = string.Empty;
    public string NoOfVerificationIntervals { get; init; } = string.Empty;
    public string MaximumPermissibleError { get; init; } = string.Empty;
    public string SupplyVoltage { get; init; } = string.Empty;
    public string AmbientTemperature { get; init; } = string.Empty;
    public string RelativeHumidity { get; init; } = string.Empty;
    /// <summary>All DOCA pass/fail checks default to Pass for submitted OV jobs.</summary>
    public string VerificationTestResult { get; init; } = "Pass";
    public string VerificationSealAffixed { get; init; } = "Yes";
    public string SealIdentificationNumber { get; init; } = string.Empty;
    public string SoftwareIdentification { get; init; } = "Nill";
    public string InstrumentConformsToOiml { get; init; } = "Yes";
    public string VerifiedAndStamped { get; init; } = "Yes";
    public string Remarks { get; init; } = "tested ok";
    public string ModelApprovalNo { get; init; } = string.Empty;
    public string MoneyReceiptNumber { get; init; } = string.Empty;
    /// <summary>DOCA money receipt date (dd-MM-yy).</summary>
    public string MoneyReceiptDated { get; init; } = string.Empty;
    /// <summary>Verification fee incl. GST (INR, whole rupees).</summary>
    public string VerificationFeeTotal { get; init; } = string.Empty;
    public string TotalDeposited { get; init; } = string.Empty;
    /// <summary>in_situ or in_premises — from the verification session.</summary>
    public string VerificationLocation { get; init; } = "in_situ";
    public string UnitOfMeasurement { get; init; } = "kg";
    public string SerialNumber { get; init; } = string.Empty;
    public string StampingImageUrl { get; init; } = string.Empty;
    public string StampingImageName { get; init; } = "Stamping plate image";
    public string StampingImageContentType { get; init; } = "image/jpeg";
    public string ScaleImageUrl { get; init; } = string.Empty;
    public string ScaleImageName { get; init; } = "Scale image";
    public string ScaleImageContentType { get; init; } = "image/jpeg";
    /// <summary>True when instrument photo was missing and stamping plate image is used instead.</summary>
    public bool ScaleImageUsesStampingFallback { get; init; }
}
