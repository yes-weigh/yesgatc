using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Captcha OCR via chat.deepseek.com in a Playwright tab:
/// upload captcha image as-is → ask for exact glyphs → scrape reply.
/// Requires DeepSeek login once in the worker browser profile.
/// </summary>
public static class DeepSeekChatCaptchaOcr
{
    public const string ChatUrl = "https://chat.deepseek.com/";

    private static readonly Regex CaptchaTextPattern = new(
        "^[A-Za-z0-9]{4,8}$",
        RegexOptions.Compiled);

    /// <summary>DeepSeek UI status scraped as fake captcha (e.g. Analysing → Analysin).</summary>
    private static readonly Regex UiStatusNoise = new(
        @"^(analys|analyz|thinking|searching|search|vision|deepthink|loading|typing|generat|process|wait|answer|reply|reading|look)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private const string Prompt =
        """
        This image is a CASE-SENSITIVE website login captcha.
        Read the characters LEFT to RIGHT exactly as drawn.
        Preserve upper/lower case. Do not invent characters.
        Reply with ONLY the captcha text — no spaces, no quotes, no explanation.
        Example: aB3xYz
        """;

    public static async Task<string> ReadCaptchaFromImageAsync(
        byte[] imageBytes,
        IBrowserContext browserContext,
        CaptchaOcrSettings settings,
        CancellationToken cancellationToken = default,
        IPage? returnToPage = null)
    {
        ArgumentNullException.ThrowIfNull(browserContext);
        _ = settings;

        // Send original captcha — no black-only filter.
        var visionBytes = imageBytes;
        var tempPath = Path.Combine(
            Path.GetTempPath(),
            $"yesgatc-ds-captcha-{Guid.NewGuid():N}.png");
        await File.WriteAllBytesAsync(tempPath, visionBytes, cancellationToken);

        IPage? deepseek = null;
        var createdDeepSeek = false;
        using var allowBlank = BrowserPageGuard.AllowTransientBlankPages();
        try
        {
            await browserContext.GrantPermissionsAsync(
                ["clipboard-read", "clipboard-write"],
                new BrowserContextGrantPermissionsOptions { Origin = "https://chat.deepseek.com" });

            deepseek = FindExistingDeepSeekPage(browserContext);
            if (deepseek is null)
            {
                deepseek = await browserContext.NewPageAsync();
                createdDeepSeek = true;
                await deepseek.GotoAsync(
                    ChatUrl,
                    new PageGotoOptions
                    {
                        WaitUntil = WaitUntilState.DOMContentLoaded,
                        Timeout = 90_000,
                    });
            }
            else if (!deepseek.Url.Contains("chat.deepseek.com", StringComparison.OrdinalIgnoreCase))
            {
                await deepseek.GotoAsync(
                    ChatUrl,
                    new PageGotoOptions
                    {
                        WaitUntil = WaitUntilState.DOMContentLoaded,
                        Timeout = 90_000,
                    });
            }

            // Keep OCR off to the side — do not steal focus from eMAAP longer than needed.
            // BringToFront only for interact; restore portal in finally.
            await deepseek.BringToFrontAsync();

            if (await LooksLikeLoginGateAsync(deepseek))
            {
                throw new InvalidOperationException(
                    "DeepSeek login required — sign in once at chat.deepseek.com in this browser, then retry captcha.");
            }

            await EnsureChatReadyAsync(deepseek, cancellationToken);
            await EnsureFreshChatAsync(deepseek, cancellationToken);

            // Snapshot prior answer so we never reuse the previous captcha OCR result.
            var previousReply = SanitizeCaptcha(await ExtractLatestAssistantTextAsync(deepseek));
            var baselineFingerprints = await CollectAssistantFingerprintsAsync(deepseek);

            await AttachImageAsync(deepseek, tempPath, visionBytes, cancellationToken);
            // DeepSeek OCR fails on captcha PNGs — must switch to Vision (wait as before).
            await EnsureVisionModeAsync(deepseek, cancellationToken);
            await SendPromptAsync(deepseek, cancellationToken);

            var raw = await WaitForAssistantReplyAsync(
                deepseek,
                cancellationToken,
                previousReply,
                baselineFingerprints);
            var normalized = SanitizeCaptcha(raw);
            return CaptchaTextPattern.IsMatch(normalized) ? normalized : string.Empty;
        }
        finally
        {
            try
            {
                File.Delete(tempPath);
            }
            catch
            {
                // ignore
            }

            // Reuse DeepSeek tab across captchas — do not open a new one every OTP/login.
            // Only close if create failed mid-flight and page is blank junk.
            if (createdDeepSeek && deepseek is not null)
            {
                try
                {
                    if (IsBlankOrDead(deepseek))
                    {
                        await deepseek.CloseAsync();
                    }
                }
                catch
                {
                    // ignore
                }
            }

            await RestorePortalPageAsync(browserContext, returnToPage);
        }
    }

    private static IPage? FindExistingDeepSeekPage(IBrowserContext browserContext)
    {
        foreach (var page in browserContext.Pages)
        {
            try
            {
                if (page.Url.Contains("chat.deepseek.com", StringComparison.OrdinalIgnoreCase))
                {
                    return page;
                }
            }
            catch (PlaywrightException)
            {
                // closed
            }
        }

        return null;
    }

    private static bool IsBlankOrDead(IPage page)
    {
        try
        {
            var url = page.Url;
            return string.IsNullOrWhiteSpace(url)
                || url.Equals("about:blank", StringComparison.OrdinalIgnoreCase)
                || url.StartsWith("chrome://", StringComparison.OrdinalIgnoreCase);
        }
        catch (PlaywrightException)
        {
            return true;
        }
    }

    private static async Task RestorePortalPageAsync(IBrowserContext browserContext, IPage? returnToPage)
    {
        try
        {
            if (returnToPage is not null)
            {
                await returnToPage.BringToFrontAsync();
                return;
            }

            var portal = browserContext.Pages.FirstOrDefault(p =>
            {
                try
                {
                    return p.Url.Contains("emaap.gov.in", StringComparison.OrdinalIgnoreCase)
                        || p.Url.Contains("doca.gov.in", StringComparison.OrdinalIgnoreCase);
                }
                catch (PlaywrightException)
                {
                    return false;
                }
            });

            if (portal is not null)
            {
                await portal.BringToFrontAsync();
            }
        }
        catch (PlaywrightException)
        {
            // ignore
        }
    }

    private static async Task<bool> LooksLikeLoginGateAsync(IPage page)
    {
        var url = page.Url;
        if (url.Contains("/sign_in", StringComparison.OrdinalIgnoreCase)
            || url.Contains("/login", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var login = page.Locator(
            "button:has-text('Log in'), button:has-text('Sign in'), a:has-text('Log in'), a:has-text('Sign in')");
        if (await login.CountAsync() == 0)
        {
            return false;
        }

        var composer = page.Locator("textarea, [contenteditable='true']");
        return await composer.CountAsync() == 0;
    }

    private static async Task EnsureChatReadyAsync(IPage page, CancellationToken cancellationToken)
    {
        var composer = page.Locator("textarea, [contenteditable='true']").Last;
        await composer.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 60_000,
        });
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task EnsureFreshChatAsync(IPage page, CancellationToken cancellationToken)
    {
        await TryStartNewChatAsync(page);
        await page.WaitForTimeoutAsync(700);
        cancellationToken.ThrowIfCancellationRequested();

        // Old thread still showing a short captcha answer → hard reset to new chat URL.
        var leftover = SanitizeCaptcha(await ExtractLatestAssistantTextAsync(page));
        if (!CaptchaTextPattern.IsMatch(leftover))
        {
            return;
        }

        try
        {
            await page.GotoAsync(
                ChatUrl,
                new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 60_000,
                });
            await EnsureChatReadyAsync(page, cancellationToken);
            await TryStartNewChatAsync(page);
            await page.WaitForTimeoutAsync(500);
        }
        catch (PlaywrightException)
        {
            // continue with exclude-previous logic
        }
    }

    private static async Task TryStartNewChatAsync(IPage page)
    {
        var candidates = new[]
        {
            "button:has-text('New chat')",
            "button:has-text('New Chat')",
            "div[role='button']:has-text('New chat')",
            "[aria-label*='New chat' i]",
            "[data-testid*='new-chat' i]",
        };

        foreach (var selector in candidates)
        {
            var btn = page.Locator(selector).First;
            if (await btn.CountAsync() == 0 || !await btn.IsVisibleAsync())
            {
                continue;
            }

            try
            {
                await btn.ClickAsync(new LocatorClickOptions { Timeout = 3_000 });
                await page.WaitForTimeoutAsync(600);
                return;
            }
            catch (PlaywrightException)
            {
                // try next
            }
        }

        // DOM fallback
        try
        {
            await page.EvaluateAsync(
                """
                () => {
                  const nodes = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
                  for (const el of nodes) {
                    const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
                    if (/^new chat$/i.test(t) || /new chat/i.test(t) && t.length < 24) {
                      el.click();
                      return;
                    }
                  }
                }
                """);
            await page.WaitForTimeoutAsync(600);
        }
        catch (PlaywrightException)
        {
        }
    }

    private static async Task<HashSet<string>> CollectAssistantFingerprintsAsync(IPage page)
    {
        var list = await page.EvaluateAsync<string[]>(
            """
            () => {
              const pickText = (el) => (el?.innerText || el?.textContent || '').trim();
              const out = [];
              const selectors = [
                '[data-message-author-role="assistant"]',
                '.ds-message',
                '[class*="message"]',
                '.markdown',
                '.md-box',
              ];
              for (const sel of selectors) {
                for (const el of document.querySelectorAll(sel)) {
                  const t = pickText(el);
                  if (!t || t.includes('CASE-SENSITIVE website login captcha')) continue;
                  const compact = t.replace(/[^A-Za-z0-9]/g, '');
                  if (compact.length >= 4 && compact.length <= 8) out.push(compact);
                  else if (t.length > 0 && t.length < 40) out.push(t);
                }
              }
              return [...new Set(out)];
            }
            """) ?? [];

        return new HashSet<string>(list, StringComparer.OrdinalIgnoreCase);
    }

    private static async Task<string> WaitForAssistantReplyAsync(
        IPage page,
        CancellationToken cancellationToken,
        string previousSanitized,
        HashSet<string> baselineFingerprints)
    {
        var deadline = DateTime.UtcNow.AddSeconds(90);
        string stableCandidate = string.Empty;
        var stableHits = 0;

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await PageHasVisionHintAsync(page))
            {
                await TryClickVisionAsync(page);
            }

            // Still generating ("Analysing…") — do not scrape yet.
            if (await IsDeepSeekStillGeneratingAsync(page))
            {
                await page.WaitForTimeoutAsync(500);
                continue;
            }

            var text = (await ExtractLatestAssistantTextAsync(page)).Trim();
            if (string.IsNullOrWhiteSpace(text) || IsUiStatusText(text))
            {
                stableCandidate = string.Empty;
                stableHits = 0;
                await page.WaitForTimeoutAsync(400);
                continue;
            }

            var sanitized = SanitizeCaptcha(text);
            if (string.IsNullOrWhiteSpace(sanitized)
                || IsUiStatusNoiseToken(sanitized)
                || !CaptchaTextPattern.IsMatch(sanitized))
            {
                stableCandidate = string.Empty;
                stableHits = 0;
                await page.WaitForTimeoutAsync(400);
                continue;
            }

            var isOld =
                (!string.IsNullOrWhiteSpace(previousSanitized)
                 && sanitized.Equals(previousSanitized, StringComparison.OrdinalIgnoreCase))
                || baselineFingerprints.Contains(sanitized);

            if (isOld)
            {
                stableCandidate = string.Empty;
                stableHits = 0;
                await page.WaitForTimeoutAsync(400);
                continue;
            }

            // Require the same captcha token twice ~1.2s apart so streaming mid-status is ignored.
            if (sanitized.Equals(stableCandidate, StringComparison.Ordinal))
            {
                stableHits++;
                if (stableHits >= 2)
                {
                    return sanitized;
                }
            }
            else
            {
                stableCandidate = sanitized;
                stableHits = 1;
            }

            await page.WaitForTimeoutAsync(600);
        }

