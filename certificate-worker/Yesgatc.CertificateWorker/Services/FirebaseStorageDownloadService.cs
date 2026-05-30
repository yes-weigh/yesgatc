using System.IO;
using System.Net.Http;
using System.Text.Json;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class FirebaseStorageDownloadService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private readonly HttpClient _http = new();

    public string StampingImagesDirectory => WorkerDataPaths.StampingImagesDirectory;

    public async Task<StampingImageDownload> DownloadStampingImageAsync(
        string jobId,
        string serialNumber,
        string downloadUrl,
        string fileName,
        string contentType,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(downloadUrl))
        {
            throw new InvalidOperationException("Image download URL is missing.");
        }

        if (string.IsNullOrWhiteSpace(jobId))
        {
            throw new InvalidOperationException("Verification job id is missing.");
        }

        using var response = await _http.GetAsync(downloadUrl, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Could not download stamping plate image ({(int)response.StatusCode}).");
        }

        var extension = ResolveExtension(fileName, contentType);
        var safeSerial = SanitizePathSegment(serialNumber, "serial");
        var jobDirectory = Path.Combine(StampingImagesDirectory, SanitizePathSegment(jobId, "job"));
        Directory.CreateDirectory(jobDirectory);

        var localFileName = $"{safeSerial}-stamping{extension}";
        var localPath = Path.Combine(jobDirectory, localFileName);

        await using (var input = await response.Content.ReadAsStreamAsync(cancellationToken))
        await using (var output = File.Create(localPath))
        {
            await input.CopyToAsync(output, cancellationToken);
        }

        var fileInfo = new FileInfo(localPath);
        var download = new StampingImageDownload(
            localPath,
            jobDirectory,
            localFileName,
            fileInfo.Length,
            downloadUrl,
            jobId,
            serialNumber);

        await WriteManifestAsync(download, fileName, contentType, cancellationToken);
        return download;
    }

    private static async Task WriteManifestAsync(
        StampingImageDownload download,
        string originalFileName,
        string contentType,
        CancellationToken cancellationToken)
    {
        var manifestPath = Path.Combine(download.Directory, "download-info.json");
        var manifest = new
        {
            jobId = download.JobId,
            serialNumber = download.SerialNumber,
            localPath = download.LocalPath,
            fileName = download.FileName,
            sizeBytes = download.SizeBytes,
            sourceUrl = download.SourceUrl,
            originalFileName,
            contentType,
            downloadedAt = DateTimeOffset.Now.ToString("O"),
        };

        await File.WriteAllTextAsync(
            manifestPath,
            JsonSerializer.Serialize(manifest, JsonOptions),
            cancellationToken);
    }

    private static string ResolveExtension(string fileName, string contentType)
    {
        var fromName = Path.GetExtension(fileName);
        if (!string.IsNullOrWhiteSpace(fromName))
        {
            return fromName;
        }

        return contentType.Trim().ToLowerInvariant() switch
        {
            "image/jpeg" or "image/jpg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            "image/gif" => ".gif",
            _ => ".jpg",
        };
    }

    private static string SanitizePathSegment(string value, string fallback)
    {
        var trimmed = value.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return fallback;
        }

        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(trimmed.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? fallback : sanitized;
    }
}
