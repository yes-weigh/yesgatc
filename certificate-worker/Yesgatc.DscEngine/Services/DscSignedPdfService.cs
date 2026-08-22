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

    public async Task<DscCertificateRecord> SignAndUploadAsync(
        DscCertificateRecord record,
        DscTokenSession token,
        FirebaseSignInResult session,
        CancellationToken cancellationToken = default)
    {
        if (record.IsVoided)
        {
            throw new InvalidOperationException($"{record.CertificateNumber} is voided.");
        }

        if (record.SignStatus == DscSignStatus.Signed)
        {
            throw new InvalidOperationException($"{record.CertificateNumber} is already signed.");
        }

        var unsigned = await DownloadUnsignedPdfAsync(record, session.IdToken, cancellationToken);
        if (unsigned.Length > 20 * 1024 * 1024)
        {
            throw new InvalidOperationException("Certificate PDF is larger than 20 MB.");
        }

        var signed = _signer.SignVisible(unsigned, token, record);
        var localDir = WorkerDataPaths.CertificatePdfDirectory(record.Id);
        var localName = SanitizeFileName($"{record.CertificateNumber}_signed.pdf");
        var localPath = Path.Combine(localDir, localName);
        await File.WriteAllBytesAsync(localPath, signed, cancellationToken);

        var storagePath =
            $"siteCalibrations/{record.Id}/signed-certificate/{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.pdf";
        var upload = await _storage.UploadPdfBytesAsync(
            storagePath,
            signed,
            session.IdToken,
            localName,
            cancellationToken);

        var uploadedAt = DateTime.UtcNow.ToString("o");
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

        return record.WithSignedPdf(upload.DownloadUrl);
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

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? "signed-certificate.pdf" : cleaned;
    }
}
