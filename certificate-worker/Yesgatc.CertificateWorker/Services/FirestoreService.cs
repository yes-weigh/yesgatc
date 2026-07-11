using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class FirestoreService
{
    private readonly HttpClient _http = new();
    private readonly FirebaseSettings _settings;

    public FirestoreService(FirebaseSettings settings)
    {
        _settings = settings;
    }

    public Task<IReadOnlyList<SiteCalibrationRecord>> GetAllSubmittedVerificationsAsync(
        string idToken,
        CancellationToken cancellationToken = default) =>
        GetVerificationsByStatusAsync("submitted", idToken, cancellationToken);

    public Task<IReadOnlyList<SiteCalibrationRecord>> GetAllApprovedVerificationsAsync(
        string idToken,
        CancellationToken cancellationToken = default) =>
        GetVerificationsByStatusAsync("approved", idToken, cancellationToken);

    public async Task<IReadOnlyList<SiteCalibrationRecord>> GetPendingCertificationQueueAsync(
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var submitted = await GetAllSubmittedVerificationsAsync(idToken, cancellationToken);
        var approved = await GetAllApprovedVerificationsAsync(idToken, cancellationToken);

        return CertificationQueueFilter.Apply(submitted.Concat(approved));
    }

    public async Task<SiteCalibrationRecord?> GetVerificationByIdAsync(
        string jobId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId))
        {
            return null;
        }

        var rcNames = await GetRcCenterNamesAsync(idToken, cancellationToken);
        var documents = new FirestoreDocumentClient(_settings);

        try
        {
            var fields = await documents.GetFieldsAsync(
                "siteCalibrations",
                jobId,
                idToken,
                cancellationToken);
            return MapFromFields(jobId, fields, rcNames);
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    public async Task ApproveVerificationAsync(
        string jobId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow.ToString("O");
        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            new Dictionary<string, string>
            {
                ["status"] = "approved",
                ["approvedAt"] = now,
                ["updatedAt"] = now,
            },
            idToken,
            cancellationToken);
    }

    public async Task MarkCertifiedAsync(
        string jobId,
        string idToken,
        CertificatePdfUploadResult? certificatePdf = null,
        string? certificateNumber = null,
        CancellationToken cancellationToken = default)
    {
        var verification = await GetVerificationByIdAsync(jobId, idToken, cancellationToken);
        var resubmittedFromId = verification?.ResubmittedFromId?.Trim();

        var now = DateTime.UtcNow.ToString("O");
        var fields = new Dictionary<string, string>
        {
            ["status"] = VerificationStatuses.Certified,
            ["certifiedAt"] = now,
            ["updatedAt"] = now,
        };

        if (certificatePdf is not null)
        {
            fields["certificatePdfUrl"] = certificatePdf.DownloadUrl;
            fields["certificatePdfPath"] = certificatePdf.StoragePath;
            fields["certificatePdfName"] = certificatePdf.FileName;
            fields["certificatePdfContentType"] = certificatePdf.ContentType;
        }

        if (!string.IsNullOrWhiteSpace(certificateNumber))
        {
            fields["certificateNumber"] = certificateNumber.Trim();
        }

        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            fields,
            idToken,
            cancellationToken);

        if (!string.IsNullOrWhiteSpace(resubmittedFromId))
        {
            await VoidSupersededCertificateAsync(resubmittedFromId, idToken, cancellationToken);
        }
    }

    /// <summary>
    /// Voids the source verification when a DOCA resubmission finishes certifying.
    /// </summary>
    public async Task VoidSupersededCertificateAsync(
        string recordId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(recordId))
        {
            return;
        }

        var now = DateTime.UtcNow.ToString("O");
        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            recordId,
            new Dictionary<string, string>
            {
                ["certificateVoidedAt"] = now,
                ["certificateVoidReason"] = "resubmit_superseded",
                ["updatedAt"] = now,
            },
            idToken,
            cancellationToken);
    }

    public async Task MarkCertifiedWithSignedPdfAsync(
        string jobId,
        string signedPdfPath,
        string idToken,
        string? certificateNumber = null,
        CancellationToken cancellationToken = default)
    {
        var uploader = new FirebaseStorageUploadService(_settings);
        var certificatePdf = await uploader.UploadCertificatePdfAsync(
            jobId,
            signedPdfPath,
            idToken,
            cancellationToken);

        await MarkCertifiedAsync(
            jobId,
            idToken,
            certificatePdf,
            certificateNumber,
            cancellationToken);
    }

    public async Task UpdateVerificationStatusAsync(
        string jobId,
        string newStatus,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var normalized = VerificationStatuses.Normalize(newStatus);
        var now = DateTime.UtcNow.ToString("O");
        var fields = new Dictionary<string, string>
        {
            ["status"] = normalized,
            ["updatedAt"] = now,
        };

        switch (normalized)
        {
            case VerificationStatuses.Submitted:
                fields["submittedAt"] = now;
                break;
            case VerificationStatuses.Approved:
                fields["approvedAt"] = now;
                break;
            case VerificationStatuses.Certified:
                fields["certifiedAt"] = now;
                break;
        }

        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            fields,
            idToken,
            cancellationToken);
    }

    public async Task RecordSubmitFailureAsync(
        string jobId,
        string error,
        string idToken,
        bool retryExhausted = false,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId) || string.IsNullOrWhiteSpace(error) || !retryExhausted)
        {
            return;
        }

        var verification = await GetVerificationByIdAsync(jobId, idToken, cancellationToken);
        if (verification is null || !verification.IsSubmitted)
        {
            return;
        }

        var now = DateTime.UtcNow.ToString("O");
        var trimmed = error.Trim()[..Math.Min(error.Trim().Length, 500)];
        var fields = new Dictionary<string, string>
        {
            ["pipelineFailedPhase"] = "submit",
            ["pipelineFailureMessage"] = trimmed,
            ["pipelineFailedAt"] = now,
            ["updatedAt"] = now,
        };

        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            fields,
            idToken,
            cancellationToken);
    }

    public async Task RecordCertificationFailureAsync(
        string jobId,
        string error,
        string idToken,
        bool retryExhausted = false,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId) || string.IsNullOrWhiteSpace(error))
        {
            return;
        }

        var verification = await GetVerificationByIdAsync(jobId, idToken, cancellationToken);
        if (verification is null || verification.IsSubmitted || verification.IsCertified)
        {
            return;
        }

        var now = DateTime.UtcNow.ToString("O");
        var trimmed = error.Trim()[..Math.Min(error.Trim().Length, 500)];
        var fields = new Dictionary<string, string>
        {
            ["certificationLastError"] = trimmed,
            ["updatedAt"] = now,
        };

        if (retryExhausted)
        {
            fields["pipelineFailedPhase"] = "certification";
            fields["pipelineFailureMessage"] = trimmed;
            fields["pipelineFailedAt"] = now;
        }

        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            fields,
            idToken,
            cancellationToken);
    }

    public async Task TouchCertificationAsync(
        string jobId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow.ToString("O");
        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            new Dictionary<string, string> { ["updatedAt"] = now },
            idToken,
            cancellationToken);
    }

    private async Task<IReadOnlyList<SiteCalibrationRecord>> GetVerificationsByStatusAsync(
        string status,
        string idToken,
        CancellationToken cancellationToken)
    {
        var rcNames = await GetRcCenterNamesAsync(idToken, cancellationToken);
        var rows = await RunQueryAsync(
            new StructuredQuery(
                [new CollectionSelector("siteCalibrations")],
                new QueryFilter(
                    new FieldFilter(
                        new FieldReference("status"),
                        "EQUAL",
                        new FirestoreValue { StringValue = status }))),
            idToken,
            cancellationToken);

        return rows
            .Where(row => row.Document is not null)
            .Select(row => MapDocument(row.Document!, rcNames))
            .OrderByDescending(record => status == "approved"
                ? record.ApprovedAt ?? record.SubmittedAt ?? record.Id
                : record.SubmittedAt ?? record.Id)
            .ToList();
    }

    private async Task<Dictionary<string, string>> GetRcCenterNamesAsync(
        string idToken,
        CancellationToken cancellationToken)
    {
        var rows = await RunQueryAsync(
            new StructuredQuery(
                [new CollectionSelector("users")],
                new QueryFilter(
                    new FieldFilter(
                        new FieldReference("role"),
                        "EQUAL",
                        new FirestoreValue { StringValue = "rc_admin" }))),
            idToken,
            cancellationToken);

        var names = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var row in rows)
        {
            if (row.Document?.Name is null)
            {
                continue;
            }

            var uid = row.Document.Name.Split('/').LastOrDefault();
            if (string.IsNullOrWhiteSpace(uid))
            {
                continue;
            }

            var fields = row.Document.Fields ?? new Dictionary<string, JsonElement>();
            var label = FirstNonEmpty(
                FirestoreFieldReader.ReadString(fields, "companyName"),
                FirestoreFieldReader.ReadString(fields, "username"),
                uid);
            names[uid] = label;
        }

        return names;
    }

    private async Task<List<RunQueryRow>> RunQueryAsync(
        StructuredQuery structuredQuery,
        string idToken,
        CancellationToken cancellationToken)
    {
        var url =
            $"https://firestore.googleapis.com/v1/projects/{_settings.ProjectId}/databases/(default)/documents:runQuery";

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        request.Content = JsonContent.Create(new RunQueryRequest(structuredQuery));

        using var response = await _http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            _ = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Could not load verifications from Firestore ({(int)response.StatusCode}). Check your connection and try Refresh.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        return await JsonSerializer.DeserializeAsync<List<RunQueryRow>>(stream, cancellationToken: cancellationToken)
            ?? [];
    }

    private static SiteCalibrationRecord MapDocument(
        FirestoreDocument document,
        IReadOnlyDictionary<string, string> rcNames)
    {
        var id = document.Name?.Split('/').LastOrDefault() ?? string.Empty;
        var fields = document.Fields ?? new Dictionary<string, JsonElement>();
        return MapFromFields(id, fields, rcNames);
    }

    private static SiteCalibrationRecord MapFromFields(
        string id,
        IReadOnlyDictionary<string, JsonElement> fields,
        IReadOnlyDictionary<string, string> rcNames)
    {
        var rcId = FirestoreFieldReader.ReadString(fields, "rcId");

        return new SiteCalibrationRecord
        {
            Id = id,
            RcId = rcId,
            RcCenterName = rcNames.TryGetValue(rcId, out var name) ? name : "—",
            Status = FirestoreFieldReader.ReadString(fields, "status", "draft"),
            VerificationType = FirestoreFieldReader.ReadString(fields, "verificationType"),
            CustomerName = FirestoreFieldReader.ReadString(fields, "customerName"),
            ProductName = FirestoreFieldReader.ReadString(fields, "productName"),
            SerialNumber = FirestoreFieldReader.ReadString(fields, "serialNumber"),
            SubmittedAt = FirestoreFieldReader.ReadString(fields, "submittedAt"),
            ApprovedAt = FirestoreFieldReader.ReadString(fields, "approvedAt"),
            CertifiedAt = FirestoreFieldReader.ReadString(fields, "certifiedAt"),
            CertificatePdfUrl = FirestoreFieldReader.ReadString(fields, "certificatePdfUrl"),
            ResubmittedFromId = FirestoreFieldReader.ReadString(fields, "resubmittedFromId"),
            SupersededByResubmissionId = FirestoreFieldReader.ReadString(fields, "supersededByResubmissionId"),
            CertificateVoidedAt = FirestoreFieldReader.ReadString(fields, "certificateVoidedAt"),
            SealIdentificationNumber = FirestoreFieldReader.ReadString(fields, "sealIdentificationNumber"),
        };
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }

    private sealed record RunQueryRequest([property: JsonPropertyName("structuredQuery")] StructuredQuery StructuredQuery);

    private sealed record StructuredQuery(
        [property: JsonPropertyName("from")] CollectionSelector[] From,
        [property: JsonPropertyName("where")] QueryFilter? Where = null);

    private sealed record CollectionSelector([property: JsonPropertyName("collectionId")] string CollectionId);

    private sealed record QueryFilter(
        [property: JsonPropertyName("fieldFilter")] FieldFilter FieldFilter);

    private sealed record FieldFilter(
        [property: JsonPropertyName("field")] FieldReference Field,
        [property: JsonPropertyName("op")] string Op,
        [property: JsonPropertyName("value")] FirestoreValue Value);

    private sealed record FieldReference([property: JsonPropertyName("fieldPath")] string FieldPath);

    private sealed record RunQueryRow([property: JsonPropertyName("document")] FirestoreDocument? Document);

    private sealed record FirestoreDocument(
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("fields")] Dictionary<string, JsonElement>? Fields);

    private sealed record FirestoreValue
    {
        [property: JsonPropertyName("stringValue")]
        public string? StringValue { get; init; }
    }
}
