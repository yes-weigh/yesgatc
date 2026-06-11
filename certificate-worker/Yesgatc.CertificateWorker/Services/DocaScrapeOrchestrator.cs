using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class DocaScrapeOrchestrator
{
    private readonly AutomationSettings _settings;
    private readonly AutomationService _scraperBrowser;
    private readonly DocaScrapeSyncService _syncService;
    private readonly WorkerTelemetryService _telemetry;

    public DocaScrapeOrchestrator(
        AutomationSettings settings,
        AutomationService scraperBrowser,
        DocaScrapeSyncService syncService,
        WorkerTelemetryService telemetry)
    {
        _settings = settings;
        _scraperBrowser = scraperBrowser;
        _syncService = syncService;
        _telemetry = telemetry;
    }

    public Func<Task<string>>? ResolveFirebaseIdToken { get; set; }
    public Func<bool>? IsPauseRequested { get; set; }
    public Func<DocaCredentialSettings>? ResolveDocaCredentials { get; set; }
    public int ScrapeStartPage { get; set; } = 1;

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        if (ResolveFirebaseIdToken is null)
        {
            throw new InvalidOperationException("ResolveFirebaseIdToken is required for DOCA scraping.");
        }

        var startedAt = DateTimeOffset.UtcNow.ToString("O");
        var processedRows = 0;
        var uploadedRows = 0;
        var skippedRows = 0;
        var failedRows = 0;
        var currentPage = 0;
        var totalPages = 0;
        var totalEntries = 0;
        var checkpointPage = 0;

        try
        {
            await PublishStateAsync(
                "running",
                "Opening scraper browser and logging in to DOCA…",
                currentPage,
                totalPages,
                totalEntries,
                processedRows,
                uploadedRows,
                skippedRows,
                failedRows,
                checkpointPage,
                startedAt,
                string.Empty,
                cancellationToken);

            await _scraperBrowser.EnsureBrowserReadyAsync(cancellationToken);
            var page = await OpenScraperSessionAsync(cancellationToken);

            await DocaGatcListScraperService.EnsureListPageReadyAsync(
                page,
                _settings.DocaGatcUploadCertificateUrl,
                cancellationToken);

            await DocaGatcListScraperService.TrySetPageSizeAsync(
                page,
                Math.Clamp(_settings.DocaScrape.PageSize, 10, 100),
                cancellationToken);

            if (ScrapeStartPage > 1)
            {
                await PublishStateAsync(
                    "running",
                    $"Jumping to DOCA page {ScrapeStartPage}…",
                    ScrapeStartPage - 1,
                    totalPages,
                    totalEntries,
                    processedRows,
                    uploadedRows,
                    skippedRows,
                    failedRows,
                    checkpointPage,
                    startedAt,
                    string.Empty,
                    cancellationToken);

                var jumped = await DocaGatcListScraperService.GoToPageNumberAsync(
                    page,
                    ScrapeStartPage,
                    cancellationToken);
                if (!jumped)
                {
                    throw new InvalidOperationException(
                        $"Could not jump to DOCA page {ScrapeStartPage}. Try a lower page number or start from page 1.");
                }

                currentPage = ScrapeStartPage - 1;
            }

            do
            {
                await WaitIfPausedAsync(cancellationToken);
                cancellationToken.ThrowIfCancellationRequested();

                currentPage++;
                var parseResult = await DocaGatcListScraperService.ParseCurrentPageAsync(page, cancellationToken);
                totalEntries = parseResult.TotalEntries;
                var pageSize = Math.Clamp(_settings.DocaScrape.PageSize, 10, 100);
                totalPages = totalEntries > 0
                    ? (int)Math.Ceiling(totalEntries / (double)pageSize)
                    : Math.Max(currentPage, 1);

                await PublishStateAsync(
                    "running",
                    $"Scraping page {currentPage} ({parseResult.PageStart}-{parseResult.PageEnd} of {parseResult.TotalEntries})…",
                    currentPage,
                    totalPages,
                    totalEntries,
                    processedRows,
                    uploadedRows,
                    skippedRows,
                    failedRows,
                    checkpointPage,
                    startedAt,
                    string.Empty,
                    cancellationToken);

                var idToken = await ResolveFirebaseIdToken();
                var pageSkipped = 0;
                var pageUploaded = 0;

                foreach (var row in parseResult.Rows)
                {
                    await WaitIfPausedAsync(cancellationToken);
                    cancellationToken.ThrowIfCancellationRequested();
                    processedRows++;

                    try
                    {
                        if (await _syncService.ShouldSkipRowAsync(row, idToken, cancellationToken))
                        {
                            skippedRows++;
                            pageSkipped++;
                            continue;
                        }

                        if (_scraperBrowser.BrowserContext is null)
                        {
                            throw new InvalidOperationException("Scraper browser context is not available.");
                        }

                        await _syncService.SyncRowAsync(
                            row,
                            _scraperBrowser.BrowserContext,
                            idToken,
                            cancellationToken);
                        uploadedRows++;
                        pageUploaded++;

                        await _telemetry.ReportScrapeActivityAsync(
                            $"Uploaded {row.GenerateCertificate} to Firebase.",
                            "success",
                            ResolveFirebaseIdToken,
                            cancellationToken);

                        if (_settings.DocaScrape.DelayBetweenRowsMs > 0)
                        {
                            await Task.Delay(_settings.DocaScrape.DelayBetweenRowsMs, cancellationToken);
                        }
                    }
                    catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
                    {
                        failedRows++;
                        var message = $"Failed {row.GenerateCertificate}: {ex.Message}";
                        await _telemetry.ReportScrapeActivityAsync(
                            message,
                            "error",
                            ResolveFirebaseIdToken,
                            cancellationToken);
                    }
                }

                checkpointPage = currentPage;
                await PublishStateAsync(
                    "running",
                    $"Finished page {currentPage}. Processed {processedRows}, uploaded {uploadedRows}, skipped {skippedRows}, failed {failedRows}.",
                    currentPage,
                    totalPages,
                    totalEntries,
                    processedRows,
                    uploadedRows,
                    skippedRows,
                    failedRows,
                    checkpointPage,
                    startedAt,
                    string.Empty,
                    cancellationToken);

                // Only stop early on the last DOCA page when every row was already synced.
                var lastPageFullySkipped =
                    parseResult.Rows.Count > 0
                    && pageSkipped == parseResult.Rows.Count
                    && pageUploaded == 0
                    && !parseResult.HasNextPage;

                if (lastPageFullySkipped)
                {
                    await PublishStateAsync(
                        "completed",
                        uploadedRows > 0 || failedRows > 0
                            ? $"Scrape complete — uploaded {uploadedRows}, skipped {skippedRows}, failed {failedRows}."
                            : "All DOCA certificates are already in Firebase — nothing to scrape.",
                        currentPage,
                        totalPages,
                        totalEntries,
                        processedRows,
                        uploadedRows,
                        skippedRows,
                        failedRows,
                        checkpointPage,
                        startedAt,
                        string.Empty,
                        cancellationToken);

                    await _telemetry.ReportScrapeActivityAsync(
                        uploadedRows > 0 || failedRows > 0
                            ? $"DOCA scrape completed. Uploaded {uploadedRows}, skipped {skippedRows}, failed {failedRows}."
                            : "DOCA scrape stopped — all listed certificates already exist in docaCertificates.",
                        "success",
                        ResolveFirebaseIdToken,
                        cancellationToken);
                    return;
                }

                if (!parseResult.HasNextPage)
                {
                    break;
                }

                if (_settings.DocaScrape.DelayBetweenPagesMs > 0)
                {
                    await Task.Delay(_settings.DocaScrape.DelayBetweenPagesMs, cancellationToken);
                }

                var moved = await DocaGatcListScraperService.GoToNextPageAsync(page, cancellationToken);
                if (!moved)
                {
                    break;
                }
            }
            while (true);

            await PublishStateAsync(
                "completed",
                $"Scrape complete — uploaded {uploadedRows}, skipped {skippedRows}, failed {failedRows}.",
                currentPage,
                totalPages,
                totalEntries,
                processedRows,
                uploadedRows,
                skippedRows,
                failedRows,
                checkpointPage,
                startedAt,
                string.Empty,
                cancellationToken);

            await _telemetry.ReportScrapeActivityAsync(
                $"DOCA scrape completed. Uploaded {uploadedRows}, skipped {skippedRows}, failed {failedRows}.",
                "success",
                ResolveFirebaseIdToken,
                cancellationToken);
        }
        catch (OperationCanceledException)
        {
            await PublishStateAsync(
                "paused",
                "DOCA scrape paused.",
                currentPage,
                totalPages,
                totalEntries,
                processedRows,
                uploadedRows,
                skippedRows,
                failedRows,
                checkpointPage,
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
                currentPage,
                totalPages,
                totalEntries,
                processedRows,
                uploadedRows,
                skippedRows,
                failedRows,
                checkpointPage,
                startedAt,
                ex.Message,
                CancellationToken.None);

            await _telemetry.ReportScrapeActivityAsync(
                $"DOCA scrape error: {ex.Message}",
                "error",
                ResolveFirebaseIdToken,
                CancellationToken.None);
            throw;
        }
    }

    private async Task<IPage> OpenScraperSessionAsync(CancellationToken cancellationToken)
    {
        ApplyScraperCredentials();

        var state = await _scraperBrowser.OpenDocaWorkspaceAsync(chromeNumber: 2, cancellationToken);
        if (state == DocaSessionState.LoginRequired && !HasScraperLoginCredentials())
        {
            throw new InvalidOperationException(
                "DOCA email/password are missing for scraper browser (Chrome 2). Save DOCA credentials in the worker or push them from web admin.");
        }

        var page = _scraperBrowser.BrowserContext?.Pages.FirstOrDefault()
            ?? throw new InvalidOperationException("Scraper browser page is unavailable.");

        await page.GotoAsync(_settings.DocaGatcUploadCertificateUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load,
            Timeout = 90_000,
        });

        if (await AutomationServiceProbe.IsLoginPageAsync(page))
        {
            ApplyScraperCredentials();
            var loginState = await _scraperBrowser.EnsureLoggedInOnPageAsync(page, cancellationToken);
            if (loginState == DocaSessionState.LoginRequired)
            {
                throw new InvalidOperationException(
                    "DOCA captcha/login failed on scraper browser (Chrome 2). Check DOCA credentials and OCR settings.");
            }

            await page.GotoAsync(_settings.DocaGatcUploadCertificateUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 90_000,
            });
        }

        if (await AutomationServiceProbe.IsLoginPageAsync(page))
        {
            throw new InvalidOperationException("DOCA still shows login after auto-login on scraper browser.");
        }

        return page;
    }

    private void ApplyScraperCredentials()
    {
        if (ResolveDocaCredentials is null)
        {
            return;
        }

        _scraperBrowser.DocaCredentials = ResolveDocaCredentials();
    }

    private bool HasScraperLoginCredentials()
    {
        var credentials = _scraperBrowser.DocaCredentials;
        return !string.IsNullOrWhiteSpace(credentials.Email)
            && !string.IsNullOrWhiteSpace(credentials.Password);
    }

    private async Task WaitIfPausedAsync(CancellationToken cancellationToken)
    {
        while (IsPauseRequested?.Invoke() == true)
        {
            await Task.Delay(1000, cancellationToken);
        }
    }

    private Task PublishStateAsync(
        string status,
        string message,
        int currentPage,
        int totalPages,
        int totalEntries,
        int processedRows,
        int uploadedRows,
        int skippedRows,
        int failedRows,
        int checkpointPage,
        string startedAt,
        string lastError,
        CancellationToken cancellationToken) =>
        _telemetry.PublishScrapeStateAsync(
            new DocaScrapeProgressState
            {
                Status = status,
                StatusMessage = message,
                CurrentPage = currentPage,
                TotalPages = totalPages,
                TotalEntries = totalEntries,
                ProcessedRows = processedRows,
                UploadedRows = uploadedRows,
                SkippedRows = skippedRows,
                FailedRows = failedRows,
                CheckpointPage = checkpointPage,
                StartedAt = startedAt,
                LastProgressAt = DateTimeOffset.UtcNow.ToString("O"),
                LastError = lastError,
            },
            ResolveFirebaseIdToken!,
            cancellationToken);
}

internal static class AutomationServiceProbe
{
    public static Task<bool> IsLoginPageAsync(IPage page) =>
        page.Locator("input[type='password'], #password, input[name='password']").CountAsync()
            .ContinueWith(task => task.Result > 0 && page.Url.Contains("login", StringComparison.OrdinalIgnoreCase));
}
