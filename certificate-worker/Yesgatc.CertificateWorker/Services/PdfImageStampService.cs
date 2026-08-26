using System.IO;
using System.Net.Http;
using PdfSharp.Drawing;
using PdfSharp.Pdf.IO;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

internal enum PdfStampOutcome
{
    Uploaded,
    SkippedAlreadySigned,
    SkippedNotPdfSigner,
    SkippedDead,
    MissingUnsignedPdf,
}

internal sealed class PdfImageStampService
{
    private readonly HttpClient _http = new();
    private readonly FirestoreDocumentClient _documents;
    private readonly FirebaseStorageUploadService _storage;

    public PdfImageStampService(FirebaseSettings firebase)
    {
        _documents = new FirestoreDocumentClient(firebase);
        _storage = new FirebaseStorageUploadService(firebase);
    }

    public async Task<string> StampAndSaveLocalAsync(
        SiteCalibrationRecord job,
        string idToken,
        string destinationDirectory,
        CancellationToken cancellationToken = default)
    {
        var stamped = await StampBytesAsync(job, idToken, cancellationToken);
        Directory.CreateDirectory(destinationDirectory);
        var path = UniquePath(Path.Combine(destinationDirectory, SuggestedSignedFileName(job)));
        await File.WriteAllBytesAsync(path, stamped, cancellationToken);
        return path;
    }

    public async Task<PdfStampOutcome> StampAndUploadAsync(
        SiteCalibrationRecord job,
        string idToken,
        string uploadedByUid,
        CancellationToken cancellationToken = default)
    {
        var latest = await LoadLatestAsync(job, idToken, cancellationToken);
        var skip = Precheck(
            latest.IsVoided,
            latest.IsSuperseded,
            alreadySigned: HasSignedPdf(latest),
            isPdfSignerRc: await IsPdfSignerRcAsync(latest.RcId, idToken, cancellationToken));
        if (skip is not null)
        {
            return skip.Value;
        }

        byte[] stamped;
        try
        {
            stamped = await StampBytesAsync(latest, idToken, cancellationToken);
        }
        catch (InvalidOperationException ex) when (
            ex.Message.Contains("No unsigned PDF", StringComparison.OrdinalIgnoreCase))
        {
            return PdfStampOutcome.MissingUnsignedPdf;
        }

        var again = await LoadLatestAsync(latest, idToken, cancellationToken);
        if (HasSignedPdf(again))
        {
            return PdfStampOutcome.SkippedAlreadySigned;
        }

        var localName = SuggestedSignedFileName(again);
        var localDir = WorkerDataPaths.CertificatePdfDirectory(again.Id);
        await File.WriteAllBytesAsync(Path.Combine(localDir, localName), stamped, cancellationToken);

        var storagePath =
            $"siteCalibrations/{again.Id}/signed-certificate/{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.pdf";
        var upload = await _storage.UploadPdfBytesAsync(
            storagePath,
            stamped,
            idToken,
            localName,
            cancellationToken);

        var uploadedAt = DateTime.UtcNow.ToString("o");
        await _documents.PatchStringFieldsAsync(
            "siteCalibrations",
            again.Id,
            new Dictionary<string, string>
            {
                ["signedCertificatePdfUrl"] = upload.DownloadUrl,
                ["signedCertificatePdfPath"] = upload.StoragePath,
                ["signedCertificatePdfName"] = upload.FileName,
                ["signedCertificatePdfContentType"] = "application/pdf",
                ["signedCertificateUploadedAt"] = uploadedAt,
                ["signedCertificateUploadedByUid"] = uploadedByUid,
                ["updatedAt"] = uploadedAt,
            },
            idToken,
            cancellationToken);

        return PdfStampOutcome.Uploaded;
    }

    internal static PdfStampOutcome? Precheck(
        bool voided,
        bool superseded,
        bool alreadySigned,
        bool isPdfSignerRc)
    {
        if (voided || superseded)
        {
            return PdfStampOutcome.SkippedDead;
        }

        if (alreadySigned)
        {
            return PdfStampOutcome.SkippedAlreadySigned;
        }

        if (!isPdfSignerRc)
        {
            return PdfStampOutcome.SkippedNotPdfSigner;
        }

        return null;
    }

