using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Playwright;

namespace Yesgatc.CertificateWorker.Services;

public sealed record ViewVerificationMatch(
    string SerialNumber,
    string? ApplicationNumber,
    string? CertificateNumber,
    string? InstrumentDescription);

public sealed record CertificatePdfDownloadResult(
    ViewVerificationMatch Match,
    string LocalPdfPath);

public sealed record ViewVerificationDuplicateCheckResult(
    bool Exists,
    ViewVerificationMatch? Match = null);

public static class DocaViewVerificationService
{
    /// <summary>
    /// Quick search on View IC Verification (e.g. ?search=SERIAL) before creating a new application.
    /// Returns whether a row already exists for the serial — does not throw when none is found.
    /// </summary>
    public static async Task<ViewVerificationDuplicateCheckResult> CheckExistingBySerialAsync(
        IPage page,
        string viewIcVerificationBaseUrl,
        string serialNumber,
        CancellationToken cancellationToken = default)
    {
        _ = cancellationToken;
        var serial = serialNumber.Trim();
        if (string.IsNullOrWhiteSpace(serial))
        {
            return new ViewVerificationDuplicateCheckResult(false);
        }

        var searchUrl = BuildSearchUrl(viewIcVerificationBaseUrl, serial);
        await page.GotoAsync(searchUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load,
            Timeout = 60_000,
        });

        await WaitForViewListPageAsync(page);
        await EnsureSearchAppliedAsync(page, serial);

