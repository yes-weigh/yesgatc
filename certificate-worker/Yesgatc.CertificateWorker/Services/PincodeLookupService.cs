using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Yesgatc.CertificateWorker.Services;

public sealed record PincodeLookupResult(string State, string District);

public sealed class PincodeLookupService
{
    private static readonly Regex PincodeRegex = new(@"^\d{6}$", RegexOptions.Compiled);
    private static readonly ConcurrentDictionary<string, PincodeLookupResult?> SessionCache = new();
    private static readonly ConcurrentDictionary<string, Task<PincodeLookupResult?>> InFlightLookups = new();

    private readonly HttpClient _http = new();

    public static string NormalizePincode(string input) =>
        new string(input.Where(char.IsDigit).Take(6).ToArray());

    public static bool IsValidPincode(string pincode) =>
        PincodeRegex.IsMatch(NormalizePincode(pincode));

    /// <summary>
    /// Resolves state/district for a pincode. Results are cached in memory for the
    /// lifetime of the process so cycling through jobs with the same pincode avoids repeat API calls.
    /// </summary>
    public Task<PincodeLookupResult?> LookupAsync(string pincode, CancellationToken cancellationToken = default)
    {
        var normalized = NormalizePincode(pincode);
        if (!IsValidPincode(normalized))
        {
            return Task.FromResult<PincodeLookupResult?>(null);
        }

        if (SessionCache.TryGetValue(normalized, out var cached))
        {
            return Task.FromResult(cached);
        }

        return InFlightLookups.GetOrAdd(
            normalized,
            key => FetchAndCacheAsync(key, cancellationToken));
    }

    private async Task<PincodeLookupResult?> FetchAndCacheAsync(string normalized, CancellationToken cancellationToken)
    {
        try
        {
            var result = await LookupUncachedAsync(normalized, cancellationToken);
            if (result is not null)
            {
                SessionCache[normalized] = result;
            }

            return result;
        }
        finally
        {
            InFlightLookups.TryRemove(normalized, out _);
        }
    }

    private async Task<PincodeLookupResult?> LookupUncachedAsync(string normalized, CancellationToken cancellationToken)
    {
        var primary = await FetchPostalPincodeInAsync(normalized, cancellationToken);
        if (primary is not null)
        {
            return primary;
        }

        return await FetchVercelPincodeApiAsync(normalized, cancellationToken);
    }

    private async Task<PincodeLookupResult?> FetchPostalPincodeInAsync(string pincode, CancellationToken cancellationToken)
    {
        try
        {
            var url = $"https://api.postalpincode.in/pincode/{pincode}";
            var data = await _http.GetFromJsonAsync<PostalApiBlock[]>(url, cancellationToken);
            return ParsePostalPincodeResponse(data);
        }
        catch
        {
            return null;
        }
    }

    private async Task<PincodeLookupResult?> FetchVercelPincodeApiAsync(string pincode, CancellationToken cancellationToken)
    {
        try
        {
            var url = $"https://postal-pincode-api.vercel.app/api/v1/pincode/{pincode}";
            var data = await _http.GetFromJsonAsync<VercelPincodeApiResponse>(url, cancellationToken);
            return ParseVercelPincodeResponse(data);
        }
        catch
        {
            return null;
        }
    }

    private static PincodeLookupResult? ParsePostalPincodeResponse(PostalApiBlock[]? data)
    {
        var block = data?.FirstOrDefault();
        if (block?.Status != "Success" || block.PostOffice is null || block.PostOffice.Count == 0)
        {
            return null;
        }

        var office = block.PostOffice[0];
        var state = office.State?.Trim();
        var district = office.District?.Trim();
        if (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(district))
        {
            return null;
        }

        return new PincodeLookupResult(state, district);
    }

    private static PincodeLookupResult? ParseVercelPincodeResponse(VercelPincodeApiResponse? data)
    {
        var row = data?.Data?.FirstOrDefault();
        var state = row?.State?.Trim();
        var district = row?.District?.Trim();
        if (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(district))
        {
            return null;
        }

        return new PincodeLookupResult(TitleCaseWords(state), TitleCaseWords(district));
    }

    private static string TitleCaseWords(string value) =>
        CultureInfo.InvariantCulture.TextInfo.ToTitleCase(value.Trim().ToLowerInvariant());

    private sealed record PostalApiBlock(
        [property: JsonPropertyName("Status")] string Status,
        [property: JsonPropertyName("PostOffice")] List<PostalApiPostOffice>? PostOffice);

    private sealed record PostalApiPostOffice(
        [property: JsonPropertyName("State")] string? State,
        [property: JsonPropertyName("District")] string? District);

    private sealed record VercelPincodeApiResponse(
        [property: JsonPropertyName("data")] List<VercelPincodeRow>? Data);

    private sealed record VercelPincodeRow(
        [property: JsonPropertyName("state")] string? State,
        [property: JsonPropertyName("district")] string? District);
}