    private async Task<SiteCalibrationRecord> LoadLatestAsync(
        SiteCalibrationRecord job,
        string idToken,
        CancellationToken cancellationToken)
    {
        var fields = await _documents.GetFieldsAsync("siteCalibrations", job.Id, idToken, cancellationToken);
        return new SiteCalibrationRecord
        {
            Id = job.Id,
            RcId = FirstNonEmpty(FirestoreFieldReader.ReadString(fields, "rcId"), job.RcId),
            RcCenterName = job.RcCenterName,
            Status = FirstNonEmpty(FirestoreFieldReader.ReadString(fields, "status"), job.Status),
            VerificationType = job.VerificationType,
            CustomerName = job.CustomerName,
            ProductName = job.ProductName,
            SerialNumber = FirstNonEmpty(
                FirestoreFieldReader.ReadString(fields, "serialNumber"),
                job.SerialNumber),
            CertificateNumber = FirstNonEmpty(
                FirestoreFieldReader.ReadString(fields, "certificateNumber"),
                job.CertificateNumber ?? ""),
            CertificatePdfUrl = FirestoreFieldReader.ReadString(fields, "certificatePdfUrl"),
            CertificatePdfPath = FirestoreFieldReader.ReadString(fields, "certificatePdfPath"),
            SignedCertificatePdfUrl = FirestoreFieldReader.ReadString(fields, "signedCertificatePdfUrl"),
            SignedCertificatePdfPath = FirestoreFieldReader.ReadString(fields, "signedCertificatePdfPath"),
            CertificateVoidedAt = FirestoreFieldReader.ReadString(fields, "certificateVoidedAt"),
            SupersededByResubmissionId = FirestoreFieldReader.ReadString(fields, "supersededByResubmissionId"),
            EmaapSignedPdfUploadedAt = FirestoreFieldReader.ReadString(fields, "emaapSignedPdfUploadedAt"),
        };
    }

    private async Task<bool> IsPdfSignerRcAsync(
        string rcId,
        string idToken,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(rcId))
        {
            return false;
        }

