using System.Globalization;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class InstrumentDetailsService
{
    private const string DefaultLaboratorySealIdentification = "IND/KL/26/04/B26";

    private readonly FirestoreDocumentClient _documents;

    public InstrumentDetailsService(FirebaseSettings settings)
    {
        _documents = new FirestoreDocumentClient(settings);
    }

    public async Task<InstrumentDetails> ResolveForJobAsync(
        SiteCalibrationRecord job,
        string rcUserId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var calibrationFields = await _documents.GetFieldsAsync(
            "siteCalibrations", job.Id, idToken, cancellationToken);

        var rcFields = await _documents.GetFieldsAsync("users", rcUserId, idToken, cancellationToken);
        var sealIdentificationNumber = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "sealIdentificationNumber"),
            job.SealIdentificationNumber,
            FirestoreFieldReader.ReadString(rcFields, "laboratorySealIdentification"),
            DefaultLaboratorySealIdentification);

        var productId = FirestoreFieldReader.ReadString(calibrationFields, "productId");
        Dictionary<string, System.Text.Json.JsonElement>? productFields = null;

        if (!string.IsNullOrWhiteSpace(productId))
        {
            productFields = await _documents.GetFieldsAsync(
                "products", productId, idToken, cancellationToken);
        }

        var manufacturer = FirstNonEmpty(
            productFields is not null
                ? FirestoreFieldReader.ReadString(productFields, "manufacturerBrandSeries")
                : string.Empty);

        var modelApprovalNo = productFields is not null
            ? FirestoreFieldReader.ReadString(productFields, "modelApprovalNo")
            : string.Empty;

        var unitOfMeasurement = FirstNonEmpty(
            productFields is not null
                ? FirestoreFieldReader.ReadString(productFields, "unitOfMeasurement")
                : string.Empty,
            FirestoreFieldReader.ReadString(calibrationFields, "unitOfMeasurement"),
            "kg");

        var verificationLocation = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "verificationLocation"),
            "in_situ");

        var serialNumber = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "serialNumber"),
            job.SerialNumber);

        var stampingImageUrl = FirestoreFieldReader.ReadString(calibrationFields, "stampingImageUrl");
        var stampingImageName = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "stampingImageName"),
            "Stamping plate image");
        var stampingImageContentType = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "stampingImageContentType"),
            "image/jpeg");

        var scaleImageUrl = FirestoreFieldReader.ReadString(calibrationFields, "scaleImageUrl");
        var scaleImageName = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "scaleImageName"),
            "Scale image");
        var scaleImageContentType = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "scaleImageContentType"),
            "image/jpeg");

        var maxCapacity = FirstDouble(
            FirestoreFieldReader.ReadDouble(calibrationFields, "maximumCapacity"),
            productFields is not null
                ? FirestoreFieldReader.ReadDouble(productFields, "maximumCapacity")
                : null);

        var minCapacity = FirstDouble(
            productFields is not null
                ? FirestoreFieldReader.ReadDouble(productFields, "minimumCapacity")
                : null);

        var verificationScaleInterval = FirstDouble(
            FirestoreFieldReader.ReadDouble(calibrationFields, "verificationScaleInterval"),
            productFields is not null
                ? FirestoreFieldReader.ReadDouble(productFields, "verificationScaleInterval")
                : null);

        var actualScaleInterval = FirstDouble(
            productFields is not null
                ? FirestoreFieldReader.ReadDouble(productFields, "actualScaleInterval")
                : null,
            verificationScaleInterval);

        var noOfVerificationIntervals = FirstDouble(
            productFields is not null
                ? FirestoreFieldReader.ReadDouble(productFields, "noOfVerificationIntervals")
                : null);

        if (noOfVerificationIntervals is null
            && maxCapacity is > 0
            && verificationScaleInterval is > 0)
        {
            noOfVerificationIntervals = maxCapacity.Value * 1000 / verificationScaleInterval.Value;
        }

        var maximumPermissibleError = FirstDouble(
            FirestoreFieldReader.ReadDouble(calibrationFields, "maximumPermissibleError"),
            productFields is not null
                ? FirestoreFieldReader.ReadDouble(productFields, "maximumPermissibleError")
                : null);

        var supplyVoltage = FirstNonEmpty(
            productFields is not null
                ? FirestoreFieldReader.ReadString(productFields, "supplyVoltage")
                : string.Empty,
            "230 V AC");

        var ambientTemperature = StripUnitSuffix(
            FirestoreFieldReader.ReadString(calibrationFields, "ambientTemperature"));
        var relativeHumidity = StripUnitSuffix(
            FirestoreFieldReader.ReadString(calibrationFields, "relativeHumidity"));

        if (string.IsNullOrWhiteSpace(manufacturer))
        {
            throw new InvalidOperationException("Product manufacturer is missing.");
        }

        if (maxCapacity is null or <= 0
            || minCapacity is null or <= 0
            || verificationScaleInterval is null or <= 0)
        {
            throw new InvalidOperationException(
                "Product capacity fields are missing (maximum, minimum, verification scale interval).");
        }

        if (actualScaleInterval is null or <= 0
            || noOfVerificationIntervals is null or <= 0
            || maximumPermissibleError is null)
        {
            throw new InvalidOperationException(
                "Product metrological fields are missing (d, n, or MPE).");
        }

        if (string.IsNullOrWhiteSpace(ambientTemperature) || string.IsNullOrWhiteSpace(relativeHumidity))
        {
            throw new InvalidOperationException(
                "Ambient temperature and relative humidity are required on the verification record.");
        }

        if (string.IsNullOrWhiteSpace(sealIdentificationNumber))
        {
            throw new InvalidOperationException(
                "Seal identification number is missing on the verification or RC profile.");
        }

        if (string.IsNullOrWhiteSpace(modelApprovalNo))
        {
            throw new InvalidOperationException(
                "Product model approval number is missing.");
        }

        var applicationNumber = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "applicationNumber"));
        if (string.IsNullOrWhiteSpace(applicationNumber))
        {
            throw new InvalidOperationException(
                "Application number is missing on the verification record.");
        }

        var verificationType = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "verificationType"),
            job.VerificationType);
        var verificationSubject = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields, "verificationSubject"),
            "customer");

        var fees = RcFeesResolver.Resolve(rcFields);
        var charges = DocaVerificationCharges.Resolve(
            calibrationFields,
            productFields,
            fees,
            verificationType,
            verificationLocation,
            verificationSubject);
        var isOv = string.Equals(verificationType, "OV", StringComparison.OrdinalIgnoreCase);

        var submittedAt = FirestoreFieldReader.ReadString(calibrationFields, "submittedAt");
        var moneyReceiptDated = DocaVerificationCharges.FormatMoneyReceiptDate(
            string.IsNullOrWhiteSpace(submittedAt) ? job.SubmittedAt : submittedAt);

        var manufacturingYear = FirestoreFieldReader.ReadDouble(calibrationFields, "manufacturingYear");
        var yearOfManufacture = ResolveYearOfManufacture(verificationType, manufacturingYear);

        if (verificationLocation is not ("in_situ" or "in_premises"))
        {
            throw new InvalidOperationException(
                $"Verification location must be in_situ or in_premises (got \"{verificationLocation}\").");
        }

        if (string.IsNullOrWhiteSpace(serialNumber))
        {
            throw new InvalidOperationException("Device serial number is missing on the verification record.");
        }

        if (string.IsNullOrWhiteSpace(stampingImageUrl))
        {
            throw new InvalidOperationException(
                "Serial number plate photo is missing on the verification record.");
        }

        var scaleImageUsesStampingFallback = string.IsNullOrWhiteSpace(scaleImageUrl);
        if (scaleImageUsesStampingFallback)
        {
            scaleImageUrl = stampingImageUrl;
            scaleImageName = stampingImageName;
            scaleImageContentType = stampingImageContentType;
        }

        return new InstrumentDetails
        {
            TypeOfInstrument = "Electronic",
            Manufacturer = manufacturer,
            YearOfManufacture = yearOfManufacture,
            MoneyReceiptNumber = isOv ? string.Empty : applicationNumber,
            MoneyReceiptDated = isOv ? string.Empty : moneyReceiptDated,
            VerificationFeeTotal = isOv ? string.Empty : charges.VerificationFeeTotalText,
            TotalDeposited = isOv ? string.Empty : charges.TotalDepositedText,
            Remarks = ResolveRemarks(
                verificationType,
                FirestoreFieldReader.ReadString(rcFields, "rcCode")),
            AccuracyClass = "III",
            MaximumCapacity = DocaMetrologicalFormatter.FormatMaximumCapacity(maxCapacity.Value),
            MinimumCapacity = DocaMetrologicalFormatter.FormatGrams(minCapacity.Value),
            VerificationScaleInterval = DocaMetrologicalFormatter.FormatGrams(verificationScaleInterval.Value),
            ActualScaleInterval = DocaMetrologicalFormatter.FormatGrams(actualScaleInterval.Value),
            NoOfVerificationIntervals = FormatIntervalCount(noOfVerificationIntervals.Value),
            MaximumPermissibleError = DocaMetrologicalFormatter.FormatGrams(maximumPermissibleError.Value),
            SupplyVoltage = supplyVoltage,
            AmbientTemperature = ambientTemperature,
            RelativeHumidity = relativeHumidity,
            SealIdentificationNumber = sealIdentificationNumber,
            ModelApprovalNo = modelApprovalNo,
            VerificationLocation = verificationLocation,
            UnitOfMeasurement = unitOfMeasurement,
            SerialNumber = serialNumber,
            StampingImageUrl = stampingImageUrl,
            StampingImageName = stampingImageName,
            StampingImageContentType = stampingImageContentType,
            ScaleImageUrl = scaleImageUrl,
            ScaleImageName = scaleImageName,
            ScaleImageContentType = scaleImageContentType,
            ScaleImageUsesStampingFallback = scaleImageUsesStampingFallback,
        };
    }

    private static string ResolveRemarks(string verificationType, string? rcCode)
    {
        var code = NormalizeRcCode(rcCode);
        var isRv = string.Equals(verificationType, "RV", StringComparison.OrdinalIgnoreCase);
        if (code.Length == 3)
        {
            return isRv
                ? $"Re verification by {code}"
                : $"Original verification by {code}";
        }

        return isRv ? "Re verification" : "Original verification";
    }

    private static string NormalizeRcCode(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return string.Empty;
        }

        return new string(input
            .Where(char.IsLetterOrDigit)
            .Take(3)
            .Select(char.ToUpperInvariant)
            .ToArray());
    }

    private static string ResolveYearOfManufacture(string verificationType, double? manufacturingYear)
    {
        if (string.Equals(verificationType, "RV", StringComparison.OrdinalIgnoreCase)
            && manufacturingYear is > 0)
        {
            return ((int)Math.Round(manufacturingYear.Value, MidpointRounding.AwayFromZero))
                .ToString(CultureInfo.InvariantCulture);
        }

        return DateTime.Now.Year.ToString(CultureInfo.InvariantCulture);
    }

    private static string FormatIntervalCount(double value)
    {
        if (Math.Abs(value % 1) < 0.000001)
        {
            return ((long)value).ToString(CultureInfo.InvariantCulture);
        }

        return value.ToString("0.##", CultureInfo.InvariantCulture);
    }

    private static string StripUnitSuffix(string value)
    {
        var trimmed = value.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return string.Empty;
        }

        return trimmed
            .Replace("°C", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("°c", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("%", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Trim();
    }

    private static double? FirstDouble(params double?[] values)
    {
        foreach (var value in values)
        {
            if (value is > 0)
            {
                return value;
            }
        }

        return values.FirstOrDefault(v => v is not null);
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }
}
