using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed record EmaapCertificateDownloadResult(string CertificateNumber, string LocalPdfPath);

/// <summary>
/// eMAAP Certificates Issued: dismiss success OK, open list, match Belongs to + Mobile,
/// pick highest IND/GATC/KL/26/04/26/{n}, download PDF.
/// </summary>
public static class EmaapCertificatesIssuedAutomation
{
    private static readonly Regex CertificateNumberRegex = new(
        @"IND\s*/\s*GATC\s*/\s*KL\s*/\s*26\s*/\s*04\s*/\s*26\s*/\s*([\d\s]+)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static async Task DismissSuccessOkAsync(IPage page, CancellationToken cancellationToken = default)
    {
        // After Generate Certificate: spinner first, then "Record saved successfully" + OK.
        // Must click OK before any Certificates Issued navigation.
        var deadline = DateTime.UtcNow.AddSeconds(45);
        var sawDialog = false;

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await IsSuccessDialogVisibleAsync(page))
            {
                sawDialog = true;
                break;
            }

            // Already clear and on issued list — nothing to dismiss.
            if (!await HasBlockingOverlayAsync(page) && await IsCertificatesIssuedPageAsync(page))
            {
                return;
            }

            await page.WaitForTimeoutAsync(250);
        }

        if (!sawDialog && !await HasBlockingOverlayAsync(page))
        {
            // No dialog appeared in time; still clear any stray overlay/spinner briefly.
            await WaitUntilOverlaysClearAsync(page, cancellationToken, maxSeconds: 5);
            return;
        }

        for (var attempt = 0; attempt < 25; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await TryClickSweetAlertOkAsync(page))
            {
                await page.WaitForTimeoutAsync(400);
                if (!await HasBlockingOverlayAsync(page))
                {
                    await WaitUntilOverlaysClearAsync(page, cancellationToken, maxSeconds: 8);
                    return;
                }

                continue;
            }

            // Enter often confirms SweetAlert.
            try
            {
                await page.Keyboard.PressAsync("Enter");
                await page.WaitForTimeoutAsync(300);
            }
            catch (PlaywrightException)
            {
            }

            if (!await HasBlockingOverlayAsync(page) && !await IsSuccessDialogVisibleAsync(page))
            {
                await WaitUntilOverlaysClearAsync(page, cancellationToken, maxSeconds: 5);
                return;
            }

