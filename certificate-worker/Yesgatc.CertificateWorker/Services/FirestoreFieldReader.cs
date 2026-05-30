using System.Globalization;
using System.Text.Json;

namespace Yesgatc.CertificateWorker.Services;

internal static class FirestoreFieldReader
{
    public static string ReadString(IReadOnlyDictionary<string, JsonElement> fields, string key, string fallback = "")
    {
        if (!fields.TryGetValue(key, out var value) || value.ValueKind != JsonValueKind.Object)
        {
            return fallback;
        }

        if (value.TryGetProperty("stringValue", out var stringValue))
        {
            return stringValue.GetString() ?? fallback;
        }

        if (value.TryGetProperty("integerValue", out var integerValue))
        {
            return integerValue.ValueKind switch
            {
                JsonValueKind.String => integerValue.GetString() ?? fallback,
                JsonValueKind.Number => integerValue.GetRawText(),
                _ => fallback,
            };
        }

        if (value.TryGetProperty("doubleValue", out var doubleValue))
        {
            return doubleValue.ValueKind switch
            {
                JsonValueKind.Number => doubleValue.GetDouble().ToString(CultureInfo.InvariantCulture),
                JsonValueKind.String => doubleValue.GetString() ?? fallback,
                _ => fallback,
            };
        }

        if (value.TryGetProperty("booleanValue", out var booleanValue)
            && booleanValue.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            return booleanValue.GetBoolean().ToString();
        }

        return fallback;
    }

    public static double? ReadDouble(IReadOnlyDictionary<string, JsonElement> fields, string key)
    {
        if (!fields.TryGetValue(key, out var value) || value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (value.TryGetProperty("doubleValue", out var doubleValue))
        {
            return doubleValue.ValueKind switch
            {
                JsonValueKind.Number => doubleValue.GetDouble(),
                JsonValueKind.String when double.TryParse(doubleValue.GetString(), out var parsed) => parsed,
                _ => null,
            };
        }

        if (value.TryGetProperty("integerValue", out var integerValue))
        {
            return integerValue.ValueKind switch
            {
                JsonValueKind.Number => integerValue.GetDouble(),
                JsonValueKind.String when double.TryParse(integerValue.GetString(), out var parsed) => parsed,
                _ => null,
            };
        }

        if (value.TryGetProperty("stringValue", out var stringValue)
            && double.TryParse(stringValue.GetString(), out var fromString))
        {
            return fromString;
        }

        return null;
    }

    public static string FormatNumber(double? value)
    {
        if (value is null)
        {
            return string.Empty;
        }

        var numeric = value.Value;
        if (Math.Abs(numeric % 1) < 0.000001)
        {
            return ((long)numeric).ToString(CultureInfo.InvariantCulture);
        }

        return numeric.ToString(CultureInfo.InvariantCulture);
    }
}