        return string.Empty;
    }

    private static bool IsUiStatusNoiseToken(string sanitized) =>
        !string.IsNullOrWhiteSpace(sanitized) && UiStatusNoise.IsMatch(sanitized);

    private static bool IsUiStatusText(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return true;
        }

        if (Regex.IsMatch(
                text,
                @"\b(analysing|analyzing|thinking|searching|deepthink|generating|loading)\b",
                RegexOptions.IgnoreCase))
        {
            return true;
        }

        // Strip to alnum without calling SanitizeCaptcha (avoid recursion).
        var compact = Regex.Replace(text, "[^A-Za-z0-9]", string.Empty);
        if (compact.Length > 8)
        {
            compact = compact[..8];
        }

        return IsUiStatusNoiseToken(compact);
    }

    private static async Task<bool> IsDeepSeekStillGeneratingAsync(IPage page)
    {
        try
        {
            return await page.EvaluateAsync<bool>(
                """
                () => {
                  const stop = document.querySelector(
                    'button[aria-label*="stop" i], button[aria-label*="Stop" i]');
                  if (stop) {
                    const cs = getComputedStyle(stop);
                    const r = stop.getBoundingClientRect();
                    if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0) {
                      return true;
                    }
                  }

                  // Active status chip near bottom only (ignore older chat history).
                  const floor = window.innerHeight - 420;
                  const nodes = Array.from(document.querySelectorAll('div,span,p,button'));
                  for (let i = nodes.length - 1; i >= Math.max(0, nodes.length - 60); i--) {
                    const el = nodes[i];
                    const t = (el.innerText || el.textContent || '').trim();
                    if (!t || t.length > 28) continue;
                    if (!/^(Analysing|Analyzing|Thinking|Searching|Generating)\b/i.test(t)) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.bottom >= floor) return true;
                  }
                  return false;
                }
                """);
        }
        catch (PlaywrightException)
        {
            return false;
        }
    }

    private static async Task<string> ExtractLatestAssistantTextAsync(IPage page)
    {
        return await page.EvaluateAsync<string>(
            """
            () => {
              const pickText = (el) => (el?.innerText || el?.textContent || '').trim();
              const isNoise = (t) => {
                if (!t) return true;
                if (/CASE-SENSITIVE website login captcha/i.test(t)) return true;
                if (/^(Analysing|Analyzing|Thinking|Searching|Generating|Vision|DeepThink)\b/i.test(t.trim())) return true;
                if (/\b(Analysing|Analyzing|Thinking)\.{0,3}$/i.test(t.trim()) && t.length < 24) return true;
                return false;
              };

              const selectors = [
                '[data-message-author-role="assistant"]',
                '.ds-message',
                '[class*="message"]',
                '[class*="Message"]',
                '.markdown',
                '.md-box',
              ];

              // Prefer the newest short captcha-like token (scan from end).
              for (const sel of selectors) {
                const nodes = Array.from(document.querySelectorAll(sel));
                for (let i = nodes.length - 1; i >= 0; i--) {
                  const t = pickText(nodes[i]);
                  if (isNoise(t)) continue;
                  const compact = t.replace(/\s+/g, '');
                  if (/^[A-Za-z0-9]{4,8}$/.test(compact)
                      && !/^(analys|analyz|thinking|search|vision|deepthink)/i.test(compact)) {
                    return compact;
                  }
                }
              }

              let best = '';
              for (const sel of selectors) {
                const nodes = Array.from(document.querySelectorAll(sel));
                for (let i = nodes.length - 1; i >= 0; i--) {
                  const t = pickText(nodes[i]);
                  if (isNoise(t)) continue;
                  if (t.length > best.length && t.length < 80) best = t;
                  const compact = t.replace(/\s+/g, '');
                  if (/^[A-Za-z0-9]{4,8}$/.test(compact)
                      && !/^(analys|analyz|thinking|search|vision|deepthink)/i.test(compact)) {
                    return t;
                  }
                }
                if (best) return best;
              }

              return best;
            }
            """) ?? string.Empty;
    }

    private static string SanitizeCaptcha(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || IsUiStatusText(raw))
        {
            return string.Empty;
        }

        // Prefer a standalone 4–8 token on its own line.
        foreach (var line in raw.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (IsUiStatusText(line))
            {
                continue;
            }

            var compact = Regex.Replace(line, @"\s+", string.Empty);
            compact = Regex.Replace(compact, "[^A-Za-z0-9]", string.Empty);
            if (CaptchaTextPattern.IsMatch(compact) && !IsUiStatusNoiseToken(compact))
            {
                return compact;
            }
        }

        var all = Regex.Replace(raw, "[^A-Za-z0-9]", string.Empty);
        if (all.Length > 8)
        {
            all = all[..8];
        }

        if (IsUiStatusNoiseToken(all) || !CaptchaTextPattern.IsMatch(all))
        {
            return string.Empty;
        }

        return all;
    }

    private static async Task AttachImageAsync(
        IPage page,
        string tempPath,
        byte[] visionBytes,
        CancellationToken cancellationToken)
    {
        // Prefer hidden file input (most reliable).
        var fileInput = page.Locator("input[type='file']").First;
        if (await fileInput.CountAsync() > 0)
        {
            try
            {
                await fileInput.SetInputFilesAsync(tempPath);
                await page.WaitForTimeoutAsync(120);
                cancellationToken.ThrowIfCancellationRequested();
                return;
            }
            catch (PlaywrightException)
            {
                // fall through to clipboard paste
            }
        }

        // Click attach / upload affordance, then set files again if a new input appears.
        var attach = page.Locator(
            "button[aria-label*='upload' i], button[aria-label*='attach' i], button[aria-label*='image' i], button:has(svg):near(textarea)").First;
        if (await attach.CountAsync() > 0 && await attach.IsVisibleAsync())
        {
            try
            {
                await attach.ClickAsync(new LocatorClickOptions { Timeout = 2_000 });
                await page.WaitForTimeoutAsync(100);
                fileInput = page.Locator("input[type='file']").First;
                if (await fileInput.CountAsync() > 0)
                {
                    await fileInput.SetInputFilesAsync(tempPath);
                    await page.WaitForTimeoutAsync(120);
                    return;
                }
            }
            catch (PlaywrightException)
            {
                // clipboard fallback
            }
        }

        await PasteImageFromClipboardAsync(page, visionBytes, cancellationToken);
    }

    private static async Task PasteImageFromClipboardAsync(
        IPage page,
        byte[] visionBytes,
        CancellationToken cancellationToken)
    {
        var b64 = Convert.ToBase64String(visionBytes);
        await page.EvaluateAsync(
            """
            async (b64) => {
              const binary = atob(b64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const blob = new Blob([bytes], { type: 'image/png' });
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            }
            """,
            b64);

        var composer = page.Locator("textarea, [contenteditable='true']").Last;
        await composer.ClickAsync();
        await page.Keyboard.PressAsync("Control+v");
        // Paste → prompt ASAP (caller sends prompt next).
        await page.WaitForTimeoutAsync(120);
        cancellationToken.ThrowIfCancellationRequested();
    }

    /// <summary>
    /// After image upload DeepSeek shows "No text found. Try Vision." — click Vision and wait for it.
    /// </summary>
    private static async Task EnsureVisionModeAsync(IPage page, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow.AddSeconds(12);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await TryClickVisionAsync(page))
            {
                // Wait for Vision to process the attachment (do not rush the answer path).
                await page.WaitForTimeoutAsync(1_200);
                if (await PageHasVisionHintAsync(page))
                {
                    await TryClickVisionAsync(page);
                    await page.WaitForTimeoutAsync(800);
                }

                return;
            }

            if (!await PageHasVisionHintAsync(page)
                && await page.Locator("img[src*='blob'], img[src*='data:image'], [class*='file'], [class*='attachment']").CountAsync() > 0)
            {
                // Image attached, no Vision hint yet — keep waiting briefly.
                await page.WaitForTimeoutAsync(300);
                continue;
            }

            await page.WaitForTimeoutAsync(250);
        }
    }

    private static async Task<bool> PageHasVisionHintAsync(IPage page)
    {
        var body = page.Locator("body");
        var text = await body.InnerTextAsync();
        return text.Contains("Try Vision", StringComparison.OrdinalIgnoreCase)
            || text.Contains("No text found", StringComparison.OrdinalIgnoreCase)
            || text.Contains("No text extract", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<bool> TryClickVisionAsync(IPage page)
    {
        // Prefer the blue "Vision" link inside "No text found. Try Vision."
        var candidates = new[]
        {
            "a:has-text('Vision')",
            "button:has-text('Vision')",
            "[role='button']:has-text('Vision')",
            "span:has-text('Vision')",
            "div:has-text('Try Vision') a",
            "div:has-text('Try Vision') button",
            "div:has-text('Try Vision') span:has-text('Vision')",
        };

        foreach (var selector in candidates)
        {
            var loc = page.Locator(selector).Last;
            try
            {
                if (await loc.CountAsync() == 0 || !await loc.IsVisibleAsync())
                {
                    continue;
                }

                await loc.ClickAsync(new LocatorClickOptions { Timeout = 2_500 });
                return true;
            }
            catch (PlaywrightException)
            {
                // try next
            }
        }

        try
        {
            var byRole = page.GetByRole(AriaRole.Link, new PageGetByRoleOptions { Name = "Vision" });
            if (await byRole.CountAsync() > 0)
            {
                await byRole.Last.ClickAsync(new LocatorClickOptions { Timeout = 2_500 });
                return true;
            }
        }
        catch (PlaywrightException)
        {
        }

        // DOM fallback: click element whose visible text is exactly Vision near the hint.
        try
        {
            var clicked = await page.EvaluateAsync<bool>(
                """
                () => {
                  const nodes = Array.from(document.querySelectorAll('a,button,span,div'));
                  for (const el of nodes) {
                    const t = (el.innerText || el.textContent || '').trim();
                    if (t === 'Vision' || t === 'Try Vision') {
                      el.click();
                      return true;
                    }
                  }
                  // Partial: blue link inside "No text found. Try Vision."
                  for (const el of nodes) {
                    const t = (el.innerText || '').trim();
                    if (/try\s+vision/i.test(t) && t.length < 40) {
                      const child = Array.from(el.querySelectorAll('a,button,span'))
                        .find(c => (c.innerText || '').trim() === 'Vision');
                      (child || el).click();
                      return true;
                    }
                  }
                  return false;
                }
                """);
            return clicked;
        }
        catch (PlaywrightException)
        {
            return false;
        }
    }

    private static async Task SendPromptAsync(IPage page, CancellationToken cancellationToken)
    {
        var composer = page.Locator("textarea, [contenteditable='true']").Last;
        await composer.ClickAsync();
        try
        {
            await composer.FillAsync(Prompt);
        }
        catch (PlaywrightException)
        {
            await page.Keyboard.TypeAsync(Prompt, new KeyboardTypeOptions { Delay = 0 });
        }

        cancellationToken.ThrowIfCancellationRequested();

        // Paste → prompt → submit immediately (blue send / Ctrl+Enter; plain Enter often inserts newline).
        if (!await TryClickSendButtonAsync(page))
        {
            await composer.ClickAsync();
            await page.Keyboard.PressAsync("Control+Enter");
        }

        await WaitUntilComposerClearedAsync(page, cancellationToken);
    }

    private static async Task<bool> TryClickSendButtonAsync(IPage page)
    {
        var selectors = new[]
        {
            "button[aria-label*='Send' i]",
            "button[data-testid*='send' i]",
            "div[role='button'][aria-label*='Send' i]",
        };

        foreach (var selector in selectors)
        {
            var loc = page.Locator(selector).Last;
            try
            {
                if (await loc.CountAsync() == 0 || !await loc.IsVisibleAsync())
                {
                    continue;
                }

                await loc.ClickAsync(new LocatorClickOptions { Timeout = 2_500 });
                return true;
            }
            catch (PlaywrightException)
            {
            }
        }

        try
        {
            var clicked = await page.EvaluateAsync<bool>(
                """
                () => {
                  const reject = /deepthink|search|vision|login|sign|attach|upload|file|new chat/i;
                  const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                  const scored = [];
                  for (const b of buttons) {
                    if (b.disabled) continue;
                    const cs = getComputedStyle(b);
                    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
                    const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
                    if (reject.test(t)) continue;
                    const rect = b.getBoundingClientRect();
                    if (rect.width < 24 || rect.height < 24 || rect.width > 72 || rect.height > 72) continue;
                    if (rect.bottom < 0 || rect.top > innerHeight) continue;
                    const hasSvg = !!b.querySelector('svg');
                    if (!hasSvg && t.toLowerCase() !== 'send') continue;
                    const bg = cs.backgroundColor || '';
                    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                    let blueScore = 0;
                    if (m) {
                      const r = +m[1], g = +m[2], bl = +m[3];
                      if (bl > r + 20 && bl > g + 10 && bl > 120) blueScore = 100;
                    }
                    // Prefer bottom-right icon buttons (send sits there).
                    const posScore = rect.y + rect.x;
                    scored.push({ el: b, score: blueScore * 10000 + posScore, blueScore });
                  }
                  scored.sort((a, b) => b.score - a.score);
                  const best = scored.find(s => s.blueScore > 0) || scored[0];
                  if (!best) return false;
                  best.el.click();
                  return true;
                }
                """);
            return clicked;
        }
        catch (PlaywrightException)
        {
            return false;
        }
    }

    private static async Task WaitUntilComposerClearedAsync(IPage page, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow.AddSeconds(8);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var text = await page.Locator("textarea, [contenteditable='true']").Last.InputValueAsync();
                if (string.IsNullOrWhiteSpace(text)
                    || !text.Contains("CASE-SENSITIVE", StringComparison.Ordinal))
                {
                    return;
                }
            }
            catch (PlaywrightException)
            {
                // contenteditable may not support InputValue — check inner text
                try
                {
                    var inner = await page.Locator("textarea, [contenteditable='true']").Last.InnerTextAsync();
                    if (string.IsNullOrWhiteSpace(inner)
                        || !inner.Contains("CASE-SENSITIVE", StringComparison.Ordinal))
                    {
                        return;
                    }
                }
                catch (PlaywrightException)
                {
                    return;
                }
            }

            // Retry send if still stuck with draft.
            await TryClickSendButtonAsync(page);
            await page.WaitForTimeoutAsync(400);
        }
    }
}