            await page.WaitForTimeoutAsync(300);
        }

        // Last resort: force-remove overlay so nav can proceed (OK may have been clicked but CSS stuck).
        await page.EvaluateAsync(
            """
            () => {
              document.querySelectorAll('.swal-overlay, .swal-modal, .swal2-container').forEach(el => {
                el.classList.remove('swal-overlay--show-modal');
                el.style.display = 'none';
                el.remove();
              });
            }
            """);
        await WaitUntilOverlaysClearAsync(page, cancellationToken, maxSeconds: 5);
    }

    public static async Task OpenCertificatesIssuedAsync(IPage page, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await page.BringToFrontAsync();

        // Never click sidebar while "Record saved successfully" OK is up.
        await DismissSuccessOkAsync(page, cancellationToken);
        await WaitUntilOverlaysClearAsync(page, cancellationToken, maxSeconds: 15);

        if (!await IsCertificatesIssuedPageAsync(page))
        {
            await ClickCertificatesIssuedNavAsync(page);

            // SPA may keep same base URL; wait for list markers, not a fixed path.
            for (var attempt = 0; attempt < 15; attempt++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await DismissSuccessOkAsync(page, cancellationToken);
                await WaitUntilOverlaysClearAsync(page, cancellationToken, maxSeconds: 5);

                if (await IsCertificatesIssuedPageAsync(page))
                {
                    break;
                }

                if (attempt == 4)
                {
                    await ClickCertificatesIssuedNavAsync(page);
                }

                if (attempt == 8)
                {
                    // Fallback SPA routes seen on eMAAP.
                    foreach (var url in new[]
                             {
                                 "https://emaap.gov.in/gatc/gatc",
                                 "https://emaap.gov.in/gatc/gatc/certificates-issued",
                                 "https://emaap.gov.in/gatc/gatc/instrument-certificates",
                             })
                    {
                        try
                        {
                            await page.GotoAsync(url, new PageGotoOptions
                            {
                                WaitUntil = WaitUntilState.DOMContentLoaded,
                                Timeout = 20_000,
                            });
                            await page.WaitForTimeoutAsync(500);
                            await DismissSuccessOkAsync(page, cancellationToken);
                            if (await IsCertificatesIssuedPageAsync(page))
                            {
                                break;
                            }
                        }
                        catch (PlaywrightException)
                        {
                        }
                    }
                }

                await page.WaitForTimeoutAsync(700);
            }
        }

        if (!await IsCertificatesIssuedPageAsync(page))
        {
            throw new InvalidOperationException(
                "Could not open eMAAP Certificates Issued list (no Download/certificate table found). " +
                $"Current URL: {page.Url}");
        }

        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task<bool> IsCertificatesIssuedPageAsync(IPage page)
    {
        // Prefer operational markers over title text (title can be late/hidden in SPA).
        var hasDownload = await page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Download" })
            .Or(page.Locator("button, a").Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex("^\\s*Download\\s*$", RegexOptions.IgnoreCase),
            }))
            .CountAsync() > 0;

        if (!hasDownload)
        {
            // Also accept page body containing issued cert numbers + table.
            return await page.EvaluateAsync<bool>(
                """
                () => {
                  const text = document.body?.innerText || '';
                  const hasCert = /IND\/GATC\/KL\/26\/04\/26\/\d+/i.test(text);
                  const hasTable = !!document.querySelector('table tbody tr td');
                  const hasTitle = /Instrument Certificates|Certificates Issued/i.test(text);
                  return hasCert && hasTable && hasTitle;
                }
                """);
        }

        return await page.EvaluateAsync<bool>(
            """
            () => {
              const text = document.body?.innerText || '';
              return /IND\/GATC\/KL\/26\/04\/26\/\d+/i.test(text)
                || /Third Party Certificate/i.test(text)
                || /Instrument Certificates/i.test(text);
            }
            """);
    }

    private static async Task ClickCertificatesIssuedNavAsync(IPage page)
    {
        await WaitUntilOverlaysClearAsync(page, CancellationToken.None, maxSeconds: 10);

        // Prefer DOM click — bypasses Playwright actionability when overlay just cleared.
        var clicked = await page.EvaluateAsync<bool>(
            """
            () => {
              const nodes = Array.from(document.querySelectorAll('a, button, li, span, div'));
              const hit = nodes.find(n => {
                const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
                return /^Certificates Issued$/i.test(t);
              });
              if (!hit) return false;
              const target = hit.closest('a, button') || hit;
              target.scrollIntoView({ block: 'center' });
              target.click();
              return true;
            }
            """);

        if (clicked)
        {
            await page.WaitForTimeoutAsync(800);
            return;
        }

        // Exact sidebar item when possible.
        var candidates = new[]
        {
            page.Locator("a, button, li, span")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("^\\s*Certificates Issued\\s*$", RegexOptions.IgnoreCase),
                }),
            page.GetByRole(AriaRole.Link, new PageGetByRoleOptions { Name = "Certificates Issued" }),
            page.GetByText("Certificates Issued", new PageGetByTextOptions { Exact = true }),
        };

        foreach (var loc in candidates)
        {
            var n = await loc.CountAsync();
            for (var i = 0; i < Math.Min(n, 8); i++)
            {
                var el = loc.Nth(i);
                try
                {
                    if (!await el.IsVisibleAsync())
                    {
                        continue;
                    }

                    await el.ScrollIntoViewIfNeededAsync();
                    await el.ClickAsync(new LocatorClickOptions { Timeout = 8_000, Force = true });
                    await page.WaitForTimeoutAsync(600);
                    return;
                }
                catch (PlaywrightException)
                {
                }
            }
        }
    }

    public static async Task<EmaapCertificateDownloadResult> DownloadHighestMatchingAsync(
        IPage page,
        PartyContactDetails party,
        string downloadDirectory,
        CancellationToken cancellationToken = default,
        string? preferCertificateNumber = null,
        Func<string, Task>? onCertificateMatchedAsync = null)
    {
        ArgumentNullException.ThrowIfNull(page);
        ArgumentNullException.ThrowIfNull(party);

        // Mandatory: dismiss "Record saved successfully" OK before looking for Download.
        await DismissSuccessOkAsync(page, cancellationToken);
        await WaitUntilOverlaysClearAsync(page, cancellationToken, maxSeconds: 15);
        await OpenCertificatesIssuedAsync(page, cancellationToken);

        var wantBelong = NormalizeName(party.BelongToName);
        var wantMobile = NormalizeMobile(party.Mobile);
        if (string.IsNullOrWhiteSpace(wantBelong) || string.IsNullOrWhiteSpace(wantMobile))
        {
            throw new InvalidOperationException(
                "Belongs to and Mobile are required to match an eMAAP certificate row.");
        }

        await TryFilterIssuedListAsync(page, party.BelongToName, wantMobile, cancellationToken);

        var preferNormalized = NormalizeCertificateNumber(preferCertificateNumber);
        EmaapIssuedRowMatch? best = null;
        for (var attempt = 0; attempt < 12; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!string.IsNullOrWhiteSpace(preferNormalized))
            {
                best = await FindRowByCertificateNumberAsync(page, preferNormalized);
            }

            best ??= await FindHighestMatchingRowAsync(page, wantBelong, wantMobile);

            if (best is not null
                && (string.IsNullOrWhiteSpace(preferNormalized)
                    || string.Equals(
                        best.CertificateNumber,
                        preferNormalized,
                        StringComparison.OrdinalIgnoreCase)))
            {
                break;
            }

            best = null;
            await page.WaitForTimeoutAsync(600);
            if (attempt == 2)
            {
                await TrySetPageLengthAsync(page, 100);
            }

            if (attempt is 4 or 8)
            {
                await ClearIssuedListFiltersAsync(page);
                await page.WaitForTimeoutAsync(800);
            }

            if (attempt is 5 or 9)
            {
                await TryFilterIssuedListAsync(page, party.BelongToName, wantMobile, cancellationToken);
            }
        }

        if (best is null)
        {
            var sample = await SampleCertificateRowsAsync(page);
            var preferHint = string.IsNullOrWhiteSpace(preferNormalized)
                ? string.Empty
                : $" Preferred cert '{preferNormalized}' not found.";
            throw new InvalidOperationException(
                $"No Certificates Issued row matched Belongs to '{party.BelongToName}' and Mobile '{party.Mobile}'.{preferHint} " +
                $"Visible sample: {sample}");
        }

        if (onCertificateMatchedAsync is not null)
        {
            try
            {
                await onCertificateMatchedAsync(best.CertificateNumber);
            }
            catch
            {
                // Best-effort persist — download must still proceed.
            }
        }

        Directory.CreateDirectory(downloadDirectory);
        var safeCert = SanitizeFileSegment(best.CertificateNumber);
        var savePath = Path.Combine(downloadDirectory, $"{safeCert}.pdf");

        Exception? lastError = null;
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            TryDeleteFile(savePath);

            try
            {
                await SaveCertificatePdfViaDownloadClickAsync(
                    page,
                    best,
                    party.BelongToName,
                    savePath,
                    cancellationToken);

                if (await IsValidPdfFileAsync(savePath, cancellationToken))
                {
                    return new EmaapCertificateDownloadResult(best.CertificateNumber, savePath);
                }

                lastError = new InvalidOperationException(
                    $"Downloaded file for {best.CertificateNumber} is not a valid PDF" +
                    DescribeFileSniff(savePath) +
                    $" (attempt {attempt}/5).");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                lastError = ex;
            }

            // eMAAP sometimes serves HTML / empty until the certificate blob is ready.
            await page.WaitForTimeoutAsync(1_200 * attempt);
            await OpenCertificatesIssuedAsync(page, cancellationToken);
            await TryFilterIssuedListAsync(page, party.BelongToName, wantMobile, cancellationToken);
            if (!string.IsNullOrWhiteSpace(preferNormalized))
            {
                var again = await FindRowByCertificateNumberAsync(page, preferNormalized);
                if (again is not null)
                {
                    best = again;
                }
            }
            else
            {
                best = await FindHighestMatchingRowAsync(page, wantBelong, wantMobile) ?? best;
            }
        }

        throw new InvalidOperationException(
            lastError?.Message
            ?? $"Downloaded file for {best.CertificateNumber} is not a valid PDF.");
    }

    private static async Task<EmaapIssuedRowMatch?> FindRowByCertificateNumberAsync(
        IPage page,
        string certificateNumber)
    {
        var want = NormalizeCertificateNumber(certificateNumber);
        if (string.IsNullOrWhiteSpace(want))
        {
            return null;
        }

        var json = await page.EvaluateAsync<string>(
            """
            (wantCert) => {
              const norm = (s) => String(s || '').replace(/\s+/g, '');
              const want = norm(wantCert).toUpperCase();
              const seq = want.split('/').pop();
              const trs = Array.from(document.querySelectorAll('table tbody tr, table tr'));
              for (let index = 0; index < trs.length; index++) {
                const tr = trs[index];
                const text = (tr.innerText || '').replace(/\s+/g, ' ').trim();
                const compact = norm(text).toUpperCase();
                if (!compact.includes(want) && !(seq && compact.includes('26/04/26/' + seq))) continue;
                const m = text.match(/IND\s*\/\s*GATC\s*\/\s*KL\s*\/\s*26\s*\/\s*04\s*\/\s*26\s*\/\s*([\d\s]+)/i);
                if (!m) continue;
                const seqStr = m[1].replace(/\s+/g, '');
                const mobileMatch = text.match(/\b([6-9]\d{9})\b/);
                return JSON.stringify({
                  index,
                  certificateNumber: 'IND/GATC/KL/26/04/26/' + seqStr,
                  belongTo: '',
                  mobile: mobileMatch ? mobileMatch[1] : '',
                  sequence: parseInt(seqStr, 10) || 0
                });
              }
              return '';
            }
            """,
            want);

        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            var dto = JsonSerializer.Deserialize<IssuedMatchDto>(json);
            if (dto is null || string.IsNullOrWhiteSpace(dto.CertificateNumber))
            {
                return null;
            }

            return new EmaapIssuedRowMatch(
                dto.Index,
                NormalizeCertificateNumber(dto.CertificateNumber),
                dto.BelongTo ?? string.Empty,
                NormalizeMobile(dto.Mobile),
                dto.Sequence > 0 ? dto.Sequence : ParseSequence(dto.CertificateNumber));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// eMAAP Download often opens PDF in a new tab (not a file download). Capture either path.
    /// Never accept bytes that are not %PDF — Chrome sometimes yields HTML/error bodies.
    /// Uses in-browser fetch (Chrome TLS) — Playwright APIRequest fails with "local issuer certificate".
    /// </summary>
    private static async Task SaveCertificatePdfViaDownloadClickAsync(
        IPage page,
        EmaapIssuedRowMatch best,
        string belongToName,
        string savePath,
        CancellationToken cancellationToken)
    {
        IPage? pdfPage = null;
        Task<byte[]?>? pdfResponseBodyTask = null;

        void OnPage(object? _, IPage newPage)
        {
            pdfPage ??= newPage;
            pdfResponseBodyTask ??= CapturePdfResponseBodyAsync(newPage);
        }

        page.Context.Page += OnPage;

        Task<IDownload>? downloadTask = null;
        try
        {
            // Resume if prior click already left PDF tab open.
            foreach (var existing in page.Context.Pages)
            {
                var existingUrl = existing.Url ?? string.Empty;
                if (!IsEmaapCertificatePdfUrl(existingUrl)
                    && !LooksLikeChromePdfViewer(existingUrl))
                {
                    continue;
                }

                if (await TrySaveValidPdfFromBrowserTabAsync(
                        existing, existingUrl, savePath, cancellationToken))
                {
                    try
                    {
                        await existing.CloseAsync();
                    }
                    catch (PlaywrightException)
                    {
                    }

                    await page.BringToFrontAsync();
                    return;
                }
            }

            downloadTask = page.WaitForDownloadAsync(new PageWaitForDownloadOptions { Timeout = 120_000 });

            var clicked = await ClickIssuedDownloadAsync(page, best, belongToName);
            if (!clicked)
            {
                throw new InvalidOperationException(
                    $"Download button missing for certificate {best.CertificateNumber}.");
            }

            var deadline = DateTime.UtcNow.AddSeconds(120);
            while (DateTime.UtcNow < deadline)
            {
                cancellationToken.ThrowIfCancellationRequested();

                if (downloadTask is not null && downloadTask.IsCompletedSuccessfully)
                {
                    var download = await downloadTask;
                    var tempPath = savePath + ".download";
                    try
                    {
                        TryDeleteFile(tempPath);
                        await download.SaveAsAsync(tempPath);
                        if (await IsValidPdfFileAsync(tempPath, cancellationToken))
                        {
                            File.Copy(tempPath, savePath, overwrite: true);
                            return;
                        }
                    }
                    finally
                    {
                        TryDeleteFile(tempPath);
                        try
                        {
                            await download.DeleteAsync();
                        }
                        catch (PlaywrightException)
                        {
                        }
                    }

                    // Invalid download body — keep waiting for tab/response paths.
                    downloadTask = null;
                }

                if (downloadTask is not null
                    && (downloadTask.IsFaulted || downloadTask.IsCanceled))
                {
                    downloadTask = null;
                }

                if (pdfResponseBodyTask is not null && pdfResponseBodyTask.IsCompletedSuccessfully)
                {
                    var body = await pdfResponseBodyTask;
                    if (IsPdfBytes(body))
                    {
                        await File.WriteAllBytesAsync(savePath, body!, cancellationToken);
                        if (pdfPage is not null)
                        {
                            try
                            {
                                await pdfPage.CloseAsync();
                            }
                            catch (PlaywrightException)
                            {
                            }
                        }

                        await page.BringToFrontAsync();
                        return;
                    }

                    // Non-PDF response — try print fallback on the tab if still open.
                    pdfResponseBodyTask = null;
                }

                if (pdfPage is not null)
                {
                    try
                    {
                        await pdfPage.WaitForLoadStateAsync(
                            LoadState.DOMContentLoaded,
                            new PageWaitForLoadStateOptions { Timeout = 45_000 });
                    }
                    catch (PlaywrightException)
                    {
                    }

                    var url = pdfPage.Url ?? string.Empty;
                    if (IsEmaapCertificatePdfUrl(url) || LooksLikeChromePdfViewer(url))
                    {
                        if (await TrySaveValidPdfFromBrowserTabAsync(
                                pdfPage, url, savePath, cancellationToken))
                        {
                            try
                            {
                                await pdfPage.CloseAsync();
                            }
                            catch (PlaywrightException)
                            {
                            }

                            await page.BringToFrontAsync();
                            return;
                        }
                    }
                }

                await page.WaitForTimeoutAsync(250);
            }

            throw new TimeoutException(
                $"Timed out waiting for certificate PDF download/tab for {best.CertificateNumber}.");
        }
        finally
        {
            page.Context.Page -= OnPage;
        }
    }

    private static async Task<byte[]?> CapturePdfResponseBodyAsync(IPage pdfPage)
    {
        try
        {
            var response = await pdfPage.WaitForResponseAsync(
                static r => IsEmaapCertificatePdfUrl(r.Url) && r.Ok,
                new PageWaitForResponseOptions { Timeout = 90_000 });
            return await response.BodyAsync();
        }
        catch (PlaywrightException)
        {
            return null;
        }
    }

    /// <summary>Pull PDF bytes via Chrome navigation (TLS/cookies) — not Playwright APIRequest.</summary>
    private static async Task<bool> TrySaveValidPdfFromBrowserTabAsync(
        IPage browserPage,
        string url,
        string savePath,
        CancellationToken cancellationToken)
    {
        // 1) Fresh tab + WaitForResponse (works even when Chrome PDF viewer blocks page.evaluate).
        IPage? temp = null;
        try
        {
            temp = await browserPage.Context.NewPageAsync();
            var responseTask = temp.WaitForResponseAsync(
                r => IsEmaapCertificatePdfUrl(r.Url) && r.Ok,
                new PageWaitForResponseOptions { Timeout = 60_000 });
            await temp.GotoAsync(
                url,
                new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.Commit,
                    Timeout = 60_000,
                });
            var response = await responseTask;
            var body = await response.BodyAsync();
            if (IsPdfBytes(body))
            {
                await File.WriteAllBytesAsync(savePath, body, cancellationToken);
                return true;
            }
        }
        catch (Exception)
        {
            // fall through
        }
        finally
        {
            if (temp is not null)
            {
                try
                {
                    await temp.CloseAsync();
                }
                catch (PlaywrightException)
                {
                }
            }
        }

        // 2) fetch() inside an already-open tab (Chrome TLS). Avoid force-cache — can return stale HTML.
        try
        {
            var b64 = await browserPage.EvaluateAsync<string>(
                """
                async (targetUrl) => {
                  const target = targetUrl || location.href;
                  const r = await fetch(target, { credentials: 'include', cache: 'no-store' });
                  if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + target);
                  const buf = await r.arrayBuffer();
                  const bytes = new Uint8Array(buf);
                  let binary = '';
                  for (let i = 0; i < bytes.length; i += 0x8000) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                  }
                  return btoa(binary);
                }
                """,
                url);

            if (!string.IsNullOrWhiteSpace(b64))
            {
                var fetched = Convert.FromBase64String(b64);
                if (IsPdfBytes(fetched))
                {
                    await File.WriteAllBytesAsync(savePath, fetched, cancellationToken);
                    return true;
                }
            }
        }
        catch (Exception)
        {
            // fall through to print-to-PDF
        }

        // 3) Chrome PDF viewer: network body often unavailable — print the rendered tab.
        try
        {
            await browserPage.BringToFrontAsync();
            await browserPage.WaitForTimeoutAsync(800);
            var printed = await browserPage.PdfAsync(new PagePdfOptions
            {
                PrintBackground = true,
                PreferCSSPageSize = true,
            });
            if (IsPdfBytes(printed))
            {
                await File.WriteAllBytesAsync(savePath, printed, cancellationToken);
                return true;
            }
        }
        catch (Exception)
        {
            // ignore
        }

        return false;
    }

    private static bool IsEmaapCertificatePdfUrl(string url) =>
        url.Contains("thirPartyCertificate", StringComparison.OrdinalIgnoreCase)
        || url.Contains("thirdPartyCertificate", StringComparison.OrdinalIgnoreCase)
        || (url.Contains("gatcapi", StringComparison.OrdinalIgnoreCase)
            && url.Contains(".pdf", StringComparison.OrdinalIgnoreCase));

    private static bool LooksLikeChromePdfViewer(string url) =>
        url.Contains("chrome-extension://", StringComparison.OrdinalIgnoreCase)
        || url.Contains("blob:", StringComparison.OrdinalIgnoreCase);

    private static bool IsPdfBytes(byte[]? bytes) =>
        bytes is { Length: >= 5 }
        && bytes[0] == (byte)'%'
        && bytes[1] == (byte)'P'
        && bytes[2] == (byte)'D'
        && bytes[3] == (byte)'F';

    private static async Task<bool> IsValidPdfFileAsync(string path, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return false;
        }

        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        return IsPdfBytes(bytes);
    }

    private static string DescribeFileSniff(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return " (file missing)";
            }

            var bytes = File.ReadAllBytes(path);
            if (bytes.Length == 0)
            {
                return " (empty file)";
            }

            var take = Math.Min(80, bytes.Length);
            var text = System.Text.Encoding.ASCII.GetString(bytes, 0, take)
                .Replace('\r', ' ')
                .Replace('\n', ' ');
            return $" (len={bytes.Length}, head={text.Trim()})";
        }
        catch
        {
            return string.Empty;
        }
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // ignore
        }
    }
    private static async Task<bool> ClickIssuedDownloadAsync(
        IPage page,
        EmaapIssuedRowMatch best,
        string belongToName)
    {
        var clicked = await page.EvaluateAsync<bool>(
            """
            ([cert, mobile, belong]) => {
              const normName = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
              const normMobile = (s) => {
                const d = String(s || '').replace(/\D/g, '');
                return d.length > 10 ? d.slice(-10) : d;
              };
              const seq = String(cert).split('/').pop();
              const wantM = normMobile(mobile);
              const wantB = normName(belong);
              const certCompact = String(cert).replace(/\s+/g, '');
              const trs = Array.from(document.querySelectorAll('table tbody tr, table tr'));
              for (const tr of trs) {
                const text = (tr.innerText || '').replace(/\s+/g, ' ');
                const compact = text.replace(/\s+/g, '');
                if (!compact.includes(certCompact)
                    && !(seq && compact.includes('26/04/26/' + seq))) {
                  continue;
                }
                if (wantM && !text.includes(wantM)) continue;
                if (wantB && !normName(text).includes(wantB)) continue;
                const btn = Array.from(tr.querySelectorAll('button, a, span'))
                  .find(el => /^\s*Download\s*$/i.test((el.innerText || el.textContent || '').trim()));
                if (!btn) continue;
                btn.scrollIntoView({ block: 'center' });
                btn.click();
                return true;
              }
              return false;
            }
            """,
            new object[] { best.CertificateNumber, best.Mobile, belongToName });

        if (clicked)
        {
            return true;
        }

        var row = page.Locator("table tbody tr")
            .Filter(new LocatorFilterOptions { HasText = best.Mobile })
            .First;
        var downloadBtn = row.GetByRole(AriaRole.Button, new LocatorGetByRoleOptions { Name = "Download" })
            .Or(row.Locator("button, a")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("^\\s*Download\\s*$", RegexOptions.IgnoreCase),
                }));
        if (await downloadBtn.CountAsync() == 0)
        {
            return false;
        }

        await downloadBtn.First.ScrollIntoViewIfNeededAsync();
        await downloadBtn.First.ClickAsync(new LocatorClickOptions { Timeout = 30_000 });
        return true;
    }

    private static async Task TrySetPageLengthAsync(IPage page, int length)
    {
        try
        {
            var changed = await page.EvaluateAsync<bool>(
                """
                (n) => {
                  const selects = Array.from(document.querySelectorAll('select'));
                  for (const s of selects) {
                    const opts = Array.from(s.options || []);
                    const hit = opts.find(o => String(o.value) === String(n) || String(o.textContent).trim() === String(n));
                    if (!hit) continue;
                    s.value = hit.value;
                    s.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                  }
                  return false;
                }
                """,
                length);
            if (changed)
            {
                await page.WaitForTimeoutAsync(1_000);
            }
        }
        catch (PlaywrightException)
        {
        }
    }

    private static async Task ClearIssuedListFiltersAsync(IPage page)
    {
        try
        {
            await page.EvaluateAsync(
                """
                () => {
                  const inputs = Array.from(document.querySelectorAll(
                    'table input[type="text"], table input:not([type]), thead input, .dataTables_scrollHead input'));
                  for (const el of inputs) {
                    if (!el || el.disabled) continue;
                    el.focus();
                    el.value = '';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
                  }
                }
                """);
            await page.Keyboard.PressAsync("Enter");
            await page.WaitForTimeoutAsync(600);
        }
        catch (PlaywrightException)
        {
        }
    }

    private static async Task TryFilterIssuedListAsync(
        IPage page,
        string belongTo,
        string mobile10,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // Column filter inputs under headers. Match by header label — never guess wrong columns.
        var filled = await page.EvaluateAsync<bool>(
            """
            ([belongTo, mobile]) => {
              const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

              const findInputForHeader = (want) => {
                const wantN = norm(want);
                const cells = Array.from(document.querySelectorAll('th, td'));
                for (const cell of cells) {
                  const label = norm(cell.innerText || '').split('\n')[0];
                  if (!label.includes(wantN)) continue;
                  const input = cell.querySelector('input[type="text"], input:not([type])')
                    || cell.parentElement?.querySelector('input[type="text"], input:not([type])');
                  if (input) return input;
                }

                // Filter row: pair header row text with input row by column index.
                const tables = Array.from(document.querySelectorAll('table'));
                for (const table of tables) {
                  const rows = Array.from(table.querySelectorAll('tr'));
                  if (rows.length < 2) continue;
                  const headerCells = Array.from(rows[0].querySelectorAll('th,td'));
                  const filterCells = Array.from(rows[1].querySelectorAll('th,td'));
                  for (let i = 0; i < headerCells.length; i++) {
                    if (!norm(headerCells[i].innerText || '').includes(wantN)) continue;
                    const input = (filterCells[i] && filterCells[i].querySelector('input'))
                      || headerCells[i].querySelector('input');
                    if (input) return input;
                  }
                }
                return null;
              };

              const belongInput = findInputForHeader('belongs');
              const mobileInput = findInputForHeader('mobile');
              if (!belongInput && !mobileInput) return false;

              const setVal = (el, value) => {
                if (!el) return;
                el.focus();
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
              };

              setVal(belongInput, belongTo);
              setVal(mobileInput, mobile);
              return true;
            }
            """,
            new object[] { belongTo.Trim(), mobile10 });

        // Orange magnifying-glass search in Action filter cell.
        try
        {
            var searchBtn = page.Locator(
                "table th button, table thead button, table tr button.btn-warning, button.btn-warning");
            if (await searchBtn.CountAsync() > 0)
            {
                await searchBtn.Last.ClickAsync(new LocatorClickOptions { Timeout = 2_000 });
            }
        }
        catch (PlaywrightException)
        {
        }

        try
        {
            await page.Keyboard.PressAsync("Enter");
        }
        catch (PlaywrightException)
        {
        }

        await page.WaitForTimeoutAsync(filled ? 1_400 : 400);
    }

    private static async Task<EmaapIssuedRowMatch?> FindHighestMatchingRowAsync(
        IPage page,
        string wantBelong,
        string wantMobile)
    {
        // Match entirely in-page: Belongs+Mobile on row text; cert allows wrapped "23 10" → 2310.
        var json = await page.EvaluateAsync<string>(
            """
            ([wantBelong, wantMobile]) => {
              const normName = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
              const normMobile = (s) => {
                const d = String(s || '').replace(/\D/g, '');
                return d.length > 10 ? d.slice(-10) : d;
              };
              const parseCert = (raw) => {
                const m = String(raw || '').match(
                  /IND\s*\/\s*GATC\s*\/\s*KL\s*\/\s*26\s*\/\s*04\s*\/\s*26\s*\/\s*([\d\s]+)/i);
                if (!m) return null;
                const seqStr = m[1].replace(/\s+/g, '');
                if (!/^\d+$/.test(seqStr)) return null;
                const seq = parseInt(seqStr, 10);
                return { cert: 'IND/GATC/KL/26/04/26/' + seqStr, seq };
              };

              const wantB = normName(wantBelong);
              const wantM = normMobile(wantMobile);
              if (!wantB || wantM.length !== 10) return '';

              let best = null;
              const tables = Array.from(document.querySelectorAll('table'));
              for (const table of tables) {
                const trs = Array.from(table.querySelectorAll('tbody tr, tr'));
                for (let index = 0; index < trs.length; index++) {
                  const tr = trs[index];
                  const cells = Array.from(tr.querySelectorAll('td')).map(td =>
                    (td.innerText || '').replace(/\s+/g, ' ').trim());
                  if (cells.length < 4) continue;

                  const rowText = (tr.innerText || '').replace(/\s+/g, ' ').trim();
                  if (!/IND\s*\/\s*GATC/i.test(rowText)) continue;
                  // Skip filter rows that still contain a Search placeholder only.
                  if (/^search/i.test(rowText) && cells.every(c => !parseCert(c))) continue;

                  let mobile = '';
                  for (const c of cells) {
                    const m = normMobile(c);
                    if (m.length === 10 && /^[6-9]/.test(m)) { mobile = m; break; }
                  }
                  if (!mobile) {
                    const mm = rowText.match(/\b([6-9]\d{9})\b/);
                    if (mm) mobile = mm[1];
                  }
                  if (mobile !== wantM) continue;

                  const rowNorm = normName(rowText);
                  const belongHit =
                    rowNorm.includes(wantB)
                    || cells.some(c => {
                      const n = normName(c);
                      return n === wantB || n.includes(wantB) || wantB.includes(n);
                    });
                  if (!belongHit) continue;

                  let parsed = null;
                  for (const c of cells) {
                    const p = parseCert(c);
                    if (p && (!parsed || p.seq > parsed.seq)) parsed = p;
                  }
                  if (!parsed) parsed = parseCert(rowText);
                  if (!parsed) continue;

                  if (!best || parsed.seq > best.sequence) {
                    let belong = '';
                    for (let i = 0; i < cells.length; i++) {
                      if (parseCert(cells[i]) && i + 1 < cells.length) {
                        const next = cells[i + 1].trim();
                        if (next && normMobile(next).length !== 10) { belong = next; break; }
                      }
                    }
                    if (!belong) {
                      const hit = cells.find(c => normName(c).includes(wantB));
                      belong = hit || wantBelong;
                    }

                    best = {
                      index,
                      certificateNumber: parsed.cert,
                      belongTo: belong,
                      mobile,
                      sequence: parsed.seq
                    };
                  }
                }
              }

              return best ? JSON.stringify(best) : '';
            }
            """,
            new object[] { wantBelong, wantMobile });

        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            var dto = JsonSerializer.Deserialize<IssuedMatchDto>(json);
            if (dto is null || string.IsNullOrWhiteSpace(dto.CertificateNumber))
            {
                return null;
            }

            return new EmaapIssuedRowMatch(
                dto.Index,
                NormalizeCertificateNumber(dto.CertificateNumber),
                dto.BelongTo ?? string.Empty,
                NormalizeMobile(dto.Mobile),
                dto.Sequence > 0 ? dto.Sequence : ParseSequence(dto.CertificateNumber));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string NormalizeCertificateNumber(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var m = CertificateNumberRegex.Match(raw);
        if (!m.Success)
        {
            return Regex.Replace(raw, @"\s+", string.Empty);
        }

        var seq = Regex.Replace(m.Groups[1].Value, @"\s+", string.Empty);
        return $"IND/GATC/KL/26/04/26/{seq}";
    }

    private static async Task<string> SampleCertificateRowsAsync(IPage page)
    {
        try
        {
            var sample = await page.EvaluateAsync<string>(
                """
                () => {
                  const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
                  const re = /IND\s*\/\s*GATC\s*\/\s*KL\s*\/\s*26\s*\/\s*04\s*\/\s*26\s*\/\s*[\d\s]+/gi;
                  const matches = text.match(re) || [];
                  const normalized = [...new Set(matches.map(m =>
                    m.replace(/\s+/g, '').replace(/IND\/GATC\/KL\/26\/04\/26\//i, 'IND/GATC/KL/26/04/26/')
                  ))];
                  return normalized.slice(0, 5).join(', ') || '(no IND/GATC cert numbers in page text)';
                }
                """);
            return sample;
        }
        catch (PlaywrightException)
        {
            return "(could not sample page)";
        }
    }

    internal static int ParseSequence(string certificateNumber)
    {
        var normalized = NormalizeCertificateNumber(certificateNumber);
        var m = CertificateNumberRegex.Match(normalized);
        if (!m.Success)
        {
            var slash = normalized.LastIndexOf('/');
            if (slash >= 0
                && int.TryParse(normalized[(slash + 1)..], NumberStyles.Integer, CultureInfo.InvariantCulture, out var n))
            {
                return n;
            }

            return 0;
        }

        var seqStr = Regex.Replace(m.Groups[1].Value, @"\s+", string.Empty);
        return int.TryParse(seqStr, NumberStyles.Integer, CultureInfo.InvariantCulture, out var seq)
            ? seq
            : 0;
    }

    private static string NormalizeName(string? value) =>
        Regex.Replace((value ?? string.Empty).Trim().ToLowerInvariant(), @"\s+", " ");

    private static string DigitsOnly(string? value) =>
        new string((value ?? string.Empty).Where(char.IsDigit).ToArray());

    private static string NormalizeMobile(string? value)
    {
        var d = DigitsOnly(value);
        return d.Length > 10 ? d[^10..] : d;
    }

    private static string SanitizeFileSegment(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string(value.Select(ch => invalid.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? "certificate" : cleaned;
    }

    private static async Task<bool> HasSweetAlertAsync(IPage page) =>
        await HasBlockingOverlayAsync(page);

    private static async Task<bool> IsSuccessDialogVisibleAsync(IPage page) =>
        await page.EvaluateAsync<bool>(
            """
            () => {
              const overlay = document.querySelector('.swal-overlay--show-modal, .swal2-container');
              if (!overlay) {
                const text = document.body?.innerText || '';
                return /Record saved successfully/i.test(text) && /\bOK\b/.test(text);
              }
              const style = getComputedStyle(overlay);
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              const text = (overlay.innerText || document.body?.innerText || '');
              return /Record saved successfully/i.test(text)
                || !!overlay.querySelector('button.swal-button--confirm, button.swal2-confirm, button.swal-button');
            }
            """);

    private static async Task<bool> HasBlockingOverlayAsync(IPage page) =>
        await page.EvaluateAsync<bool>(
            """
            () => {
              const overlay = document.querySelector('.swal-overlay--show-modal, .swal-overlay.swal-overlay--show-modal, .swal2-container.swal2-shown');
              if (overlay) {
                const style = getComputedStyle(overlay);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                  const r = overlay.getBoundingClientRect();
                  if (r.width > 10 && r.height > 10) return true;
                }
              }
              const spinner = document.querySelector('.spinner-outer, .spinner-border, .loading, #content .spinner');
              if (spinner) {
                const style = getComputedStyle(spinner);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                  const r = spinner.getBoundingClientRect();
                  if (r.width > 5 && r.height > 5) return true;
                }
              }
              return false;
            }
            """);

    private static async Task WaitUntilOverlaysClearAsync(
        IPage page,
        CancellationToken cancellationToken,
        int maxSeconds = 15)
    {
        var deadline = DateTime.UtcNow.AddSeconds(Math.Max(1, maxSeconds));
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!await HasBlockingOverlayAsync(page))
            {
                return;
            }

            // Keep dismissing if OK reappears.
            await TryClickSweetAlertOkAsync(page);
            await page.WaitForTimeoutAsync(200);
        }
    }

    private static async Task<bool> TryClickSweetAlertOkAsync(IPage page)
    {
        var clicked = await page.EvaluateAsync<bool>(
            """
            () => {
              const selectors = [
                'button.swal-button--confirm',
                'button.swal-button.swal-button--confirm',
                '.swal-overlay--show-modal button.swal-button--confirm',
                '.swal-overlay button.swal-button--confirm',
                '.swal-modal button.swal-button--confirm',
                'button.swal2-confirm',
                '.swal2-actions button.swal2-confirm',
              ];
              for (const sel of selectors) {
                const b = document.querySelector(sel);
                if (!b) continue;
                const style = getComputedStyle(b);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                b.click();
                return true;
              }
              // Any visible OK inside active sweet alert.
              const root = document.querySelector('.swal-overlay--show-modal, .swal-modal, .swal2-popup') || document;
              for (const b of root.querySelectorAll('button')) {
                const t = (b.innerText || b.textContent || '').trim();
                if (t !== 'OK' && t !== 'Ok' && t !== 'Okay') continue;
                const style = getComputedStyle(b);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                b.click();
                return true;
              }
              return false;
            }
            """);

        if (clicked)
        {
            return true;
        }

        var ok = page.Locator(
                "button.swal-button--confirm, button.swal2-confirm, .swal-overlay--show-modal button.swal-button")
            .Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex("^\\s*OK(ay)?\\s*$", RegexOptions.IgnoreCase),
            })
            .First;
        if (await ok.CountAsync() == 0)
        {
            ok = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "OK", Exact = true }).First;
        }

        if (await ok.CountAsync() == 0)
        {
            return false;
        }

        try
        {
            await ok.ClickAsync(new LocatorClickOptions { Force = true, Timeout = 3_000 });
            return true;
        }
        catch (PlaywrightException)
        {
            try
            {
                await page.Keyboard.PressAsync("Enter");
                return true;
            }
            catch (PlaywrightException)
            {
                return false;
            }
        }
    }

    private sealed record EmaapIssuedRowMatch(
        int RowIndex,
        string CertificateNumber,
        string BelongTo,
        string Mobile,
        int Sequence);

    private sealed class IssuedMatchDto
    {
        [System.Text.Json.Serialization.JsonPropertyName("index")]
        public int Index { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("certificateNumber")]
        public string? CertificateNumber { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("belongTo")]
        public string? BelongTo { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("mobile")]
        public string? Mobile { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("sequence")]
        public int Sequence { get; set; }
    }
}
