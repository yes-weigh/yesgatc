using System.Globalization;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

internal static class DocaVerificationCharges
{
    private const double GstRate = 0.18;

    public static DocaChargeAmounts Resolve(
        IReadOnlyDictionary<string, System.Text.Json.JsonElement>? calibrationFields,
        IReadOnlyDictionary<string, System.Text.Json.JsonElement>? productFields,
        RcFeesStructure fees,
        string verificationType,
        string verificationLocation,
        string verificationSubject)
    {
        if (TryReadStoredCharges(calibrationFields, out var stored))
        {
            return stored;
        }

        var baseFee = ResolveBaseFee(
            fees,
            verificationType,
            verificationLocation,
            verificationSubject,
            productFields);

        if (baseFee is null)
        {
            throw new InvalidOperationException(
                "Verification fee could not be calculated. Save the verification again so fee fields are stored on the record.");
        }

        var gst = (int)Math.Round(baseFee.Value * GstRate, MidpointRounding.AwayFromZero);
        var total = baseFee.Value + gst;

        return new DocaChargeAmounts(
            baseFee.Value,
            gst,
            total,
            CarriageConveyance: 0,
            total);
    }

    public static string FormatMoneyReceiptDate(string? submittedAtIso)
    {
        var ist = TimeZoneInfo.FindSystemTimeZoneById("India Standard Time");
        if (!string.IsNullOrWhiteSpace(submittedAtIso)
            && DateTimeOffset.TryParse(submittedAtIso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var submitted))
        {
            var local = TimeZoneInfo.ConvertTime(submitted, ist);
            return local.ToString("dd-MM-yy", CultureInfo.InvariantCulture);
        }

        var now = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, ist);
        return now.ToString("dd-MM-yy", CultureInfo.InvariantCulture);
    }

    private static bool TryReadStoredCharges(
        IReadOnlyDictionary<string, System.Text.Json.JsonElement>? fields,
        out DocaChargeAmounts amounts)
    {
        amounts = default!;
        if (fields is null)
        {
            return false;
        }

        var total = FirestoreFieldReader.ReadDouble(fields, "verificationFeeTotal");
        if (total is null or <= 0)
        {
            return false;
        }

        var baseFee = FirestoreFieldReader.ReadDouble(fields, "verificationFeeBase") ?? 0;
        var gst = FirestoreFieldReader.ReadDouble(fields, "verificationFeeGst") ?? 0;
        var carriage = FirestoreFieldReader.ReadDouble(fields, "carriageConveyanceFee") ?? 0;
        var deposited = FirestoreFieldReader.ReadDouble(fields, "totalDeposited") ?? total.Value;

        amounts = new DocaChargeAmounts(
            (int)Math.Round(baseFee, MidpointRounding.AwayFromZero),
            (int)Math.Round(gst, MidpointRounding.AwayFromZero),
            (int)Math.Round(total.Value, MidpointRounding.AwayFromZero),
            (int)Math.Round(carriage, MidpointRounding.AwayFromZero),
            (int)Math.Round(deposited, MidpointRounding.AwayFromZero));

        return true;
    }

    private static int? ResolveBaseFee(
        RcFeesStructure fees,
        string verificationType,
        string verificationLocation,
        string verificationSubject,
        IReadOnlyDictionary<string, System.Text.Json.JsonElement>? productFields)
    {
        var capacityKg = ProductMaximumCapacityKg(productFields);
        if (capacityKg is null or <= 0)
        {
            return null;
        }

        var useSelfFees = string.Equals(verificationType, "RV", StringComparison.OrdinalIgnoreCase)
            || string.Equals(verificationSubject, "self", StringComparison.OrdinalIgnoreCase);

        if (!useSelfFees
            && !string.Equals(verificationLocation, "in_situ", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(verificationLocation, "in_premises", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var tier = capacityKg <= 20 ? fees.TierUpto20Kg : fees.TierUpto150Kg;
        if (useSelfFees)
        {
            return tier.Self;
        }

        return string.Equals(verificationLocation, "in_situ", StringComparison.OrdinalIgnoreCase)
            ? tier.InSitu
            : tier.InPremise;
    }

    private static double? ProductMaximumCapacityKg(
        IReadOnlyDictionary<string, System.Text.Json.JsonElement>? productFields)
    {
        if (productFields is null)
        {
            return null;
        }

        var max = FirestoreFieldReader.ReadDouble(productFields, "maximumCapacity");
        if (max is null or <= 0)
        {
            return null;
        }

        var unit = FirestoreFieldReader.ReadString(productFields, "unitOfMeasurement");
        if (string.Equals(unit, "g", StringComparison.OrdinalIgnoreCase))
        {
            return max / 1000d;
        }

        return max;
    }
}

internal readonly record struct DocaChargeAmounts(
    int Base,
    int Gst,
    int VerificationFeeTotal,
    int CarriageConveyance,
    int TotalDeposited)
{
    public string VerificationFeeTotalText => VerificationFeeTotal.ToString(CultureInfo.InvariantCulture);
    public string CarriageConveyanceText => CarriageConveyance.ToString(CultureInfo.InvariantCulture);
    public string TotalDepositedText => TotalDeposited.ToString(CultureInfo.InvariantCulture);

    /** Automation submits 0 for carriage until the web-stored value is wired in. */
    public string CarriageConveyanceForDocaText => "0";
}
