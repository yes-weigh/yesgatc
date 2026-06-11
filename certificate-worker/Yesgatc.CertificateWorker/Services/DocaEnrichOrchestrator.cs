using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class DocaEnrichOrchestrator
{
    private readonly AutomationSettings _settings;
    private readonly DocaCertificateEnrichService _enrichService;
    private readonly WorkerTelemetryService _telemetry;

    public DocaEnrichOrchestrator(
        AutomationSettings settings,
        DocaCertificateEnrichService enrichService,
        WorkerTelemetryService telemetry)
    {
        _settings = settings;
        _enrichService = enrichService;
        _telemetry = telemetry;
    }

    public Func<Task<string>>? ResolveFirebaseIdToken { get; set; }
    public Func<bool>? IsPauseRequested { get; set; }

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        if (ResolveFirebaseIdToken is null)
        {
            throw new InvalidOperationException("ResolveFirebaseIdToken is required for PDF enrich.");
        }

        var startedAt = DateTimeOffset.UtcNow.ToString("O");
        var processedRows = 0;
        var parsedRows = 0;
        var skippedRows = 0;
        var failedRows = 0;

        try
        {
            await PublishStateAsync(
                "running",
                "Loading scraped certificates from Firebase…",
                0,
                processedRows,
                parsedRows,
                skippedRows,
                failedRows,
                startedAt,
                string.Empty,
                cancellationToken);

            var idToken = await ResolveFirebaseIdToken();
            var certificates = await _enrichService.ListCertificatesAsync(idToken, cancellationToken);
            var totalRows = certificates.Count;

            await PublishStateAsync(
                "running",
                $"Parsing PDF details for {totalRows} certificate(s)…",
                totalRows,
                processedRows,
                parsedRows,
                skippedRows,
                failedRows,
                startedAt,
                string.Empty,
                cancellationToken);

            foreach (var summary in certificates)
            {
                await WaitIfPausedAsync(cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();

                processedRows++;

                if (_enrichService.ShouldSkipEnrich(summary))
                {
                    skippedRows++;
                    await PublishStateAsync(
                        "running",
                        $"Skipped {summary.GenerateCertificate} (already parsed).",
                        totalRows,
                        processedRows,
                        parsedRows,
                        skippedRows,
                        failedRows,
                        startedAt,
                        string.Empty,
                        cancellationToken);
                    continue;
                }

                try
                {
                    var extract = await _enrichService.EnrichCertificateAsync(summary, idToken, cancellationToken);
                    if (string.Equals(extract.ParseStatus, "failed", StringComparison.OrdinalIgnoreCase))
                    {
                        failedRows++;
                        await _telemetry.ReportEnrichActivityAsync(
                            $"Failed to parse {summary.GenerateCertificate}: {extract.ParseError}",
                            "error",
                            ResolveFirebaseIdToken,
                            cancellationToken);
                    }
                    else
                    {
                        parsedRows++;
                        await _telemetry.ReportEnrichActivityAsync(
                            $"Parsed {summary.GenerateCertificate} — serial {extract.SerialNumber}, max {extract.MaxCapacity}, e {extract.VerificationScaleIntervalE}.",
                            "info",
                            ResolveFirebaseIdToken,
                            cancellationToken);
                    }
                }
                catch (Exception ex)
                {
                    failedRows++;
                    await _telemetry.ReportEnrichActivityAsync(
                        $"Error enriching {summary.GenerateCertificate}: {ex.Message}",
                        "error",
                        ResolveFirebaseIdToken,
                        cancellationToken);

                    await PublishStateAsync(
                        "running",
                        $"Error on {summary.GenerateCertificate}: {ex.Message}",
                        totalRows,
                        processedRows,
                        parsedRows,
                        skippedRows,
                        failedRows,
                        startedAt,
                        ex.Message,
                        cancellationToken);
                }

                await PublishStateAsync(
                    "running",
                    $"Processed {processedRows}/{totalRows} — parsed {parsedRows}, skipped {skippedRows}, failed {failedRows}.",
                    totalRows,
                    processedRows,
                    parsedRows,
                    skippedRows,
                    failedRows,
                    startedAt,
                    string.Empty,
                    cancellationToken);

                if (_settings.DocaEnrich.DelayBetweenDocsMs > 0)
                {
                    await Task.Delay(_settings.DocaEnrich.DelayBetweenDocsMs, cancellationToken);
                }
            }

            await PublishStateAsync(
                "completed",
                $"PDF enrich finished — parsed {parsedRows}, skipped {skippedRows}, failed {failedRows}.",
                totalRows,
                processedRows,
                parsedRows,
                skippedRows,
                failedRows,
                startedAt,
                string.Empty,
                cancellationToken);

            await _telemetry.ReportEnrichActivityAsync(
                $"PDF enrich completed — parsed {parsedRows}, skipped {skippedRows}, failed {failedRows}.",
                "success",
                ResolveFirebaseIdToken,
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            await PublishStateAsync(
                "paused",
                "PDF enrich paused.",
                0,
                processedRows,
                parsedRows,
                skippedRows,
                failedRows,
                startedAt,
                string.Empty,
                CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            await PublishStateAsync(
                "error",
                ex.Message,
                0,
                processedRows,
                parsedRows,
                skippedRows,
                failedRows,
                startedAt,
                ex.Message,
                CancellationToken.None);
            await _telemetry.ReportEnrichActivityAsync(
                $"PDF enrich failed: {ex.Message}",
                "error",
                ResolveFirebaseIdToken,
                CancellationToken.None);
            throw;
        }
    }

    private async Task WaitIfPausedAsync(CancellationToken cancellationToken)
    {
        while (IsPauseRequested?.Invoke() == true)
        {
            await PublishStateAsync(
                "paused",
                "PDF enrich paused from web admin.",
                0,
                0,
                0,
                0,
                0,
                string.Empty,
                string.Empty,
                cancellationToken);
            await Task.Delay(1500, cancellationToken);
        }
    }

    private Task PublishStateAsync(
        string status,
        string message,
        int totalRows,
        int processedRows,
        int parsedRows,
        int skippedRows,
        int failedRows,
        string startedAt,
        string lastError,
        CancellationToken cancellationToken) =>
        _telemetry.PublishEnrichStateAsync(
            new DocaEnrichProgressState
            {
                Status = status,
                StatusMessage = message,
                TotalRows = totalRows,
                ProcessedRows = processedRows,
                ParsedRows = parsedRows,
                SkippedRows = skippedRows,
                FailedRows = failedRows,
                StartedAt = startedAt,
                LastProgressAt = DateTimeOffset.UtcNow.ToString("O"),
                LastError = lastError,
            },
            ResolveFirebaseIdToken!,
            cancellationToken);
}
