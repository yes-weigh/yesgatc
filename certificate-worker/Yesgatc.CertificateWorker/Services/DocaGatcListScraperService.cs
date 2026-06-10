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
            HasNextPage = hasNext,
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
        await ScrollPaginationIntoViewAsync(page);

        var nextLink = page.Locator(NextPageLinkSelector).First;
        if (await nextLink.CountAsync() > 0)
        {
            try
            {
                await nextLink.ClickAsync(new LocatorClickOptions { Timeout = 60_000 });
            }
            catch (PlaywrightException)
            {
                await nextLink.ClickAsync(new LocatorClickOptions { Force = true, Timeout = 15_000 });
            }
        }
        else if (!await ClickNextPageViaScriptAsync(page))
        {
            return false;
        }

        await WaitForPaginationAdvanceAsync(page, beforeInfo.PageStart, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        return true;
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

    private static async Task WaitForPaginationAdvanceAsync(
        IPage page,
        int previousPageStart,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 60; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await page.WaitForTimeoutAsync(500);

            var current = await ReadPaginationInfoAsync(page);
            if (current.PageStart > previousPageStart && current.PageStart > 0)
            {
                await page.Locator("table tbody tr").First.WaitForAsync(new LocatorWaitForOptions
                {
                    Timeout = 60_000,
                });
                return;
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
        var nextItem = page.Locator(NextPageItemSelector).First;
        if (await nextItem.CountAsync() == 0)
        {
            nextItem = page.Locator("li.paginate_button.next").First;
        }

        if (await nextItem.CountAsync() == 0)
        {
            return false;
        }

        var className = await nextItem.GetAttributeAsync("class") ?? string.Empty;
        return !className.Contains("disabled", StringComparison.OrdinalIgnoreCase);
    }

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
