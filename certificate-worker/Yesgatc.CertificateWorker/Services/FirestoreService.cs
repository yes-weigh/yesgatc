using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
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

    /// <summary>Single production stage: Submitted → eMAAP fill+certify → PDF → Firebase certified.</summary>
    public async Task<IReadOnlyList<SiteCalibrationRecord>> GetPendingCertificationQueueAsync(
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var submitted = await GetAllSubmittedVerificationsAsync(idToken, cancellationToken);
        return CertificationQueueFilter.Apply(submitted);
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

    /// <summary>Pretty-print all fields on a siteCalibrations document for the worker detail pane.</summary>
    public async Task<string> FormatSiteCalibrationDocumentAsync(
        string jobId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId))
        {
            return "No document selected.";
        }

        var documents = new FirestoreDocumentClient(_settings);
        Dictionary<string, JsonElement> fields;
        try
        {
            fields = await documents.GetFieldsAsync(
                "siteCalibrations",
                jobId,
                idToken,
                cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return $"Could not load siteCalibrations/{jobId}\n{ex.Message}";
        }

        var lines = new List<string>
        {
            $"siteCalibrations/{jobId}",
            new string('─', 48),
        };

        foreach (var key in fields.Keys.OrderBy(k => k, StringComparer.OrdinalIgnoreCase))
        {
            lines.Add($"{key}: {FormatFirestoreValue(fields[key])}");
        }

        return string.Join(Environment.NewLine, lines);
    }

    private static string FormatFirestoreValue(JsonElement element, int depth = 0)
    {
        if (element.TryGetProperty("stringValue", out var s))
        {
            return s.GetString() ?? string.Empty;
        }

        if (element.TryGetProperty("integerValue", out var i))
        {
            return i.GetString() ?? i.ToString();
        }

        if (element.TryGetProperty("doubleValue", out var d))
        {
            return d.GetDouble().ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        if (element.TryGetProperty("booleanValue", out var b))
        {
            return b.GetBoolean() ? "true" : "false";
        }

        if (element.TryGetProperty("timestampValue", out var ts))
        {
            return ts.GetString() ?? string.Empty;
        }

        if (element.TryGetProperty("nullValue", out _))
        {
            return "null";
        }

        if (element.TryGetProperty("referenceValue", out var rf))
        {
            return rf.GetString() ?? string.Empty;
        }

        if (element.TryGetProperty("arrayValue", out var arr)
            && arr.TryGetProperty("values", out var values))
        {
            var parts = values.EnumerateArray().Select(v => FormatFirestoreValue(v, depth + 1));
            return "[" + string.Join(", ", parts) + "]";
        }

        if (element.TryGetProperty("mapValue", out var map)
            && map.TryGetProperty("fields", out var mapFields))
        {
            var indent = new string(' ', (depth + 1) * 2);
            var parts = mapFields.EnumerateObject()
                .OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
                .Select(p => $"{Environment.NewLine}{indent}{p.Name}: {FormatFirestoreValue(p.Value, depth + 1)}");
            return "{" + string.Join("", parts) + Environment.NewLine + new string(' ', depth * 2) + "}";
        }

        return element.ToString();
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
        var fields = new Dictionary<string, object?>
        {
            ["status"] = VerificationStatuses.Certified,
            ["certifiedAt"] = now,
            ["updatedAt"] = now,
            // Clear prior failure markers so UI leaves Failed at submit / Rejected buckets.
            ["pipelineFailedPhase"] = null,
            ["pipelineFailureMessage"] = null,
            ["pipelineFailedAt"] = null,
            ["certificationLastError"] = null,
            ["emaapIssuedCertificateNumber"] = null,
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
        await documents.PatchFieldsAsync(
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
        if (verification is null || !verification.IsSubmitted || verification.IsRejected)
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

        var pendingCert = TryExtractEmaapCertificateNumber(trimmed);
        if (!string.IsNullOrWhiteSpace(pendingCert))
        {
            fields["emaapIssuedCertificateNumber"] = pendingCert;
        }

        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            fields,
            idToken,
            cancellationToken);
    }

    /// <summary>
    /// Permanent data failure — status=rejected. Worker will not pick the job again.
    /// </summary>
    public async Task RecordRejectionAsync(
        string jobId,
        string error,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId) || string.IsNullOrWhiteSpace(error))
        {
            return;
        }

        var verification = await GetVerificationByIdAsync(jobId, idToken, cancellationToken);
        if (verification is null || verification.IsCertified || verification.IsRejected)
        {
            return;
        }

        var now = DateTime.UtcNow.ToString("O");
        var trimmed = error.Trim()[..Math.Min(error.Trim().Length, 500)];
        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            new Dictionary<string, string>
            {
                ["status"] = VerificationStatuses.Rejected,
                ["pipelineFailedPhase"] = "submit",
                ["pipelineFailureMessage"] = trimmed,
                ["pipelineFailedAt"] = now,
                ["rejectedAt"] = now,
                ["updatedAt"] = now,
            },
            idToken,
            cancellationToken);
    }

    public async Task SetEmaapIssuedCertificateNumberAsync(
        string jobId,
        string certificateNumber,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(jobId) || string.IsNullOrWhiteSpace(certificateNumber))
        {
            return;
        }

        var now = DateTime.UtcNow.ToString("O");
        var documents = new FirestoreDocumentClient(_settings);
        await documents.PatchStringFieldsAsync(
            "siteCalibrations",
            jobId,
            new Dictionary<string, string>
            {
                ["emaapIssuedCertificateNumber"] = certificateNumber.Trim(),
                ["updatedAt"] = now,
            },
            idToken,
            cancellationToken);
    }

    public static string? TryExtractEmaapCertificateNumber(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var m = Regex.Match(
            text,
            @"IND\s*/\s*GATC\s*/\s*KL\s*/\s*26\s*/\s*04\s*/\s*26\s*/\s*(\d+)",
            RegexOptions.IgnoreCase);
        if (!m.Success)
        {
            return null;
        }

        return $"IND/GATC/KL/26/04/26/{m.Groups[1].Value}";
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
            CertificateNumber = FirestoreFieldReader.ReadString(fields, "certificateNumber"),
            EmaapIssuedCertificateNumber = FirestoreFieldReader.ReadString(fields, "emaapIssuedCertificateNumber"),
            PipelineFailedPhase = FirestoreFieldReader.ReadString(fields, "pipelineFailedPhase"),
            PipelineFailureMessage = FirestoreFieldReader.ReadString(fields, "pipelineFailureMessage"),
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
