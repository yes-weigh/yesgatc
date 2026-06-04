using System.Text.Json;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

internal static class RcFeesResolver
{
    public static RcFeesStructure Resolve(
        IReadOnlyDictionary<string, JsonElement>? rcUserFields)
    {
        if (rcUserFields is null
            || !rcUserFields.TryGetValue("feesStructure", out var feesElement)
            || feesElement.ValueKind != JsonValueKind.Object)
        {
            return new RcFeesStructure();
        }

        return new RcFeesStructure
        {
            TierUpto20Kg = ReadTier(feesElement, "tierUpto20Kg", RcFeesStructure.DefaultTierUpto20Kg),
            TierUpto150Kg = ReadTier(feesElement, "tierUpto150Kg", RcFeesStructure.DefaultTierUpto150Kg),
        };
    }

    private static RcFeeTierAmounts ReadTier(JsonElement root, string key, RcFeeTierAmounts defaults)
    {
        if (!root.TryGetProperty(key, out var tier) || tier.ValueKind != JsonValueKind.Object)
        {
            return defaults;
        }

        return new RcFeeTierAmounts
        {
            InPremise = ReadInt(tier, "inPremise", defaults.InPremise),
            InSitu = ReadInt(tier, "inSitu", defaults.InSitu),
            Self = ReadInt(tier, "self", defaults.Self),
        };
    }

    private static int ReadInt(JsonElement parent, string key, int fallback)
    {
        if (!parent.TryGetProperty(key, out var value))
        {
            return fallback;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt32(out var number) => number,
            JsonValueKind.String when int.TryParse(value.GetString(), out var parsed) => parsed,
            _ => fallback,
        };
    }
}
