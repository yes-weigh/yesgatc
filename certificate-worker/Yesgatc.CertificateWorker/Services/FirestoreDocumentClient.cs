using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

internal sealed class FirestoreDocumentClient
{
    private readonly HttpClient _http = new();
    private readonly FirebaseSettings _settings;

    public FirestoreDocumentClient(FirebaseSettings settings)
    {
        _settings = settings;
    }

    public async Task<Dictionary<string, JsonElement>> GetFieldsAsync(
        string collection,
        string documentId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents/{collection}/{documentId}";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Could not load {collection}/{documentId} from Firestore ({(int)response.StatusCode}).");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var document = await JsonSerializer.DeserializeAsync<FirestoreDocumentPayload>(stream, cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException($"Empty Firestore response for {collection}/{documentId}.");

        return document.Fields ?? new Dictionary<string, JsonElement>();
    }

    public async Task PatchStringFieldsAsync(
        string collection,
        string documentId,
        IReadOnlyDictionary<string, string> fields,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (fields.Count == 0)
        {
            return;
        }

        var payloadFields = fields.ToDictionary(pair => pair.Key, pair => (object?)pair.Value);
        await PatchFieldsAsync(collection, documentId, payloadFields, idToken, cancellationToken);
    }

    public async Task PatchFieldsAsync(
        string collection,
        string documentId,
        IReadOnlyDictionary<string, object?> fields,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (fields.Count == 0)
        {
            return;
        }

        var mask = string.Join(
            "&",
            fields.Keys.Select(key => $"updateMask.fieldPaths={Uri.EscapeDataString(key)}"));
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents/{collection}/{documentId}?{mask}";

        var payloadFields = fields.ToDictionary(pair => pair.Key, pair => ToFirestoreValue(pair.Value));

        using var request = new HttpRequestMessage(HttpMethod.Patch, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        request.Content = JsonContent.Create(new { fields = payloadFields });

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not update {collection}/{documentId} in Firestore ({(int)response.StatusCode}): {body}");
        }
    }

    public async Task CreateDocumentAsync(
        string collection,
        IReadOnlyDictionary<string, object?> fields,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents/{collection}";

        var payloadFields = fields.ToDictionary(pair => pair.Key, pair => ToFirestoreValue(pair.Value));

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        request.Content = JsonContent.Create(new { fields = payloadFields });

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not create document in {collection} ({(int)response.StatusCode}): {body}");
        }
    }

    public async Task<Dictionary<string, JsonElement>> TryGetFieldsAsync(
        string collection,
        string documentId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents/{collection}/{documentId}";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);

        using var response = await _http.SendAsync(request, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return new Dictionary<string, JsonElement>();
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Could not load {collection}/{documentId} from Firestore ({(int)response.StatusCode}).");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var document = await JsonSerializer.DeserializeAsync<FirestoreDocumentPayload>(stream, cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException($"Empty Firestore response for {collection}/{documentId}.");

        return document.Fields ?? new Dictionary<string, JsonElement>();
    }

    internal static object ToFirestoreValue(object? value) => value switch
    {
        null => new Dictionary<string, object?> { ["nullValue"] = null },
        bool boolean => new Dictionary<string, object> { ["booleanValue"] = boolean },
        int integer => new Dictionary<string, string> { ["integerValue"] = integer.ToString() },
        long longValue => new Dictionary<string, string> { ["integerValue"] = longValue.ToString() },
        double doubleValue => new Dictionary<string, double> { ["doubleValue"] = doubleValue },
        string text => new Dictionary<string, string> { ["stringValue"] = text },
        _ => new Dictionary<string, string> { ["stringValue"] = value.ToString() ?? string.Empty },
    };

    internal static string? ReadString(Dictionary<string, JsonElement> fields, string key) =>
        fields.TryGetValue(key, out var element) && element.TryGetProperty("stringValue", out var value)
            ? value.GetString()
            : null;

    internal static bool ReadBool(Dictionary<string, JsonElement> fields, string key, bool fallback = false)
    {
        if (!fields.TryGetValue(key, out var element) || !element.TryGetProperty("booleanValue", out var value))
        {
            return fallback;
        }

        return value.GetBoolean();
    }

    internal static int ReadInt(Dictionary<string, JsonElement> fields, string key, int fallback = 0)
    {
        if (!fields.TryGetValue(key, out var element) || !element.TryGetProperty("integerValue", out var value))
        {
            return fallback;
        }

        return int.TryParse(value.GetString(), out var parsed) ? parsed : fallback;
    }

    private sealed record FirestoreDocumentPayload(
        [property: JsonPropertyName("fields")] Dictionary<string, JsonElement>? Fields);
}
