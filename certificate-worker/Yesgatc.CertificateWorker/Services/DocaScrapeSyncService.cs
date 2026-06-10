using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class DocaScrapeSyncService
{
    private const string Collection = "docaCertificates";

    private readonly FirebaseSettings _firebaseSettings;
    private readonly FirestoreDocumentClient _documents;
    private readonly FirebaseStorageUploadService _storage;

    public DocaScrapeSyncService(FirebaseSettings firebaseSettings)
    {
        _firebaseSettings = firebaseSettings;
        _documents = new FirestoreDocumentClient(firebaseSettings);
        _storage = new FirebaseStorageUploadService(firebaseSettings);
    }

    public static string BuildDocumentId(string generateCertificate) =>
        SanitizeDocumentId(generateCertificate);

    public async Task<bool> ShouldSkipRowAsync(
        DocaGatcRow row,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var docId = BuildDocumentId(row.GenerateCertificate);
        var existing = await _documents.TryGetFieldsAsync(Collection, docId, idToken, cancellationToken);
        if (existing.Count == 0)
        {
            return false;
        }

        var existingPdf = FirestoreDocumentClient.ReadString(existing, "certificatePdfUrl") ?? string.Empty;
        var existingPhoto = FirestoreDocumentClient.ReadString(existing, "instrumentPhotoUrl") ?? string.Empty;

        // Already synced — skip download/upload (no verification pipeline lookup).
        return !string.IsNullOrWhiteSpace(existingPdf)
            && !string.IsNullOrWhiteSpace(existingPhoto);
    }

    public async Task SyncRowAsync(
        DocaGatcRow row,
        IBrowserContext browserContext,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var docId = BuildDocumentId(row.GenerateCertificate);
        var storageFolder = SanitizeStorageFolder(row.GenerateCertificate);

        var pdfBytes = await DownloadBinaryAsync(browserContext, row.CertificateSourceUrl, cancellationToken);
        if (!LooksLikePdf(pdfBytes))
        {
            throw new InvalidOperationException($"Downloaded certificate for {row.GenerateCertificate} is not a PDF.");
        }

        var photoBytes = await DownloadBinaryAsync(browserContext, row.PhotoSourceUrl, cancellationToken);
        var photoContentType = GuessImageContentType(photoBytes, row.PhotoSourceUrl);

        var pdfPath = $"docaCertificates/{storageFolder}/certificate.pdf";
        var photoPath = $"docaCertificates/{storageFolder}/instrument.jpg";

        var pdfUpload = await _storage.UploadDocaScrapeFileAsync(
            pdfPath,
            pdfBytes,
            "application/pdf",
            idToken,
            cancellationToken);

        var photoUpload = await _storage.UploadDocaScrapeFileAsync(
            photoPath,
            photoBytes,
            photoContentType,
            idToken,
            cancellationToken);

        var scrapedAt = DateTimeOffset.UtcNow.ToString("O");
        var fields = new Dictionary<string, object?>
        {
            ["generateCertificate"] = row.GenerateCertificate,
            ["gatcCertificateNo"] = row.GatcCertificateNo,
            ["instrumentName"] = row.InstrumentName,
            ["belongTo"] = row.BelongTo,
            ["validityDate"] = row.ValidityDate,
            ["uploadDate"] = row.UploadDate,
            ["certificatePdfUrl"] = pdfUpload.DownloadUrl,
            ["certificatePdfPath"] = pdfUpload.StoragePath,
            ["certificatePdfName"] = pdfUpload.FileName,
            ["certificatePdfContentType"] = pdfUpload.ContentType,
            ["certificatePdfSizeBytes"] = pdfUpload.SizeBytes,
            ["instrumentPhotoUrl"] = photoUpload.DownloadUrl,
            ["instrumentPhotoPath"] = photoUpload.StoragePath,
            ["instrumentPhotoName"] = photoUpload.FileName,
            ["instrumentPhotoContentType"] = photoUpload.ContentType,
            ["instrumentPhotoSizeBytes"] = photoUpload.SizeBytes,
            ["docaCertSourceUrl"] = row.CertificateSourceUrl,
            ["docaPhotoSourceUrl"] = row.PhotoSourceUrl,
            ["scrapedAt"] = scrapedAt,
            ["machineName"] = Environment.MachineName,
        };

        var existing = await _documents.TryGetFieldsAsync(Collection, docId, idToken, cancellationToken);
        if (existing.Count == 0)
        {
            await _documents.CreateDocumentWithIdAsync(Collection, docId, fields, idToken, cancellationToken);
        }
        else
        {
            await _documents.PatchFieldsAsync(Collection, docId, fields, idToken, cancellationToken);
        }
    }

    private static async Task<byte[]> DownloadBinaryAsync(
        IBrowserContext browserContext,
        string url,
        CancellationToken cancellationToken)
    {
        var response = await browserContext.APIRequest.GetAsync(url, new APIRequestContextOptions
        {
            Timeout = 120_000,
        });

        if (!response.Ok)
        {
            throw new InvalidOperationException($"Could not download {url} ({response.Status}).");
        }

        var bytes = await response.BodyAsync();
        cancellationToken.ThrowIfCancellationRequested();
        return bytes;
    }

    private static bool LooksLikePdf(byte[] bytes) =>
        bytes.Length >= 4
        && bytes[0] == 0x25
        && bytes[1] == 0x50
        && bytes[2] == 0x44
        && bytes[3] == 0x46;

    private static string GuessImageContentType(byte[] bytes, string url)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8)
        {
            return "image/jpeg";
        }

        if (bytes.Length >= 8
            && bytes[0] == 0x89
            && bytes[1] == 0x50
            && bytes[2] == 0x4E
            && bytes[3] == 0x47)
        {
            return "image/png";
        }

        return url.Contains(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg";
    }

    private static string SanitizeDocumentId(string generateCertificate)
    {
        var trimmed = generateCertificate.Trim();
        var sanitized = Regex.Replace(trimmed, @"[^A-Za-z0-9._-]+", "_");
        return string.IsNullOrWhiteSpace(sanitized) ? "unknown" : sanitized;
    }

    private static string SanitizeStorageFolder(string generateCertificate) =>
        SanitizeDocumentId(generateCertificate);
}
