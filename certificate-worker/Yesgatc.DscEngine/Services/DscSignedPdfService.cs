using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Yesgatc.DscEngine.Models;

namespace Yesgatc.DscEngine.Services;

public sealed class DscSignedPdfService
{
    private readonly HttpClient _http = new();
    private readonly FirestoreDocumentClient _documents;
    private readonly FirebaseStorageUploadService _storage;
    private readonly PdfDscSigner _signer;

    public DscSignedPdfService(FirebaseSettings firebase, DscSettings dsc)
    {
        _documents = new FirestoreDocumentClient(firebase);
        _storage = new FirebaseStorageUploadService(firebase);
        _signer = new PdfDscSigner(dsc);
    }

    public async Task<string> SignAndSaveLocalAsync(
        DscCertificateRecord record,
        DscTokenSession token,
        FirebaseSignInResult session,
        string destinationDirectory,
        DscStampLayout? layout = null,
        CancellationToken cancellationToken = default)
    {
        var signed = await SignBytesAsync(record, token, session.IdToken, layout, cancellationToken);
        Directory.CreateDirectory(destinationDirectory);
        var path = UniquePath(Path.Combine(destinationDirectory, SuggestedSignedFileName(record)));
        await File.WriteAllBytesAsync(path, signed, cancellationToken);
        return path;
    }

    public async Task<DscCertificateRecord> SignAndUploadAsync(
        DscCertificateRecord record,
        DscTokenSession token,
        FirebaseSignInResult session,
        DscStampLayout? layout = null,
        CancellationToken cancellationToken = default)
    {
        var signed = await SignBytesAsync(record, token, session.IdToken, layout, cancellationToken);
        var localName = SuggestedSignedFileName(record);
        var storagePath =
            $"siteCalibrations/{record.Id}/signed-certificate/{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.pdf";
        var upload = await _storage.UploadPdfBytesAsync(
            storagePath,
            signed,
            session.IdToken,
            localName,
            cancellationToken);

        var uploadedAt = DateTime.UtcNow.ToString("o");
        // Patch signed-* only. certificatePdfUrl / Path stay as the unsigned eMAAP PDF.
        await _documents.PatchStringFieldsAsync(
            "siteCalibrations",
            record.Id,
            new Dictionary<string, string>
            {
                ["signedCertificatePdfUrl"] = upload.DownloadUrl,
                ["signedCertificatePdfPath"] = upload.StoragePath,
                ["signedCertificatePdfName"] = upload.FileName,
                ["signedCertificatePdfContentType"] = "application/pdf",
                ["signedCertificateUploadedAt"] = uploadedAt,
                ["signedCertificateUploadedByUid"] = session.UserId,
                ["updatedAt"] = uploadedAt,
            },
            session.IdToken,
            cancellationToken);

        return record.WithSignedPdf(upload.DownloadUrl, upload.StoragePath);
    }

    private async Task<byte[]> SignBytesAsync(
        DscCertificateRecord record,
        DscTokenSession token,
        string idToken,
        DscStampLayout? layout,
        CancellationToken cancellationToken)
    {
        if (record.IsVoided)
        {
            throw new InvalidOperationException($"{record.CertificateNumber} is voided.");
        }

        var unsigned = await DownloadUnsignedPdfAsync(record, idToken, cancellationToken);
        if (unsigned.Length > 20 * 1024 * 1024)
        {
            throw new InvalidOperationException("Certificate PDF is larger than 20 MB.");
        }

        var signed = _signer.SignVisible(unsigned, token, record, layout);
        var localDir = WorkerDataPaths.CertificatePdfDirectory(record.Id);
        await File.WriteAllBytesAsync(
            Path.Combine(localDir, SuggestedSignedFileName(record)),
            signed,
            cancellationToken);
        return signed;
    }

    public async Task<string> DownloadSignedPdfAsync(
        DscCertificateRecord record,
        string idToken,
        string destinationPath,
        CancellationToken cancellationToken = default)
    {
        if (record.SignStatus != DscSignStatus.Signed)
        {
            throw new InvalidOperationException($"{record.CertificateNumber} is not signed.");
        }

        var bytes = await DownloadSignedPdfBytesAsync(record, idToken, cancellationToken);
        var directory = Path.GetDirectoryName(destinationPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllBytesAsync(destinationPath, bytes, cancellationToken);
        return destinationPath;
    }

    public static string SuggestedSignedFileName(DscCertificateRecord record)
    {
        var stem = string.IsNullOrWhiteSpace(record.CertificateNumber)
            ? record.SerialNumber
            : record.CertificateNumber;
        return SanitizeFileName($"{stem}_signed.pdf");
    }

    private async Task<byte[]> DownloadSignedPdfBytesAsync(
        DscCertificateRecord record,
        string idToken,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(record.SignedCertificatePdfPath))
        {
            try
            {
                return await _storage.DownloadFileAsync(record.SignedCertificatePdfPath, idToken, cancellationToken);
            }
            catch
            {
            }
        }

        if (!string.IsNullOrWhiteSpace(record.SignedCertificatePdfUrl))
        {
            var fromUrl = await TryDownloadUrlAsync(record.SignedCertificatePdfUrl, idToken, cancellationToken);
            if (fromUrl is not null)
            {
                return fromUrl;
            }
        }

        try
        {
            return await DownloadUnsignedPdfAsync(record, idToken, cancellationToken);
        }
        catch
        {
            throw new InvalidOperationException(
                $"No signed PDF file for {record.CertificateNumber}.");
        }
    }

    private async Task<byte[]?> TryDownloadUrlAsync(
        string url,
        string idToken,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", idToken);
        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            using var retry = new HttpRequestMessage(HttpMethod.Get, url);
            using var fallback = await _http.SendAsync(retry, cancellationToken);
            if (!fallback.IsSuccessStatusCode)
            {
                return null;
            }

            return await fallback.Content.ReadAsByteArrayAsync(cancellationToken);
        }

        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    private async Task<byte[]> DownloadUnsignedPdfAsync(
        DscCertificateRecord record,
        string idToken,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(record.CertificatePdfPath))
        {
            try
            {
                return await _storage.DownloadFileAsync(record.CertificatePdfPath, idToken, cancellationToken);
            }
            catch
            {
            }
        }

        foreach (var url in new[] { record.CertificatePdfUrl, record.EmaapCertificatePdfUrl })
        {
            if (string.IsNullOrWhiteSpace(url))
            {
                continue;
            }

            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", idToken);
            using var response = await _http.SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadAsByteArrayAsync(cancellationToken);
            }
        }

        throw new InvalidOperationException(
            $"No unsigned PDF for {record.CertificateNumber}. Wait for eMAAP PDF sync.");
    }

    private static string UniquePath(string path)
    {
        if (!File.Exists(path))
        {
            return path;
        }

        var directory = Path.GetDirectoryName(path) ?? "";
        var stem = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);
        for (var i = 2; i < 1000; i++)
        {
            var candidate = Path.Combine(directory, $"{stem}-{i}{ext}");
            if (!File.Exists(candidate))
            {
                return candidate;
            }
        }

        return Path.Combine(directory, $"{stem}-{DateTime.Now:HHmmss}{ext}");
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? "signed-certificate.pdf" : cleaned;
    }
}
