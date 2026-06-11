using System.Net.Http;
using System.Text.Json;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class DocaCertificateEnrichService
{
    private const string Collection = "docaCertificates";

    private readonly FirestoreDocumentClient _documents;
    private readonly FirebaseStorageUploadService _storage;
    private readonly HttpClient _http = new();

    public DocaCertificateEnrichService(FirebaseSettings firebaseSettings)
    {
        _documents = new FirestoreDocumentClient(firebaseSettings);
        _storage = new FirebaseStorageUploadService(firebaseSettings);
    }

    public async Task<List<DocaCertificateSummary>> ListCertificatesAsync(
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var rows = await _documents.ListCollectionAsync(Collection, idToken, cancellationToken);
        return rows
            .Select(row => MapSummary(row.Id, row.Fields))
            .OrderByDescending(row => row.GenerateCertificate)
            .ToList();
    }

    public bool ShouldSkipEnrich(DocaCertificateSummary summary) =>
        string.Equals(summary.PdfParseStatus, "ok", StringComparison.OrdinalIgnoreCase)
        && summary.PdfParserVersion >= GatcCertificatePdfExtract.ParserVersion;

    public async Task<GatcCertificatePdfExtract> EnrichCertificateAsync(
        DocaCertificateSummary summary,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(summary.CertificatePdfPath)
            && string.IsNullOrWhiteSpace(summary.CertificatePdfUrl))
        {
            var missingPdf = new GatcCertificatePdfExtract
            {
                ParseStatus = "failed",
                ParseError = "Certificate PDF path is missing.",
                ParsedAt = DateTimeOffset.UtcNow.ToString("O"),
                ParserVersionValue = GatcCertificatePdfExtract.ParserVersion,
            };
            await SaveExtractAsync(summary.Id, missingPdf, idToken, cancellationToken);
            return missingPdf;
        }

        byte[] pdfBytes;
        try
        {
            pdfBytes = !string.IsNullOrWhiteSpace(summary.CertificatePdfPath)
                ? await _storage.DownloadFileAsync(summary.CertificatePdfPath, idToken, cancellationToken)
                : await DownloadFromUrlAsync(summary.CertificatePdfUrl, cancellationToken);
        }
        catch (Exception ex)
        {
            var downloadFailed = new GatcCertificatePdfExtract
            {
                ParseStatus = "failed",
                ParseError = $"Could not download PDF: {ex.Message}",
                ParsedAt = DateTimeOffset.UtcNow.ToString("O"),
                ParserVersionValue = GatcCertificatePdfExtract.ParserVersion,
            };
            await SaveExtractAsync(summary.Id, downloadFailed, idToken, cancellationToken);
            return downloadFailed;
        }

        var extract = GatcCertificatePdfParser.Parse(pdfBytes);
        await SaveExtractAsync(summary.Id, extract, idToken, cancellationToken);
        return extract;
    }

    public async Task SaveExtractAsync(
        string documentId,
        GatcCertificatePdfExtract extract,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        await _documents.PatchFieldsAsync(
            Collection,
            documentId,
            new Dictionary<string, object?>
            {
                ["pdfExtract"] = extract.ToFirestoreMap(),
            },
            idToken,
            cancellationToken);
    }

    private async Task<byte[]> DownloadFromUrlAsync(string url, CancellationToken cancellationToken)
    {
        using var response = await _http.GetAsync(url, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"HTTP {(int)response.StatusCode} downloading PDF.");
        }

        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    private static DocaCertificateSummary MapSummary(string id, Dictionary<string, JsonElement> fields)
    {
        var pdfExtract = FirestoreDocumentClient.ReadMapFields(fields, "pdfExtract");
        return new DocaCertificateSummary
        {
            Id = id,
            GenerateCertificate = FirestoreDocumentClient.ReadString(fields, "generateCertificate") ?? string.Empty,
            CertificatePdfPath = FirestoreDocumentClient.ReadString(fields, "certificatePdfPath") ?? string.Empty,
            CertificatePdfUrl = FirestoreDocumentClient.ReadString(fields, "certificatePdfUrl") ?? string.Empty,
            PdfParseStatus = FirestoreDocumentClient.ReadString(pdfExtract, "parseStatus") ?? string.Empty,
            PdfParserVersion = FirestoreDocumentClient.ReadInt(pdfExtract, "parserVersion"),
        };
    }
}
