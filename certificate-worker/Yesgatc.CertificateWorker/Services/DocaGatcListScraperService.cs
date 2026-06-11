using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public static partial class DocaGatcListScraperService
{
    public static async Task EnsureListPageReadyAsync(
        IPage page,
        string listUrl,
        CancellationToken cancellationToken = default)
    {
        if (!page.Url.Contains("view-gn-uploadcertificate", StringComparison.OrdinalIgnoreCase))
        {
            await page.GotoAsync(listUrl, new PageGotoOptions
            {
                WaitUntil = WaitUntilState.Load,
                Timeout = 90_000,
            });
        }

        await page.Locator("table tbody tr").First.WaitForAsync(new LocatorWaitForOptions
        {
            Timeout = 90_000,
        });

        cancellationToken.ThrowIfCancellationRequested();
    }

    public static async Task TrySetPageSizeAsync(IPage page, int pageSize, CancellationToken cancellationToken = default)
    {
        var select = page.Locator("select[name$='_length'], select[name='length']").First;
        if (await select.CountAsync() == 0)
        {
            return;
        }

        var value = pageSize.ToString(CultureInfo.InvariantCulture);
        try
        {
            await select.SelectOptionAsync(new SelectOptionValue { Value = value });
        }
        catch (PlaywrightException)
        {
            try
            {
                await select.SelectOptionAsync(new SelectOptionValue { Label = value });
            }
            catch (PlaywrightException)
            {
                return;
            }
        }

        await page.WaitForTimeoutAsync(800);
        cancellationToken.ThrowIfCancellationRequested();
    }

    public static async Task<DocaGatcPageParseResult> ParseCurrentPageAsync(
        IPage page,
        CancellationToken cancellationToken = default)
    {
        var (pageStart, pageEnd, totalEntries) = await ReadPaginationInfoAsync(page);
        var rows = new List<DocaGatcRow>();
        var tableRows = await page.Locator("table tbody tr").AllAsync();

        foreach (var row in tableRows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var parsed = await TryParseRowAsync(page, row);
            if (parsed is not null)
            {
                rows.Add(parsed);
            }
        }

        var hasNext = await HasNextPageAsync(page);
        return new DocaGatcPageParseResult
        {
            Rows = rows,
            PageStart = pageStart,
            PageEnd = pageEnd,
            TotalEntries = totalEntries,
            HasNextPage = hasNext && pageEnd < totalEntries,
        };
    }

    // DOCA GATC list uses DataTables #example1:
    //   #example1_info          — "Showing 1 to 50 of 1,000 entries"
    //   #example1_paginate      — ul.pagination wrapper
    //   #example1_next          — li.paginate_button.next (disabled class on last page)
    //   #example1_next > a      — clickable Next link (aria-controls="example1")

    private const string PaginationInfoSelector = "#example1_info";
    private const string PaginationContainerSelector = "#example1_paginate";
    private const string NextPageItemSelector = "#example1_next";
    private const string NextPageLinkSelector = "#example1_paginate #example1_next:not(.disabled) > a[aria-controls='example1']";

    public static async Task<bool> GoToNextPageAsync(IPage page, CancellationToken cancellationToken = default)
    {
        if (!await HasNextPageAsync(page))
        {
            return false;
        }

        var beforeInfo = await ReadPaginationInfoAsync(page);
        var beforeFirstCert = await ReadFirstRowCertificateAsync(page);
        var pageSize = Math.Max(beforeInfo.PageEnd - beforeInfo.PageStart + 1, 1);
        var zeroBasedCurrent = beforeInfo.PageStart > 0
            ? (beforeInfo.PageStart - 1) / pageSize
            : 0;
        var targetPageIndex = zeroBasedCurrent + 1;

        await ScrollPaginationIntoViewAsync(page);

        for (var attempt = 0; attempt < 3; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var navigated = attempt switch
            {
                0 => await NavigateViaDataTablesAsync(page, "next"),
                1 => await NavigateViaDataTablesAsync(page, targetPageIndex.ToString(CultureInfo.InvariantCulture)),
                _ => await ClickNextPageLinkAsync(page),
            };

            if (!navigated)
            {
                await page.WaitForTimeoutAsync(400);
                continue;
            }

            try
            {
                var advanced = await WaitForPaginationAdvanceAsync(
                    page,
                    beforeInfo.PageStart,
                    beforeFirstCert,
                    cancellationToken,
                    requireForwardAdvance: true);
                if (!advanced)
                {
                    return false;
                }

                return true;
            }
            catch (TimeoutException) when (attempt < 2)
            {
                await page.WaitForTimeoutAsync(600);
            }
        }

        return false;
    }

    /// <summary>Jump to a 1-based page number (e.g. 10 for the last page).</summary>
    public static async Task<bool> GoToPageNumberAsync(
        IPage page,
        int pageNumber,
        CancellationToken cancellationToken = default)
    {
        if (pageNumber < 1)
        {
            return false;
        }

        var beforeInfo = await ReadPaginationInfoAsync(page);
        var beforeFirstCert = await ReadFirstRowCertificateAsync(page);
        var pageSize = Math.Max(beforeInfo.PageEnd - beforeInfo.PageStart + 1, 1);
        var expectedStart = (pageNumber - 1) * pageSize + 1;

        if (beforeInfo.PageStart == expectedStart && beforeInfo.PageStart > 0)
        {
            return true;
        }

        await ScrollPaginationIntoViewAsync(page);

        for (var attempt = 0; attempt < 3; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var zeroBasedIndex = pageNumber - 1;
            var navigated = attempt switch
            {
                0 => await NavigateViaDataTablesAsync(page, zeroBasedIndex.ToString(CultureInfo.InvariantCulture)),
                1 => await ClickPageNumberButtonAsync(page, pageNumber),
                _ => await NavigateViaDataTablesAsync(page, zeroBasedIndex.ToString(CultureInfo.InvariantCulture)),
            };

            if (!navigated)
            {
                await page.WaitForTimeoutAsync(400);
                continue;
            }

            try
            {
                var advanced = await WaitForPaginationAdvanceAsync(
                    page,
                    Math.Max(expectedStart - 1, 0),
                    beforeFirstCert,
                    cancellationToken,
                    expectedPageStart: expectedStart);
                if (advanced)
                {
                    return true;
                }
            }
            catch (TimeoutException) when (attempt < 2)
            {
                await page.WaitForTimeoutAsync(600);
            }
        }

        return false;
    }

    private static async Task<bool> ClickNextPageLinkAsync(IPage page)
    {
        var nextLink = page.Locator(NextPageLinkSelector).First;
        if (await nextLink.CountAsync() == 0)
        {
            return false;
        }

        try
        {
            await nextLink.ClickAsync(new LocatorClickOptions { Timeout = 60_000 });
        }
        catch (PlaywrightException)
        {
            await nextLink.ClickAsync(new LocatorClickOptions { Force = true, Timeout = 15_000 });
        }

        return true;
    }

    private static async Task<bool> ClickPageNumberButtonAsync(IPage page, int pageNumber)
    {
        var button = page
            .Locator($"{PaginationContainerSelector} .paginate_button")
            .Filter(new LocatorFilterOptions { HasText = pageNumber.ToString(CultureInfo.InvariantCulture) })
            .First;

        if (await button.CountAsync() == 0)
        {
            return false;
        }

        var className = await button.GetAttributeAsync("class") ?? string.Empty;
        if (className.Contains("active", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (className.Contains("disabled", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        await button.ClickAsync(new LocatorClickOptions { Timeout = 30_000 });
        return true;
    }

    private static Task<bool> NavigateViaDataTablesAsync(IPage page, string pageTarget) =>
        page.EvaluateAsync<bool>(
            """
            (pageTarget) => {
              if (typeof $ === 'undefined' || !$.fn?.dataTable) {
                return false;
              }

              const table = $('#example1').DataTable?.();
              if (!table) {
                return false;
              }

              const info = table.page.info();
              if (pageTarget === 'next') {
                if (info.page >= info.pages - 1) {
                  return false;
                }
                table.page('next').draw('page');
                return true;
              }

              const targetIndex = parseInt(pageTarget, 10);
              if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= info.pages) {
                return false;
              }

              if (info.page === targetIndex) {
                return true;
              }

              table.page(targetIndex).draw('page');
              return true;
            }
            """,
            pageTarget);

    private static async Task<string> ReadFirstRowCertificateAsync(IPage page)
    {
        var firstRow = page.Locator("table tbody tr").First;
        if (await firstRow.CountAsync() == 0)
        {
            return string.Empty;
        }

        var cells = await firstRow.Locator("td").AllInnerTextsAsync();
        return NormalizeCell(cells.ElementAtOrDefault(2));
    }

    private static async Task ScrollPaginationIntoViewAsync(IPage page)
    {
        var paginate = page.Locator(PaginationContainerSelector).First;
        if (await paginate.CountAsync() == 0)
        {
            paginate = page.Locator(".dataTables_paginate").First;
        }

        if (await paginate.CountAsync() == 0)
        {
            return;
        }

        await paginate.ScrollIntoViewIfNeededAsync();
        await page.WaitForTimeoutAsync(250);
    }

    private static async Task<bool> ClickNextPageViaScriptAsync(IPage page) =>
        await page.EvaluateAsync<bool>(
            """
            () => {
              const nextLink = document.querySelector('#example1_next:not(.disabled) > a[aria-controls="example1"]');
              if (nextLink) {
                nextLink.click();
                return true;
              }

              if (typeof $ !== 'undefined' && $.fn?.dataTable) {
                const table = $('#example1').DataTable?.();
                if (table && table.page.info().page < table.page.info().pages - 1) {
                  table.page('next').draw('page');
                  return true;
                }
              }

              return false;
            }
            """);

    private static async Task<bool> WaitForPaginationAdvanceAsync(
        IPage page,
        int previousPageStart,
        string previousFirstCertificate,
        CancellationToken cancellationToken,
        int expectedPageStart = 0,
        bool requireForwardAdvance = false)
    {
        for (var attempt = 0; attempt < 120; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await page.WaitForTimeoutAsync(500);

            var current = await ReadPaginationInfoAsync(page);

            if (requireForwardAdvance
                && previousPageStart > 0
                && current.PageStart > 0
                && current.PageStart <= previousPageStart)
            {
                return false;
            }

            var pageStartAdvanced = current.PageStart > previousPageStart && current.PageStart > 0;
            var reachedExpectedStart = expectedPageStart > 0 && current.PageStart == expectedPageStart;
            var rowContentChanged = !requireForwardAdvance
                && !string.IsNullOrWhiteSpace(previousFirstCertificate)
                && !string.Equals(
                    previousFirstCertificate,
                    await ReadFirstRowCertificateAsync(page),
                    StringComparison.OrdinalIgnoreCase);

            if (pageStartAdvanced || reachedExpectedStart || rowContentChanged)
            {
                await page.Locator("table tbody tr").First.WaitForAsync(new LocatorWaitForOptions
                {
                    Timeout = 60_000,
                });
                await page.WaitForTimeoutAsync(300);
                return true;
            }
        }

        throw new TimeoutException("Timed out waiting for DOCA GATC list to advance to the next page.");
    }

    private static async Task<DocaGatcRow?> TryParseRowAsync(IPage page, ILocator row)
    {
        var cells = await row.Locator("td").AllInnerTextsAsync();
        if (cells.Count < 6)
        {
            return null;
        }

        var certLink = row.Locator("a", new LocatorLocatorOptions { HasText = "View Certificate" }).First;
        var photoLink = row.Locator("a", new LocatorLocatorOptions { HasText = "View Photo" }).First;
        if (await certLink.CountAsync() == 0 || await photoLink.CountAsync() == 0)
        {
            return null;
        }

        var certHref = await certLink.GetAttributeAsync("href") ?? string.Empty;
        var photoHref = await photoLink.GetAttributeAsync("href") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(certHref) || string.IsNullOrWhiteSpace(photoHref))
        {
            return null;
        }

        var generateCertificate = NormalizeCell(cells.ElementAtOrDefault(2));
        if (string.IsNullOrWhiteSpace(generateCertificate))
        {
            return null;
        }

        return new DocaGatcRow
        {
            GatcCertificateNo = NormalizeCell(cells.ElementAtOrDefault(1)),
            GenerateCertificate = generateCertificate,
            InstrumentName = NormalizeCell(cells.ElementAtOrDefault(3)),
            BelongTo = NormalizeCell(cells.ElementAtOrDefault(4)),
            ValidityDate = NormalizeCell(cells.ElementAtOrDefault(5)),
            CertificateSourceUrl = ToAbsoluteUrl(page.Url, certHref),
            PhotoSourceUrl = ToAbsoluteUrl(page.Url, photoHref),
            UploadDate = NormalizeCell(cells.ElementAtOrDefault(cells.Count - 1)),
        };
    }

    private static async Task<(int PageStart, int PageEnd, int TotalEntries)> ReadPaginationInfoAsync(IPage page)
    {
        var infoLocator = page.Locator(PaginationInfoSelector).First;
        if (await infoLocator.CountAsync() == 0)
        {
            infoLocator = page.Locator(".dataTables_info, [id$='_info']").First;
        }

        if (await infoLocator.CountAsync() == 0)
        {
            return (0, 0, 0);
        }

        var text = (await infoLocator.InnerTextAsync()).Trim();
        var match = PaginationInfoRegex().Match(text);
        if (!match.Success)
        {
            return (0, 0, 0);
        }

        return (
            int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture),
            int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
            int.Parse(match.Groups[3].Value.Replace(",", string.Empty), CultureInfo.InvariantCulture));
    }

    private static async Task<bool> HasNextPageAsync(IPage page)
    {
        var info = await ReadPaginationInfoAsync(page);
        if (info.TotalEntries > 0 && info.PageEnd >= info.TotalEntries)
        {
            return false;
        }

        var dataTablesHasNext = await ReadDataTablesHasNextPageAsync(page);
        if (dataTablesHasNext == false)
        {
            return false;
        }

        var nextItem = page.Locator(NextPageItemSelector).First;
        if (await nextItem.CountAsync() == 0)
        {
            nextItem = page.Locator("li.paginate_button.next").First;
        }

        if (await nextItem.CountAsync() == 0)
        {
            return dataTablesHasNext == true;
        }

        var className = await nextItem.GetAttributeAsync("class") ?? string.Empty;
        return !className.Contains("disabled", StringComparison.OrdinalIgnoreCase);
    }

    private static Task<bool?> ReadDataTablesHasNextPageAsync(IPage page) =>
        page.EvaluateAsync<bool?>(
            """
            () => {
              if (typeof $ === 'undefined' || !$.fn?.dataTable) {
                return null;
              }

              const table = $('#example1').DataTable?.();
              if (!table) {
                return null;
              }

              const info = table.page.info();
              return info.page < info.pages - 1;
            }
            """);

    private static string NormalizeCell(string? value) =>
        string.IsNullOrWhiteSpace(value) ? string.Empty : Regex.Replace(value.Trim(), "\\s+", " ");

    private static string ToAbsoluteUrl(string baseUrl, string href)
    {
        if (Uri.TryCreate(href, UriKind.Absolute, out var absolute))
        {
            return absolute.ToString();
        }

        return new Uri(new Uri(baseUrl), href).ToString();
    }

    [GeneratedRegex(@"Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+([\d,]+)\s+entries", RegexOptions.IgnoreCase)]
    private static partial Regex PaginationInfoRegex();
}
