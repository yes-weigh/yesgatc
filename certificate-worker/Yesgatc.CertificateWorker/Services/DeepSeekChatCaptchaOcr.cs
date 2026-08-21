using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
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

    private static readonly object RecentAnswersLock = new();
    private static readonly Queue<string> RecentAnswers = new();
    private static readonly SemaphoreSlim OcrGate = new(1, 1);
    private const int RecentAnswerCapacity = 12;

    private const string Prompt =
        """
        Look at the attached captcha image with Vision.
        Reply with exactly one line:
        CAPTCHA=xxxxxx
        xxxxxx is the characters left to right, case-sensitive, no spaces.
        Example: CAPTCHA=aB3xYz
        No other words.
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
        await OcrGate.WaitAsync(cancellationToken);
        try
        {
            using var allowBlank = BrowserPageGuard.AllowTransientBlankPages();
            await browserContext.GrantPermissionsAsync(
                ["clipboard-read", "clipboard-write"],
                new BrowserContextGrantPermissionsOptions { Origin = "https://chat.deepseek.com" });

            deepseek = FindExistingDeepSeekPage(browserContext);
            if (deepseek is null)
            {
                deepseek = await browserContext.NewPageAsync();
                createdDeepSeek = true;
            }

            // Keep OCR off to the side — do not steal focus from eMAAP longer than needed.
            await deepseek.BringToFrontAsync();

            // Always hard-reset chat so prior captcha images/answers cannot leak into this OCR.
            await ForceFreshChatAsync(deepseek, cancellationToken);

            if (await LooksLikeLoginGateAsync(deepseek))
            {
                throw new InvalidOperationException(
                    "DeepSeek login required — sign in once at chat.deepseek.com in this browser, then retry captcha.");
            }

            var forbidden = SnapshotRecentAnswers();
            var previousReply = SanitizeCaptcha(await ExtractLatestAssistantTextAsync(deepseek));
            if (!string.IsNullOrWhiteSpace(previousReply))
            {
                forbidden.Add(previousReply);
            }

            var baselineFingerprints = await CollectAssistantFingerprintsAsync(deepseek);
            foreach (var fp in baselineFingerprints)
            {
                var clean = SanitizeCaptcha(fp);
                if (!string.IsNullOrWhiteSpace(clean))
                {
                    forbidden.Add(clean);
                }
            }

            await ClearComposerAttachmentsAsync(deepseek);
            if (!await AttachCaptchaImageOnceAsync(deepseek, tempPath, cancellationToken))
            {
                return string.Empty;
            }

            // Captcha PNGs fail DeepSeek text OCR — Vision must be active before send.
            if (!await EnsureVisionModeAsync(deepseek, cancellationToken))
            {
                return string.Empty;
            }

            await SendPromptAsync(deepseek, cancellationToken);

            // Vision hint reappearing after send = model never saw the image.
            if (await PageHasVisionHintAsync(deepseek))
            {
                if (!await TryClickVisionAsync(deepseek) || await PageHasVisionHintAsync(deepseek))
                {
                    return string.Empty;
                }

                await deepseek.WaitForTimeoutAsync(800);
            }

            var raw = await WaitForAssistantReplyAsync(
                deepseek,
                cancellationToken,
                previousReply,
                baselineFingerprints,
                forbidden);
            var normalized = SanitizeCaptcha(raw);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                raw = await ExtractLatestAssistantTextAsync(deepseek);
                normalized = SanitizeCaptcha(raw);
            }

            if (!CaptchaTextPattern.IsMatch(normalized) || IsRecentAnswer(normalized))
            {
                return string.Empty;
            }

            RememberAnswer(normalized);
            return normalized;
        }
        catch (PlaywrightException ex) when (
            ex.Message.Contains("Execution context was destroyed", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("Target closed", StringComparison.OrdinalIgnoreCase)
            || ex.Message.Contains("Frame was detached", StringComparison.OrdinalIgnoreCase))
        {
            // eMAAP/DeepSeek navigated mid-OCR — treat as failed attempt, refresh + retry.
            return string.Empty;
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
            OcrGate.Release();
        }
    }

    private static HashSet<string> SnapshotRecentAnswers()
    {
        lock (RecentAnswersLock)
        {
            return new HashSet<string>(RecentAnswers, StringComparer.Ordinal);
        }
    }

    private static bool IsRecentAnswer(string answer)
    {
        if (string.IsNullOrWhiteSpace(answer))
        {
            return false;
        }

        lock (RecentAnswersLock)
        {
            return RecentAnswers.Any(x => x.Equals(answer, StringComparison.Ordinal));
        }
    }

    private static void RememberAnswer(string answer)
    {
        if (string.IsNullOrWhiteSpace(answer))
        {
            return;
        }

        lock (RecentAnswersLock)
        {
            RecentAnswers.Enqueue(answer);
            while (RecentAnswers.Count > RecentAnswerCapacity)
            {
                RecentAnswers.Dequeue();
            }
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

    private static async Task ForceFreshChatAsync(IPage page, CancellationToken cancellationToken)
    {
        // Hard navigation clears stacked attachments + prior assistant tokens.
        await page.GotoAsync(
            ChatUrl,
            new PageGotoOptions
            {
                WaitUntil = WaitUntilState.DOMContentLoaded,
                Timeout = 90_000,
            });
        await EnsureChatReadyAsync(page, cancellationToken);
        await TryStartNewChatAsync(page);
        await page.WaitForTimeoutAsync(500);
        await ClearComposerAttachmentsAsync(page);
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task ClearComposerAttachmentsAsync(IPage page)
    {
        for (var round = 0; round < 12; round++)
        {
            int removed;
            try
            {
                removed = await page.EvaluateAsync<int>(
                    """
                    () => {
                      let n = 0;
                      const floor = window.innerHeight * 0.38;
                      const click = (el) => {
                        try { el.click(); n++; } catch {}
                      };

                      // 1) Explicit remove/close controls in the composer band.
                      const nodes = Array.from(document.querySelectorAll(
                        'button, [role="button"], span, div, a'));
                      for (const el of nodes) {
                        const label = (
                          el.getAttribute('aria-label')
                          || el.getAttribute('title')
                          || el.innerText
                          || ''
                        ).trim();
                        if (!label) continue;
                        const isRemove =
                          /^(remove|delete|close|×|✕|x)$/i.test(label)
                          || /remove (file|image|attachment)|delete (file|image|attachment)/i.test(label);
                        if (!isRemove) continue;
                        const r = el.getBoundingClientRect();
                        if (r.width <= 0 || r.height <= 0 || r.bottom < floor) continue;
                        click(el);
                      }

                      // 2) X button near each composer thumbnail (DeepSeek often has no aria-label).
                      const imgs = Array.from(document.querySelectorAll('img'));
                      for (const img of imgs) {
                        const ir = img.getBoundingClientRect();
                        if (ir.width < 16 || ir.height < 16 || ir.bottom < floor) continue;
                        if (ir.width > 180 || ir.height > 180) continue;
                        let host = img.parentElement;
                        for (let d = 0; d < 4 && host; d++, host = host.parentElement) {
                          const btns = Array.from(host.querySelectorAll('button, [role="button"]'));
                          for (const b of btns) {
                            const br = b.getBoundingClientRect();
                            if (br.width <= 0 || br.height <= 0) continue;
                            // Small control overlapping / beside the thumb.
                            if (br.width > 40 || br.height > 40) continue;
                            const near =
                              Math.abs(br.left - ir.right) < 28
                              || Math.abs(br.right - ir.right) < 28
                              || (br.left >= ir.left - 8 && br.top <= ir.top + 8);
                            if (!near) continue;
                            click(b);
                          }
                        }
                      }
                      return n;
                    }
                    """);
            }
            catch (PlaywrightException)
            {
                return;
            }

            if (removed <= 0)
            {
                break;
            }

            await page.WaitForTimeoutAsync(180);
        }

        // Escape can dismiss leftover chips.
        try
        {
            await page.Keyboard.PressAsync("Escape");
            await page.WaitForTimeoutAsync(120);
        }
        catch (PlaywrightException)
        {
        }
    }

    private static async Task<int> CountComposerAttachmentsAsync(IPage page)
    {
        try
        {
            return await page.EvaluateAsync<int>(
                """
                () => {
                  const floor = window.innerHeight * 0.38;
                  const imgs = Array.from(document.querySelectorAll('img'));
                  let count = 0;
                  for (const img of imgs) {
                    const r = img.getBoundingClientRect();
                    // Composer thumbs are small squares near the input; skip avatars / heroes.
                    if (r.width < 16 || r.height < 16) continue;
                    if (r.width > 180 || r.height > 180) continue;
                    if (r.bottom < floor) continue;
                    count++;
                  }
                  return count;
                }
                """);
        }
        catch (PlaywrightException)
        {
            return 0;
        }
    }

    /// <summary>
    /// Attach exactly one file via the file input. Never clipboard paste (Control+V stacked images).
    /// </summary>
    private static async Task<bool> AttachCaptchaImageOnceAsync(
        IPage page,
        string tempPath,
        CancellationToken cancellationToken)
    {
        await WaitUntilComposerClearAsync(page, cancellationToken);
        if (!await AttachImageOnceViaFileInputAsync(page, tempPath, cancellationToken))
        {
            return false;
        }

        var deadline = DateTime.UtcNow.AddSeconds(6);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var count = await CountComposerAttachmentsAsync(page);
            if (count == 1)
            {
                return true;
            }

            if (count > 1)
            {
                await ForceFreshChatAsync(page, cancellationToken);
                await WaitUntilComposerClearAsync(page, cancellationToken);
                if (!await AttachImageOnceViaFileInputAsync(page, tempPath, cancellationToken))
                {
                    return false;
                }

                await page.WaitForTimeoutAsync(500);
                return await CountComposerAttachmentsAsync(page) == 1;
            }

            await page.WaitForTimeoutAsync(200);
        }

        // File input was set once. Composer thumbs are not always <img> — do not re-paste.
        return await CountComposerAttachmentsAsync(page) <= 1;
    }

    private static async Task WaitUntilComposerClearAsync(IPage page, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow.AddSeconds(3);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await ClearComposerAttachmentsAsync(page);
            if (await CountComposerAttachmentsAsync(page) == 0)
            {
                return;
            }

            await page.WaitForTimeoutAsync(120);
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
        HashSet<string> baselineFingerprints,
        HashSet<string> forbiddenAnswers)
    {
        var deadline = DateTime.UtcNow.AddSeconds(90);
        string stableCandidate = string.Empty;
        var stableHits = 0;
        var idleAfterGenerate = 0;

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await PageHasVisionHintAsync(page))
            {
                await TryClickVisionAsync(page);
                await page.WaitForTimeoutAsync(500);
                continue;
            }

            if (await IsDeepSeekStillGeneratingAsync(page))
            {
                idleAfterGenerate = 0;
                stableCandidate = string.Empty;
                stableHits = 0;
                await page.WaitForTimeoutAsync(400);
                continue;
            }

            idleAfterGenerate++;
            // Wait until generation has been idle ~1.2s so the last bubble is complete.
            if (idleAfterGenerate < 3)
            {
                await page.WaitForTimeoutAsync(400);
                continue;
            }

            var text = (await ExtractLatestAssistantTextAsync(page)).Trim();
            var sanitized = SanitizeCaptcha(text);
            if (string.IsNullOrWhiteSpace(sanitized)
                || IsUiStatusNoiseToken(sanitized)
                || !CaptchaTextPattern.IsMatch(sanitized))
            {
                stableCandidate = string.Empty;
                stableHits = 0;
                await page.WaitForTimeoutAsync(350);
                continue;
            }

            var isForbidden =
                forbiddenAnswers.Contains(sanitized)
                || (!string.IsNullOrWhiteSpace(previousSanitized)
                    && sanitized.Equals(previousSanitized, StringComparison.OrdinalIgnoreCase))
                || baselineFingerprints.Contains(sanitized)
                || IsRecentAnswer(sanitized);

            if (isForbidden)
            {
                stableCandidate = string.Empty;
                stableHits = 0;
                await page.WaitForTimeoutAsync(350);
                continue;
            }

            if (sanitized.Equals(stableCandidate, StringComparison.Ordinal))
            {
                stableHits++;
                if (stableHits >= 2)
                {
                    if (await PageHasVisionHintAsync(page) || await IsDeepSeekStillGeneratingAsync(page))
                    {
                        stableCandidate = string.Empty;
                        stableHits = 0;
                        continue;
                    }

                    return sanitized;
                }
            }
            else
            {
                stableCandidate = sanitized;
                stableHits = 1;
            }

            await page.WaitForTimeoutAsync(350);
        }

        return SanitizeCaptcha(await ExtractLatestAssistantTextAsync(page));
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
              const pick = (el) => (el?.innerText || el?.textContent || '').trim();
              const isUserPrompt = (t) => /CAPTCHA=xxxxxx|Look at the attached captcha|CASE-SENSITIVE website login captcha/i.test(t);
              const isStatus = (t) => /^(Analysing|Analyzing|Thinking|Searching|Generating|Vision|DeepThink)\b/i.test(t.trim());
              const selectors = [
                '[data-message-author-role="assistant"]',
                '.ds-markdown',
                '.md-box',
                '.markdown',
                '[class*="ds-message"]',
                '[class*="message"]',
              ];

              const bubbles = [];
              for (const sel of selectors) {
                for (const el of document.querySelectorAll(sel)) {
                  const t = pick(el);
                  if (!t || t.length > 400) continue;
                  if (isUserPrompt(t) || isStatus(t)) continue;
                  const r = el.getBoundingClientRect();
                  if (r.width <= 0 || r.height <= 0) continue;
                  bubbles.push({ t, y: r.top });
                }
                if (bubbles.length) break;
              }

              if (!bubbles.length) {
                const nodes = Array.from(document.querySelectorAll('div,p,pre,code,span'));
                for (let i = nodes.length - 1; i >= 0; i--) {
                  const t = pick(nodes[i]);
                  if (!t || t.length > 120 || isUserPrompt(t) || isStatus(t)) continue;
                  if (/CAPTCHA\s*=\s*[A-Za-z0-9]{4,8}/i.test(t) || /^[A-Za-z0-9]{4,8}$/.test(t.replace(/\s+/g,''))) {
                    return t;
                  }
                }
                return '';
              }

              bubbles.sort((a, b) => b.y - a.y);
              return bubbles[0].t;
            }
            """) ?? string.Empty;
    }

    private static string SanitizeCaptcha(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || IsUiStatusText(raw))
        {
            return string.Empty;
        }

        var labeled = Regex.Match(raw, @"CAPTCHA\s*=\s*([A-Za-z0-9]{4,8})", RegexOptions.IgnoreCase);
        if (labeled.Success)
        {
            var token = labeled.Groups[1].Value;
            if (CaptchaTextPattern.IsMatch(token) && !IsUiStatusNoiseToken(token))
            {
                return token;
            }
        }

        var tick = Regex.Match(raw, "`([A-Za-z0-9]{4,8})`");
        if (tick.Success && CaptchaTextPattern.IsMatch(tick.Groups[1].Value)
            && !IsUiStatusNoiseToken(tick.Groups[1].Value))
        {
            return tick.Groups[1].Value;
        }

        var quoted = Regex.Match(raw, "[\"']([A-Za-z0-9]{4,8})[\"']");
        if (quoted.Success && CaptchaTextPattern.IsMatch(quoted.Groups[1].Value)
            && !IsUiStatusNoiseToken(quoted.Groups[1].Value))
        {
            return quoted.Groups[1].Value;
        }

        var tokens = Regex.Matches(raw, @"\b([A-Za-z0-9]{4,8})\b");
        for (var i = tokens.Count - 1; i >= 0; i--)
        {
            var token = tokens[i].Groups[1].Value;
            if (CaptchaTextPattern.IsMatch(token) && !IsUiStatusNoiseToken(token))
            {
                return token;
            }
        }

        return string.Empty;
    }

    /// <summary>
    /// One SetInputFiles on a single file input. Never Control+V — clipboard paste stacks thumbs.
    /// </summary>
    private static async Task<bool> AttachImageOnceViaFileInputAsync(
        IPage page,
        string tempPath,
        CancellationToken cancellationToken)
    {
        var fileInputs = page.Locator("input[type='file']");
        var n = await fileInputs.CountAsync();
        if (n > 0)
        {
            try
            {
                await fileInputs.Nth(n - 1).SetInputFilesAsync(tempPath);
                await page.WaitForTimeoutAsync(300);
                cancellationToken.ThrowIfCancellationRequested();
                return true;
            }
            catch (PlaywrightException)
            {
                // try chooser path
            }
        }

        try
        {
            var chooserTask = page.WaitForFileChooserAsync(new PageWaitForFileChooserOptions { Timeout = 3_000 });
            var attach = page.Locator(
                "button[aria-label*='upload' i], button[aria-label*='attach' i], button[aria-label*='image' i]").First;
            if (await attach.CountAsync() == 0 || !await attach.IsVisibleAsync())
            {
                return false;
            }

            await attach.ClickAsync(new LocatorClickOptions { Timeout = 2_000 });
            var chooser = await chooserTask;
            await chooser.SetFilesAsync(tempPath);
            await page.WaitForTimeoutAsync(300);
            cancellationToken.ThrowIfCancellationRequested();
            return true;
        }
        catch (PlaywrightException)
        {
            return false;
        }
    }

    /// <summary>
    /// After image upload DeepSeek shows "No text found. Try Vision." — click Vision and wait for it.
    /// Returns false if the Vision banner is still visible (OCR would be garbage).
    /// </summary>
    private static async Task<bool> EnsureVisionModeAsync(IPage page, CancellationToken cancellationToken)
    {
        var clickedVision = false;
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await TryClickVisionAsync(page))
            {
                clickedVision = true;
                // Wait for Vision to process the attachment (do not rush the answer path).
                await page.WaitForTimeoutAsync(1_200);
                if (await PageHasVisionHintAsync(page))
                {
                    await TryClickVisionAsync(page);
                    await page.WaitForTimeoutAsync(800);
                }

                break;
            }

            if (!await PageHasVisionHintAsync(page)
                && await CountComposerAttachmentsAsync(page) == 1)
            {
                // Image attached, no Vision hint yet — keep waiting briefly for banner.
                await page.WaitForTimeoutAsync(300);
                continue;
            }

            await page.WaitForTimeoutAsync(250);
        }

        // Fail hard: banner still up means text-OCR path (wrong / invented glyphs).
        if (await PageHasVisionHintAsync(page))
        {
            return false;
        }

        // Prefer an explicit Vision click; if banner never appeared, allow proceed only with one image.
        return clickedVision || await CountComposerAttachmentsAsync(page) == 1;
    }

    private static async Task<bool> PageHasVisionHintAsync(IPage page)
    {
        try
        {
            return await page.EvaluateAsync<bool>(
                """
                () => {
                  const floor = window.innerHeight * 0.35;
                  const nodes = Array.from(document.querySelectorAll('div,span,p,a,button'));
                  for (const el of nodes) {
                    const t = (el.innerText || el.textContent || '').trim();
                    if (!t || t.length > 90) continue;
                    if (!/Try Vision|No text found|No text extract/i.test(t)) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && r.bottom >= floor) return true;
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
