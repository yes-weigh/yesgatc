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

        var mask = string.Join(
            "&",
            fields.Keys.Select(key => $"updateMask.fieldPaths={Uri.EscapeDataString(key)}"));
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents/{collection}/{documentId}?{mask}";

        var payloadFields = fields.ToDictionary(
            pair => pair.Key,
            pair => (object)new Dictionary<string, string> { ["stringValue"] = pair.Value });

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

    private sealed record FirestoreDocumentPayload(
        [property: JsonPropertyName("fields")] Dictionary<string, JsonElement>? Fields);
}