        var match = await TryFindExistingMatchAsync(page, serial);
        return match is null
            ? new ViewVerificationDuplicateCheckResult(false)
            : new ViewVerificationDuplicateCheckResult(true, match);
    }

    public static async Task<ViewVerificationMatch> FindBySerialAsync(
        IPage page,
        string viewIcVerificationBaseUrl,
        string serialNumber,
        CancellationToken cancellationToken = default)
    {
        var row = await NavigateAndFindRowAsync(page, viewIcVerificationBaseUrl, serialNumber, cancellationToken);
        return await ParseRowMatchAsync(row, serialNumber.Trim());
    }

    public static async Task<CertificatePdfDownloadResult> FindDetailsAndDownloadPdfAsync(
        IPage page,
        string viewIcVerificationBaseUrl,
        string serialNumber,
        string downloadDirectory,
        CancellationToken cancellationToken = default)
    {
        _ = cancellationToken;
        var serial = serialNumber.Trim();
        var row = await NavigateAndFindRowAsync(page, viewIcVerificationBaseUrl, serial, cancellationToken);
        var match = await ParseRowMatchAsync(row, serial);

        await ClickDetailsAndWaitForDetailsPageAsync(page, row);

        await WaitForCertificateDetailsReadyAsync(page);
        var pdfPath = await DownloadPdfAsync(page, downloadDirectory, match);

        await page.BringToFrontAsync();
        return new CertificatePdfDownloadResult(match, pdfPath);
    }

    public static async Task UploadStampedCertificateAsync(
        IPage page,
        string viewIcVerificationBaseUrl,
        string serialNumber,
        string signedCertificatePdfPath,
        string instrumentPhotoPath,
        string remarks,
        CancellationToken cancellationToken = default)
    {
        _ = cancellationToken;
        var serial = serialNumber.Trim();
        var row = await NavigateAndFindRowAsync(page, viewIcVerificationBaseUrl, serial, cancellationToken);
        await ClickUploadCertificateAndWaitForUploadPageAsync(page, row);

        await DocaFormFiller.FillIcUploadCertificateFormAsync(
            page,
            signedCertificatePdfPath,
            instrumentPhotoPath,
            remarks);

        await DocaFormFiller.SubmitIcUploadCertificateAsync(page);
        await DocaFormFiller.WaitForIcUploadCertificateSuccessAsync(page);
        await page.BringToFrontAsync();
    }

    /// <summary>
    /// True when the IC Verification row shows upload is already complete on DOCA.
    /// </summary>
    public static async Task<bool> IsCertificateAlreadyUploadedAsync(
        IPage page,
        string viewIcVerificationBaseUrl,
        string serialNumber,
        CancellationToken cancellationToken = default)
    {
        var row = await NavigateAndFindRowAsync(page, viewIcVerificationBaseUrl, serialNumber, cancellationToken);
        return await RowIndicatesCertificateUploadedAsync(row);
    }

    private static async Task ClickUploadCertificateAndWaitForUploadPageAsync(IPage page, ILocator row)
    {
        var upload = row.GetByRole(AriaRole.Link, new LocatorGetByRoleOptions { Name = "Upload Certificate" });
        if (await upload.CountAsync() == 0)
        {
            upload = row.GetByRole(AriaRole.Button, new LocatorGetByRoleOptions { Name = "Upload Certificate" });
        }

        if (await upload.CountAsync() == 0)
        {
            if (await RowIndicatesCertificateUploadedAsync(row))
            {
                throw new InvalidOperationException(
                    "DOCA already shows Certificate Uploaded for this serial — use Firebase sync instead of re-uploading.");
            }

            upload = row.Locator("a, button")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("^\\s*Upload\\s+Certificate\\s*$", RegexOptions.IgnoreCase),
                });
        }

        if (await upload.CountAsync() == 0)
        {
            throw new InvalidOperationException("Could not find the Upload Certificate button on the verification row.");
        }

        var uploadControl = upload.First;
        await uploadControl.ScrollIntoViewIfNeededAsync();

        var href = await uploadControl.GetAttributeAsync("href");
        if (!string.IsNullOrWhiteSpace(href))
        {
            var targetUrl = href.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                ? href
                : new Uri(new Uri(page.Url), href).AbsoluteUri;

            await page.GotoAsync(targetUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 60_000,
            });
            return;
        }

        var navigationWait = page.WaitForURLAsync(
            url => url.Contains("ic-upload-certificate", StringComparison.OrdinalIgnoreCase),
            new PageWaitForURLOptions { Timeout = 60_000 });

        await uploadControl.ClickAsync(new LocatorClickOptions { Timeout = 30_000 });
        await navigationWait;
    }

    private static async Task<ILocator> NavigateAndFindRowAsync(
        IPage page,
        string viewIcVerificationBaseUrl,
        string serialNumber,
        CancellationToken cancellationToken)
    {
        _ = cancellationToken;
        var serial = serialNumber.Trim();
        if (string.IsNullOrWhiteSpace(serial))
        {
            throw new InvalidOperationException("Serial number is required to search View IC Verification.");
        }

        var searchUrl = BuildSearchUrl(viewIcVerificationBaseUrl, serial);
        await page.GotoAsync(searchUrl, new PageGotoOptions
        {
            WaitUntil = WaitUntilState.Load,
            Timeout = 60_000,
        });

        await WaitForViewListPageAsync(page);
        await EnsureSearchAppliedAsync(page, serial);

        var row = await WaitForMatchingRowAsync(page, serial);
        await row.ScrollIntoViewIfNeededAsync();
        return row;
    }

    private static async Task ClickDetailsAndWaitForDetailsPageAsync(IPage page, ILocator row)
    {
        var details = row.GetByRole(AriaRole.Link, new LocatorGetByRoleOptions { Name = "Details" });
        if (await details.CountAsync() == 0)
        {
            details = row.GetByRole(AriaRole.Button, new LocatorGetByRoleOptions { Name = "Details" });
        }

        if (await details.CountAsync() == 0)
        {
            details = row.Locator("a, button")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("^\\s*Details\\s*$", RegexOptions.IgnoreCase),
                });
        }

        if (await details.CountAsync() == 0)
        {
            throw new InvalidOperationException("Could not find the Details button on the verification row.");
        }

        var detailsLink = details.First;
        await detailsLink.ScrollIntoViewIfNeededAsync();

        var href = await detailsLink.GetAttributeAsync("href");
        if (!string.IsNullOrWhiteSpace(href))
        {
            var targetUrl = href.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                ? href
                : new Uri(new Uri(page.Url), href).AbsoluteUri;

            await page.GotoAsync(targetUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 180_000,
            });
            return;
        }

        var navigationWait = page.WaitForURLAsync(
            url => url.Contains("ic-details", StringComparison.OrdinalIgnoreCase),
            new PageWaitForURLOptions { Timeout = 180_000 });

        await detailsLink.ClickAsync(new LocatorClickOptions { Timeout = 180_000 });
        await navigationWait;
    }

    private static async Task WaitForCertificateDetailsReadyAsync(IPage page)
    {
        try
        {
            var heading = page.Locator("h1, h3.box-title, .box-title").Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex(
                    "Government Approved Test Center|Certificate of Verification",
                    RegexOptions.IgnoreCase),
            });

            if (await heading.CountAsync() > 0)
            {
                await heading.First.WaitForAsync(new LocatorWaitForOptions { Timeout = 60_000 });
            }
        }
        catch (TimeoutException)
        {
            // Page shell may load before headings; Download PDF is the real readiness signal.
        }

        await WaitForDownloadPdfButtonAsync(page, timeoutMs: 180_000);
    }

    private static async Task<ILocator> WaitForDownloadPdfButtonAsync(IPage page, int timeoutMs)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);

        while (DateTime.UtcNow < deadline)
        {
            var button = await FindDownloadPdfButtonAsync(page);
            if (await button.CountAsync() > 0)
            {
                try
                {
                    await button.First.WaitForAsync(new LocatorWaitForOptions
                    {
                        State = WaitForSelectorState.Visible,
                        Timeout = 2_000,
                    });
                    return button.First;
                }
                catch (TimeoutException)
                {
                    // Keep polling until the certificate finishes rendering.
                }
            }

            await page.WaitForTimeoutAsync(1_000);
        }

        throw new InvalidOperationException(
            "Download PDF did not appear on the certificate details page. The page may still be loading.");
    }

    private static async Task<ILocator> FindDownloadPdfButtonAsync(IPage page)
    {
        var byLink = page.GetByRole(AriaRole.Link, new PageGetByRoleOptions { Name = "Download PDF" });
        if (await byLink.CountAsync() > 0)
        {
            return byLink;
        }

        var byButton = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Download PDF" });
        if (await byButton.CountAsync() > 0)
        {
            return byButton;
        }

        return page.Locator("a, button")
            .Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex("Download\\s*PDF", RegexOptions.IgnoreCase),
            });
    }

    private static async Task<string> DownloadPdfAsync(
        IPage page,
        string downloadDirectory,
        ViewVerificationMatch match)
    {
        Directory.CreateDirectory(downloadDirectory);

        var downloadButton = await WaitForDownloadPdfButtonAsync(page, timeoutMs: 180_000);
        await downloadButton.ScrollIntoViewIfNeededAsync();

        var savePath = Path.Combine(downloadDirectory, BuildDownloadFileName(match));

        var download = await page.RunAndWaitForDownloadAsync(
            async () => await downloadButton.ClickAsync(new LocatorClickOptions { Timeout = 30_000 }),
            new PageRunAndWaitForDownloadOptions { Timeout = 180_000 });

        try
        {
            await download.SaveAsAsync(savePath);
            var bytes = await File.ReadAllBytesAsync(savePath);
            EnsureValidPdf(bytes);
            return savePath;
        }
        finally
        {
            try
            {
                await download.DeleteAsync();
            }
            catch (PlaywrightException)
            {
                // Best-effort cleanup of Playwright's GUID temp file.
            }
        }
    }

    private static void EnsureValidPdf(byte[] bytes)
    {
        if (bytes.Length < 4
            || bytes[0] != (byte)'%'
            || bytes[1] != (byte)'P'
            || bytes[2] != (byte)'D'
            || bytes[3] != (byte)'F')
        {
            throw new InvalidOperationException(
                "Downloaded file is not a valid PDF. DOCA may still be generating the certificate.");
        }
    }

    private static string BuildDownloadFileName(ViewVerificationMatch match)
    {
        if (!string.IsNullOrWhiteSpace(match.CertificateNumber) && !string.IsNullOrWhiteSpace(match.SerialNumber))
        {
            return $"{SanitizeFileName(match.CertificateNumber!)}_{SanitizeFileName(match.SerialNumber)}.pdf";
        }

        var baseName = !string.IsNullOrWhiteSpace(match.CertificateNumber)
            ? SanitizeFileName(match.CertificateNumber!)
            : SanitizeFileName(match.SerialNumber);

        return $"{baseName}.pdf";
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return cleaned.Replace('/', '_').Replace('\\', '_').Trim();
    }

    private static async Task WaitForViewListPageAsync(IPage page)
    {
        var heading = page.Locator("h3.box-title, h1").Filter(new LocatorFilterOptions
        {
            HasTextRegex = new Regex("Instrument Certificate of verification List", RegexOptions.IgnoreCase),
        });

        if (await heading.CountAsync() > 0)
        {
            await heading.First.WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });
            return;
        }

        await page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Search" }).First
            .WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });
    }

    private static string BuildSearchUrl(string baseUrl, string serial)
    {
        var trimmedBase = baseUrl.TrimEnd('/');
        return $"{trimmedBase}?search={Uri.EscapeDataString(serial)}";
    }

    private static async Task EnsureSearchAppliedAsync(IPage page, string serial)
    {
        if (await TryFindMatchingRowAsync(page, serial) is not null)
        {
            return;
        }

        var searchInput = await FindSearchInputAsync(page);
        await searchInput.ScrollIntoViewIfNeededAsync();
        await searchInput.ClickAsync();
        await searchInput.FillAsync(serial);

        var searchButton = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Search" });
        if (await searchButton.CountAsync() == 0)
        {
            searchButton = page.Locator("button, input[type='submit'], a")
                .Filter(new LocatorFilterOptions { HasTextRegex = new Regex("^\\s*Search\\s*$", RegexOptions.IgnoreCase) });
        }

        if (await searchButton.CountAsync() == 0)
        {
            throw new InvalidOperationException("Could not find the Search button on View IC Verification.");
        }

        await searchButton.First.ClickAsync(new LocatorClickOptions { Timeout = 15_000 });
        try
        {
            await page.WaitForLoadStateAsync(LoadState.NetworkIdle, new PageWaitForLoadStateOptions { Timeout = 20_000 });
        }
        catch (TimeoutException)
        {
            // Results may already be rendered; row wait handles confirmation.
        }
    }

    private static async Task<ViewVerificationMatch?> TryFindExistingMatchAsync(IPage page, string serial)
    {
        for (var attempt = 0; attempt < 6; attempt++)
        {
            var row = await TryFindMatchingRowAsync(page, serial);
            if (row is not null)
            {
                return await ParseRowMatchAsync(row, serial);
            }

            await page.WaitForTimeoutAsync(500);
        }

        return null;
    }

    private static async Task<ILocator> WaitForMatchingRowAsync(IPage page, string serial)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var row = await TryFindMatchingRowAsync(page, serial);
            if (row is not null)
            {
                return row;
            }

            await page.WaitForTimeoutAsync(500);
        }

        throw new InvalidOperationException(
            $"No View IC Verification row found for serial {serial}. Check that the record exists on DOCA.");
    }

    private static async Task<ILocator?> TryFindMatchingRowAsync(IPage page, string serial)
    {
        var rows = page.Locator("table tbody tr");
        var rowCount = await rows.CountAsync();

        var dataRows = new List<ILocator>();
        var serialMatches = new List<ILocator>();

        for (var index = 0; index < rowCount; index++)
        {
            var row = rows.Nth(index);
            if (!await RowHasDataAsync(row))
            {
                continue;
            }

            dataRows.Add(row);
            if (await RowContainsSerialAsync(row, serial))
            {
                serialMatches.Add(row);
            }
        }

        if (dataRows.Count == 0)
        {
            return null;
        }

        // Search can return multiple rows for the same serial — always use the top data row.
        if (serialMatches.Count > 1 || dataRows.Count > 1)
        {
            return dataRows[0];
        }

        if (serialMatches.Count == 1)
        {
            return serialMatches[0];
        }

        return dataRows[0];
    }

    private static async Task<bool> RowIndicatesCertificateUploadedAsync(ILocator row)
    {
        var uploaded = row.Locator("a, button, span, td")
            .Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex(
                    @"Certificate\s+Uploaded|certificate\s+uploaded",
                    RegexOptions.IgnoreCase),
            });
        return await uploaded.CountAsync() > 0;
    }

    private static async Task<bool> RowHasUploadCertificateActionAsync(ILocator row)
    {
        var upload = row.GetByRole(AriaRole.Link, new LocatorGetByRoleOptions { Name = "Upload Certificate" });
        if (await upload.CountAsync() > 0)
        {
            return true;
        }

        upload = row.GetByRole(AriaRole.Button, new LocatorGetByRoleOptions { Name = "Upload Certificate" });
        if (await upload.CountAsync() > 0)
        {
            return true;
        }

        upload = row.Locator("a, button")
            .Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex("^\\s*Upload\\s+Certificate\\s*$", RegexOptions.IgnoreCase),
            });
        return await upload.CountAsync() > 0;
    }

    private static async Task<bool> RowHasDataAsync(ILocator row)
    {
        var text = (await row.InnerTextAsync()).Trim();
        if (text.Length == 0)
        {
            return false;
        }

        return !text.Contains("no data", StringComparison.OrdinalIgnoreCase)
            && !text.Contains("no record", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<bool> RowContainsSerialAsync(ILocator row, string serial)
    {
        var cells = row.Locator("td");
        var cellCount = await cells.CountAsync();

        for (var index = 0; index < cellCount; index++)
        {
            var text = (await cells.Nth(index).InnerTextAsync()).Trim();
            if (SerialEquals(text, serial))
            {
                return true;
            }
        }

        return false;
    }

    private static bool SerialEquals(string cellText, string serial) =>
        string.Equals(cellText.Trim(), serial.Trim(), StringComparison.OrdinalIgnoreCase);

    private static async Task<ViewVerificationMatch> ParseRowMatchAsync(ILocator row, string serial)
    {
        var cells = row.Locator("td");
        var values = new List<string>();
        var cellCount = await cells.CountAsync();

        for (var index = 0; index < cellCount; index++)
        {
            values.Add((await cells.Nth(index).InnerTextAsync()).Trim());
        }

        var serialIndex = values.FindIndex(value => SerialEquals(value, serial));
        string? applicationNumber = null;
        string? certificateNumber = null;
        string? instrument = null;

        if (serialIndex >= 2)
        {
            applicationNumber = NullIfEmpty(values[1]);
            certificateNumber = NullIfEmpty(values[2]);
        }
        else if (values.Count >= 3)
        {
            // Top-row selection when the table layout does not repeat the serial in a cell.
            applicationNumber = NullIfEmpty(values[1]);
            certificateNumber = NullIfEmpty(values[2]);
        }

        if (serialIndex >= 4)
        {
            instrument = NullIfEmpty(values[3]);
        }
        else if (values.Count >= 5)
        {
            instrument = NullIfEmpty(values[3]);
        }

        var rowSerial = serialIndex >= 0 ? values[serialIndex] : values[0];
        return new ViewVerificationMatch(
            string.IsNullOrWhiteSpace(rowSerial) ? serial : rowSerial,
            applicationNumber,
            certificateNumber,
            instrument);
    }

    private static async Task<ILocator> FindSearchInputAsync(IPage page)
    {
        var candidates = new[]
        {
            page.Locator("input[name*='search' i]"),
            page.Locator("input[id*='search' i]"),
            page.Locator("input[placeholder*='search' i]"),
            page.GetByRole(AriaRole.Textbox),
            page.Locator("form input[type='text']"),
            page.Locator("input[type='text']"),
        };

        foreach (var candidate in candidates)
        {
            if (await candidate.CountAsync() > 0)
            {
                return candidate.First;
            }
        }

        throw new InvalidOperationException("Could not find the serial search field on View IC Verification.");
    }

    private static string? NullIfEmpty(string value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
