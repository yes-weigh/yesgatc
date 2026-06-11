using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed record CertificatePdfUploadResult(
    string DownloadUrl,
    string StoragePath,
    string FileName,
    string ContentType,
    long SizeBytes);

public sealed class FirebaseStorageUploadService
{
    private readonly FirebaseSettings _settings;
    private readonly HttpClient _http = new();

    public FirebaseStorageUploadService(FirebaseSettings settings)
    {
        _settings = settings;
    }

    public async Task<CertificatePdfUploadResult> UploadImageBytesAsync(
        string storagePath,
        byte[] bytes,
        string contentType,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var bucket = ResolveStorageBucket();
        var uploadUrl =
            $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(bucket)}/o?name={Uri.EscapeDataString(storagePath)}";

        using var request = new HttpRequestMessage(HttpMethod.Post, uploadUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not upload image to Firebase Storage ({(int)response.StatusCode}): {body}");
        }

        var payload = await response.Content.ReadFromJsonAsync<StorageUploadResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Firebase Storage returned an empty upload response.");

        var downloadToken = payload.DownloadTokens?
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();

        if (string.IsNullOrWhiteSpace(downloadToken))
        {
            throw new InvalidOperationException("Firebase Storage did not return a download token for the image.");
        }

        var fileName = Path.GetFileName(storagePath);
        var downloadUrl =
            $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(bucket)}/o/{Uri.EscapeDataString(storagePath)}?alt=media&token={Uri.EscapeDataString(downloadToken)}";

        return new CertificatePdfUploadResult(
            downloadUrl,
            storagePath,
            fileName,
            contentType,
            bytes.Length);
    }

    public async Task<CertificatePdfUploadResult> UploadDocaScrapeFileAsync(
        string storagePath,
        byte[] bytes,
        string contentType,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var bucket = ResolveStorageBucket();
        var uploadUrl =
            $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(bucket)}/o?name={Uri.EscapeDataString(storagePath)}";

        using var request = new HttpRequestMessage(HttpMethod.Post, uploadUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not upload DOCA scrape file ({(int)response.StatusCode}): {body}");
        }

        var payload = await response.Content.ReadFromJsonAsync<StorageUploadResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Firebase Storage returned an empty upload response.");

        var downloadToken = payload.DownloadTokens?
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();

        if (string.IsNullOrWhiteSpace(downloadToken))
        {
            throw new InvalidOperationException("Firebase Storage did not return a download token.");
        }

        var fileName = Path.GetFileName(storagePath);
        var downloadUrl =
            $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(bucket)}/o/{Uri.EscapeDataString(storagePath)}?alt=media&token={Uri.EscapeDataString(downloadToken)}";

        return new CertificatePdfUploadResult(
            downloadUrl,
            storagePath,
            fileName,
            contentType,
            bytes.Length);
    }

    public async Task<CertificatePdfUploadResult> UploadCertificatePdfAsync(
        string jobId,
        string localPdfPath,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId))
        {
            throw new InvalidOperationException("Verification job id is required to upload the certificate PDF.");
        }

        if (!File.Exists(localPdfPath))
        {
            throw new FileNotFoundException("Signed certificate PDF was not found for upload.", localPdfPath);
        }

        var fileName = Path.GetFileName(localPdfPath);
        var storagePath =
            $"siteCalibrations/{SanitizePathSegment(jobId)}/certificate-pdf/{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}_{SanitizeFileName(fileName)}";
        var bytes = await File.ReadAllBytesAsync(localPdfPath, cancellationToken);
        var bucket = ResolveStorageBucket();

        var uploadUrl =
            $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(bucket)}/o?name={Uri.EscapeDataString(storagePath)}";

        using var request = new HttpRequestMessage(HttpMethod.Post, uploadUrl);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not upload certificate PDF to Firebase Storage ({(int)response.StatusCode}). " +
                "Sign in again as Super Admin, deploy storage rules if needed, then retry. " +
                body);
        }

        var payload = await response.Content.ReadFromJsonAsync<StorageUploadResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Firebase Storage returned an empty upload response.");

        var downloadToken = payload.DownloadTokens?
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();

        if (string.IsNullOrWhiteSpace(downloadToken))
        {
            throw new InvalidOperationException("Firebase Storage did not return a download token for the certificate PDF.");
        }

        var downloadUrl =
            $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(bucket)}/o/{Uri.EscapeDataString(storagePath)}?alt=media&token={Uri.EscapeDataString(downloadToken)}";

        return new CertificatePdfUploadResult(
            downloadUrl,
            storagePath,
            fileName,
            "application/pdf",
            bytes.Length);
    }

    private string ResolveStorageBucket()
    {
        if (!string.IsNullOrWhiteSpace(_settings.StorageBucket))
        {
            return _settings.StorageBucket.Trim();
        }

        return $"{_settings.ProjectId}.firebasestorage.app";
    }

    public async Task<byte[]> DownloadFileAsync(
        string storagePath,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(storagePath))
        {
            throw new InvalidOperationException("Storage path is required to download a file.");
        }

        var bucket = ResolveStorageBucket();
        var url =
            $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(bucket)}/o/{Uri.EscapeDataString(storagePath)}?alt=media";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not download {storagePath} from Firebase Storage ({(int)response.StatusCode}): {body}");
        }

        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? "certificate.pdf" : cleaned;
    }

    private static string SanitizePathSegment(string value)
    {
        var trimmed = value.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return "unknown";
        }

        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(trimmed.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "unknown" : sanitized;
    }

    private sealed record StorageUploadResponse(
        [property: JsonPropertyName("downloadTokens")] string? DownloadTokens);
}
