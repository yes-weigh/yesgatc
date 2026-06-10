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

    public static async Task<bool> GoToNextPageAsync(IPage page, CancellationToken cancellationToken = default)
    {
        if (!await HasNextPageAsync(page))
        {
            return false;
        }

        var nextButton = page.Locator(
            ".paginate_button.next:not(.disabled), li.next:not(.disabled) a, a.paginate_button.next:not(.disabled)").First;
        if (await nextButton.CountAsync() == 0)
        {
            return false;
        }

        await nextButton.ClickAsync();
        await page.WaitForTimeoutAsync(900);
        await page.Locator("table tbody tr").First.WaitForAsync(new LocatorWaitForOptions
        {
            Timeout = 60_000,
        });

        cancellationToken.ThrowIfCancellationRequested();
        return true;
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
        var infoLocator = page.Locator(".dataTables_info, #example_info, [id$='_info']").First;
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
        var nextButton = page.Locator(
            ".paginate_button.next, li.next a, a.paginate_button.next").First;
        if (await nextButton.CountAsync() == 0)
        {
            return false;
        }

        var className = await nextButton.GetAttributeAsync("class") ?? string.Empty;
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
