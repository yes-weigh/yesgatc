namespace Yesgatc.CertificateWorker.Models;

public sealed class DocaGatcRow
{
    public string GenerateCertificate { get; init; } = string.Empty;
    public string GatcCertificateNo { get; init; } = string.Empty;
    public string InstrumentName { get; init; } = string.Empty;
    public string BelongTo { get; init; } = string.Empty;
    public string ValidityDate { get; init; } = string.Empty;
    public string UploadDate { get; init; } = string.Empty;
    public string CertificateSourceUrl { get; init; } = string.Empty;
    public string PhotoSourceUrl { get; init; } = string.Empty;
}

public sealed class DocaGatcPageParseResult
{
    public IReadOnlyList<DocaGatcRow> Rows { get; init; } = Array.Empty<DocaGatcRow>();
    public int PageStart { get; init; }
    public int PageEnd { get; init; }
    public int TotalEntries { get; init; }
    public bool HasNextPage { get; init; }

    public bool IsLastDataPage => TotalEntries > 0 && PageEnd >= TotalEntries;

    public int PageNumber(int pageSize) =>
        PageStart > 0 && pageSize > 0
            ? ((PageStart - 1) / pageSize) + 1
            : 0;
}

public sealed class DocaScrapeProgressState
{
    public string Status { get; init; } = "idle";
    public string StatusMessage { get; init; } = string.Empty;
    public int CurrentPage { get; init; }
    public int TotalPages { get; init; }
    public int TotalEntries { get; init; }
    public int ProcessedRows { get; init; }
    public int UploadedRows { get; init; }
    public int SkippedRows { get; init; }
    public int FailedRows { get; init; }
    public int CheckpointPage { get; init; }
    public string StartedAt { get; init; } = string.Empty;
    public string LastProgressAt { get; init; } = string.Empty;
    public string LastError { get; init; } = string.Empty;
}