        var fields = await _documents.GetFieldsAsync("users", rcId, idToken, cancellationToken);
        return RcCertificationMethods.IsPdfSigner(
            FirestoreFieldReader.ReadString(fields, "certificationMethod"));
    }

    private static bool HasSignedPdf(SiteCalibrationRecord job) =>
        !string.IsNullOrWhiteSpace(job.SignedCertificatePdfUrl)
        || !string.IsNullOrWhiteSpace(job.SignedCertificatePdfPath);

    private static string FirstNonEmpty(string? a, string b) =>
        !string.IsNullOrWhiteSpace(a) ? a.Trim() : b;

    public async Task ClearSignedPdfAsync(
        string jobId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId))
        {
            throw new InvalidOperationException("Job id is required to clear a signed PDF.");
        }

        var fields = await _documents.GetFieldsAsync("siteCalibrations", jobId, idToken, cancellationToken);
        var path = FirestoreFieldReader.ReadString(fields, "signedCertificatePdfPath");
        if (string.IsNullOrWhiteSpace(path))
        {
            path = UnsignedCertificatePdfCleanup.TryParseStoragePath(
                FirestoreFieldReader.ReadString(fields, "signedCertificatePdfUrl")) ?? "";
        }

        if (IsSafeSignedStoragePath(path, jobId))
        {
            await _storage.TryDeleteFileAsync(path, idToken, cancellationToken);
        }

        var updatedAt = DateTime.UtcNow.ToString("o");
        await _documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            new Dictionary<string, string>
            {
                ["signedCertificatePdfUrl"] = "",
                ["signedCertificatePdfPath"] = "",
                ["signedCertificatePdfName"] = "",
                ["signedCertificatePdfContentType"] = "",
                ["signedCertificateUploadedAt"] = "",
                ["signedCertificateUploadedByUid"] = "",
                ["updatedAt"] = updatedAt,
            },
            idToken,
            cancellationToken);
    }

    public async Task<string> DownloadPdfAsync(
        SiteCalibrationRecord job,
        string idToken,
        string destinationPath,
        bool preferSigned = true,
        CancellationToken cancellationToken = default)
    {
        byte[] bytes;
        if (preferSigned
            && (!string.IsNullOrWhiteSpace(job.SignedCertificatePdfUrl)
                || !string.IsNullOrWhiteSpace(job.SignedCertificatePdfPath)))
        {
            bytes = await DownloadSignedPdfAsync(job, idToken, cancellationToken);
        }
        else
        {
            bytes = await DownloadUnsignedPdfAsync(job, idToken, cancellationToken);
        }

        var directory = Path.GetDirectoryName(destinationPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllBytesAsync(destinationPath, bytes, cancellationToken);
        return destinationPath;
    }

    public static string SuggestedFileName(SiteCalibrationRecord job, bool signed)
    {
        var stem = string.IsNullOrWhiteSpace(job.CertificateNumber)
            ? job.SerialNumber
            : job.CertificateNumber;
        return SanitizeFileName(signed ? $"{stem}_signed.pdf" : $"{stem}.pdf");
    }

    public static string SuggestedSignedFileName(SiteCalibrationRecord job) =>
        SuggestedFileName(job, signed: true);

    private async Task<byte[]> StampBytesAsync(
        SiteCalibrationRecord job,
        string idToken,
        CancellationToken cancellationToken)
    {
        if (job.IsVoided)
        {
            throw new InvalidOperationException($"{job.CertificateNumber} is voided.");
        }

        var unsigned = await DownloadUnsignedPdfAsync(job, idToken, cancellationToken);
        var signaturePng = SignatureImagePrep.KnockOutWhite(
            await DownloadRcSignatureImageAsync(job.RcId, idToken, cancellationToken));
        return Stamp(unsigned, signaturePng);
    }

    internal static byte[] Stamp(byte[] unsignedPdf, byte[] signaturePng)
    {
        var rect = PdfOfficerStampAnchor.Find(unsignedPdf);
        using var input = new MemoryStream(unsignedPdf, writable: false);
        using var output = new MemoryStream();
        var document = PdfReader.Open(input, PdfDocumentOpenMode.Modify);
        try
        {
            var page = document.Pages[document.PageCount - 1];
            var pageHeight = (float)page.Height.Point;
            var pageWidth = (float)page.Width.Point;
            rect ??= PdfOfficerStampAnchor.FallbackBottomRight(0, 0, pageWidth, pageHeight);

            using var imageStream = new MemoryStream(signaturePng, writable: false);
            using var image = XImage.FromStream(imageStream);
            var imgW = image.PointWidth;
            var imgH = image.PointHeight;
            if (imgW <= 0 || imgH <= 0)
            {
                throw new InvalidOperationException("Officer signature image has no size.");
            }

            var scale = Math.Min(rect.Value.Width / imgW, rect.Value.Height / imgH);
            var drawW = imgW * scale;
            var drawH = imgH * scale;
            var pdfX = rect.Value.X + PdfOfficerStampAnchor.ImageOffsetX;
            pdfX = (float)Math.Clamp(pdfX, 8, pageWidth - drawW - 4);
            var pdfY = rect.Value.Y;
            var gfxX = pdfX;
            var gfxY = pageHeight - (pdfY + drawH);

            using (var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append))
            {
                gfx.DrawImage(image, gfxX, gfxY, drawW, drawH);
            }

            document.Save(output, closeStream: false);
        }
        finally
        {
            document.Close();
        }

        return output.ToArray();
    }

    private async Task<byte[]> DownloadRcSignatureImageAsync(
        string rcId,
        string idToken,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(rcId))
        {
            throw new InvalidOperationException("RC id is missing for this job.");
        }

        var fields = await _documents.GetFieldsAsync("users", rcId, idToken, cancellationToken);
        var path = FirestoreFieldReader.ReadString(fields, "pdfSignerSignPath");
        var url = FirestoreFieldReader.ReadString(fields, "pdfSignerSignUrl");
        if (!string.IsNullOrWhiteSpace(path))
        {
            try
            {
                return await _storage.DownloadFileAsync(path, idToken, cancellationToken);
            }
            catch
            {
            }
        }

        if (!string.IsNullOrWhiteSpace(url))
        {
            var fromUrl = await TryDownloadUrlAsync(url, idToken, cancellationToken);
            if (fromUrl is not null)
            {
                return fromUrl;
            }
        }

        throw new InvalidOperationException(
            "RC has no officer signature image. Super Admin → Regional Centers → PDF signer upload.");
    }

    private async Task<byte[]> DownloadUnsignedPdfAsync(
        SiteCalibrationRecord job,
        string idToken,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(job.CertificatePdfPath))
        {
            try
            {
                return await _storage.DownloadFileAsync(job.CertificatePdfPath, idToken, cancellationToken);
            }
            catch
            {
            }
        }

        if (!string.IsNullOrWhiteSpace(job.CertificatePdfUrl))
        {
            var fromUrl = await TryDownloadUrlAsync(job.CertificatePdfUrl, idToken, cancellationToken);
            if (fromUrl is not null)
            {
                return fromUrl;
            }
        }

        throw new InvalidOperationException(
            $"No unsigned PDF for {job.CertificateNumber}. Wait for eMAAP PDF sync.");
    }

    private async Task<byte[]> DownloadSignedPdfAsync(
        SiteCalibrationRecord job,
        string idToken,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(job.SignedCertificatePdfPath))
        {
            try
            {
                return await _storage.DownloadFileAsync(job.SignedCertificatePdfPath, idToken, cancellationToken);
            }
            catch
            {
            }
        }

        if (!string.IsNullOrWhiteSpace(job.SignedCertificatePdfUrl))
        {
            var fromUrl = await TryDownloadUrlAsync(job.SignedCertificatePdfUrl, idToken, cancellationToken);
            if (fromUrl is not null)
            {
                return fromUrl;
            }
        }

        return await DownloadUnsignedPdfAsync(job, idToken, cancellationToken);
    }

    private async Task<byte[]?> TryDownloadUrlAsync(
        string url,
        string idToken,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", idToken);
        using var response = await _http.SendAsync(request, cancellationToken);
        if (response.IsSuccessStatusCode)
        {
            return await response.Content.ReadAsByteArrayAsync(cancellationToken);
        }

        using var retry = new HttpRequestMessage(HttpMethod.Get, url);
        using var fallback = await _http.SendAsync(retry, cancellationToken);
        if (!fallback.IsSuccessStatusCode)
        {
            return null;
        }

        return await fallback.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    internal static bool IsSafeSignedStoragePath(string? path, string jobId)
    {
        var trimmed = path?.Trim().Replace('\\', '/');
        if (string.IsNullOrWhiteSpace(trimmed) || string.IsNullOrWhiteSpace(jobId))
        {
            return false;
        }

        var prefix = $"siteCalibrations/{jobId.Trim()}/signed-certificate/";
        return trimmed.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    internal static string UniquePath(string path)
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
        return string.IsNullOrWhiteSpace(cleaned) ? "certificate.pdf" : cleaned;
    }
}
