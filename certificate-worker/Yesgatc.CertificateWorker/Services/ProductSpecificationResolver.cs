using System.Text.Json;

namespace Yesgatc.CertificateWorker.Services;

internal readonly record struct ResolvedProductMetrology(
    double? MaximumCapacity,
    double? MinimumCapacity,
    double? VerificationScaleInterval,
    double? ActualScaleInterval,
    double? NoOfVerificationIntervals,
    double? MaximumPermissibleError,
    string UnitOfMeasurement)
{
    public double? MaximumCapacityKg
    {
        get
        {
            if (MaximumCapacity is null or <= 0)
            {
                return null;
            }

            if (string.Equals(UnitOfMeasurement, "g", StringComparison.OrdinalIgnoreCase))
            {
                return MaximumCapacity.Value / 1000d;
            }

            return MaximumCapacity.Value;
        }
    }
}

/// <summary>
/// Picks Max/Min/e/d/n/MPE from the verification snapshot, then the selected
/// product specification, then product top-level. Multi-spec products must not
/// mix the submitted Max/e with a different spec's Min/d/n on eMAAP.
/// </summary>
internal static class ProductSpecificationResolver
{
    public static ResolvedProductMetrology Resolve(
        IReadOnlyDictionary<string, JsonElement>? calibrationFields,
        IReadOnlyDictionary<string, JsonElement>? productFields)
    {
        var spec = FindSelectedSpec(calibrationFields, productFields);

        var unit = FirstNonEmpty(
            FirestoreFieldReader.ReadString(calibrationFields ?? Empty, "unitOfMeasurement"),
            FirestoreFieldReader.ReadString(productFields ?? Empty, "unitOfMeasurement"),
            "kg");

        var max = FirstPositive(
            Read(calibrationFields, "maximumCapacity"),
            spec?.MaximumCapacity,
            Read(productFields, "maximumCapacity"));

        var verificationScaleInterval = FirstPositive(
            Read(calibrationFields, "verificationScaleInterval"),
            spec?.VerificationScaleInterval,
            Read(productFields, "verificationScaleInterval"));

        var minimumCapacity = FirstPositive(
            Read(calibrationFields, "minimumCapacity"),
            spec?.MinimumCapacity,
            verificationScaleInterval is > 0 ? verificationScaleInterval.Value * 20 : null,
            Read(productFields, "minimumCapacity"));

        var actualScaleInterval = FirstPositive(
            Read(calibrationFields, "actualScaleInterval"),
            spec?.ActualScaleInterval,
            verificationScaleInterval,
            Read(productFields, "actualScaleInterval"));

        var noOfVerificationIntervals = FirstPositive(
            Read(calibrationFields, "noOfVerificationIntervals"),
            spec?.NoOfVerificationIntervals,
            max is > 0 && verificationScaleInterval is > 0
                ? max.Value * 1000 / verificationScaleInterval.Value
                : null,
            Read(productFields, "noOfVerificationIntervals"));

        var maximumPermissibleError = FirstPositive(
            Read(calibrationFields, "maximumPermissibleError"),
            spec?.MaximumPermissibleError,
            Read(productFields, "maximumPermissibleError"));

        return new ResolvedProductMetrology(
            max,
            minimumCapacity,
            verificationScaleInterval,
            actualScaleInterval,
            noOfVerificationIntervals,
            maximumPermissibleError,
            unit);
    }

    private static readonly Dictionary<string, JsonElement> Empty = new();

    private static SpecValues? FindSelectedSpec(
        IReadOnlyDictionary<string, JsonElement>? calibrationFields,
        IReadOnlyDictionary<string, JsonElement>? productFields)
    {
        var specId = FirestoreFieldReader.ReadString(
            calibrationFields ?? Empty, "productSpecificationId");
        if (string.IsNullOrWhiteSpace(specId) || productFields is null)
        {
            return null;
        }

        foreach (var fields in FirestoreFieldReader.ReadArrayOfMaps(productFields, "specifications"))
        {
            var id = FirestoreFieldReader.ReadString(fields, "id");
            if (!string.Equals(id, specId, StringComparison.Ordinal))
            {
                continue;
            }

            return new SpecValues(
                Read(fields, "maximumCapacity"),
                Read(fields, "minimumCapacity"),
                Read(fields, "verificationScaleInterval"),
                Read(fields, "actualScaleInterval"),
                Read(fields, "noOfVerificationIntervals"),
                Read(fields, "maximumPermissibleError"));
        }

        return null;
    }

    private static double? Read(IReadOnlyDictionary<string, JsonElement>? fields, string key) =>
        fields is null ? null : FirestoreFieldReader.ReadDouble(fields, key);

    private static double? FirstPositive(params double?[] values)
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

    private sealed record SpecValues(
        double? MaximumCapacity,
        double? MinimumCapacity,
        double? VerificationScaleInterval,
        double? ActualScaleInterval,
        double? NoOfVerificationIntervals,
        double? MaximumPermissibleError);
}
