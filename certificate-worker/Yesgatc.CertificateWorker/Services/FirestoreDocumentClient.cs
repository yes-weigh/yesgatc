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

    public async Task CreateDocumentWithIdAsync(
        string collection,
        string documentId,
        IReadOnlyDictionary<string, object?> fields,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents/{collection}?documentId={Uri.EscapeDataString(documentId)}";

        var payloadFields = fields.ToDictionary(pair => pair.Key, pair => ToFirestoreValue(pair.Value));

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        request.Content = JsonContent.Create(new { fields = payloadFields });

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not create {collection}/{documentId} in Firestore ({(int)response.StatusCode}): {body}");
        }
    }

    public async Task DeleteDocumentAsync(
        string collection,
        string documentId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents/{collection}/{documentId}";

        using var request = new HttpRequestMessage(HttpMethod.Delete, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        using var response = await _http.SendAsync(request, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return;
        }

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not delete {collection}/{documentId} ({(int)response.StatusCode}): {body}");
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
        double doubleValue => new Dictionary<string, object> { ["doubleValue"] = doubleValue },
        DateTimeOffset timestamp => new Dictionary<string, string>
        {
            ["timestampValue"] = timestamp.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),
        },
        DateTime dateTime => new Dictionary<string, string>
        {
            ["timestampValue"] = DateTime.SpecifyKind(dateTime, DateTimeKind.Utc)
                .ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),
        },
        IReadOnlyDictionary<string, object?> dictionary => new Dictionary<string, object>
        {
            ["mapValue"] = new Dictionary<string, object>
            {
                ["fields"] = dictionary
                    .Where(pair => pair.Value is not null)
                    .ToDictionary(pair => pair.Key, pair => ToFirestoreValue(pair.Value)),
            },
        },
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

    internal static Dictionary<string, JsonElement> ReadMapFields(
        Dictionary<string, JsonElement> fields,
        string key)
    {
        if (!fields.TryGetValue(key, out var element)
            || !element.TryGetProperty("mapValue", out var mapValue)
            || !mapValue.TryGetProperty("fields", out var innerFields))
        {
            return new Dictionary<string, JsonElement>();
        }

        return innerFields
            .EnumerateObject()
            .ToDictionary(property => property.Name, property => property.Value);
    }

    public Task<List<(string Id, Dictionary<string, JsonElement> Fields)>> ListCollectionAsync(
        string collection,
        string idToken,
        CancellationToken cancellationToken = default) =>
        QueryEqualAsync(collection, fieldPath: null, equalValue: null, idToken, cancellationToken);

    public async Task<List<(string Id, Dictionary<string, JsonElement> Fields)>> QueryEqualAsync(
        string collection,
        string? fieldPath,
        string? equalValue,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents:runQuery";

        QueryFilter? where = null;
        if (!string.IsNullOrWhiteSpace(fieldPath) && equalValue is not null)
        {
            where = new QueryFilter(new FieldFilter(
                new FieldReference(fieldPath),
                "EQUAL",
                new FirestoreQueryValue { StringValue = equalValue }));
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        request.Content = JsonContent.Create(new RunQueryRequest(new StructuredQuery(
            [new CollectionSelector(collection)],
            where)));

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not list {collection} from Firestore ({(int)response.StatusCode}): {body}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var rows = await JsonSerializer.DeserializeAsync<List<RunQueryRow>>(stream, cancellationToken: cancellationToken)
            ?? [];

        var results = new List<(string Id, Dictionary<string, JsonElement> Fields)>();
        foreach (var row in rows)
        {
            if (row.Document?.Fields is null || string.IsNullOrWhiteSpace(row.Document.Name))
            {
                continue;
            }

            var id = row.Document.Name.Split('/').LastOrDefault() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(id))
            {
                continue;
            }

            results.Add((id, row.Document.Fields));
        }

        return results;
    }

    private sealed record RunQueryRequest(
        [property: JsonPropertyName("structuredQuery")] StructuredQuery StructuredQuery);

    private sealed record StructuredQuery(
        [property: JsonPropertyName("from")] CollectionSelector[] From,
        [property: JsonPropertyName("where")]
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        QueryFilter? Where = null);

    private sealed record CollectionSelector(
        [property: JsonPropertyName("collectionId")] string CollectionId);

    private sealed record QueryFilter(
        [property: JsonPropertyName("fieldFilter")] FieldFilter FieldFilter);

    private sealed record FieldFilter(
        [property: JsonPropertyName("field")] FieldReference Field,
        [property: JsonPropertyName("op")] string Op,
        [property: JsonPropertyName("value")] FirestoreQueryValue Value);

    private sealed record FieldReference(
        [property: JsonPropertyName("fieldPath")] string FieldPath);

    private sealed record FirestoreQueryValue
    {
        [property: JsonPropertyName("stringValue")]
        public string? StringValue { get; init; }
    }

    private sealed record RunQueryRow(
        [property: JsonPropertyName("document")] RunQueryDocument? Document);

    private sealed record RunQueryDocument(
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("fields")] Dictionary<string, JsonElement>? Fields);

    private sealed record FirestoreDocumentPayload(
        [property: JsonPropertyName("fields")] Dictionary<string, JsonElement>? Fields);
}
