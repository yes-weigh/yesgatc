using System.Text.RegularExpressions;
using Microsoft.Playwright;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Opens Gmail and reads eMAAP login OTP from ansibletest ("Your Login OTP").
/// Uses the same Chrome profile cookies (must already be signed into Gmail).
/// </summary>
public static class GmailOtpReader
{
    /// <summary>Known eMAAP OTP mail sender (inbox display name).</summary>
    public const string OtpSender = "ansibletest";

    /// <summary>Known eMAAP OTP mail subject.</summary>
    public const string OtpSubject = "Your Login OTP";

    private static readonly Regex OtpForLoginIs = new(
        @"(?i)(?:one[-\s]?time\s+password\s*\(?\s*OTP\s*\)?|OTP)\s+for\s+login\s+is\s*:?\s*(\d{6})",
        RegexOptions.Compiled);

    private static readonly Regex OtpNearLabel = new(
        @"(?i)(?:otp|one[-\s]?time(?:\s+password)?|verification\s+code|login\s+code)[^\d]{0,48}(\d{6})",
        RegexOptions.Compiled);

    private static readonly Regex StandaloneOtp = new(
        @"\b(\d{6})\b",
        RegexOptions.Compiled);

    /// <summary>Inbox URL opened after eMAAP Send OTP.</summary>
    public const string InboxUrl = "https://mail.google.com/mail/u/0/#inbox";

    /// <summary>Gmail search hash for ansibletest OTP mails (open manually to debug).</summary>
    public static string SearchUrl =>
        "https://mail.google.com/mail/u/0/#search/"
        + Uri.EscapeDataString($"newer_than:1d from:({OtpSender}) subject:(\"{OtpSubject}\")");

    /// <summary>Last failure detail for Activity / status (tab left open on failure).</summary>
    public static string? LastFailureReason { get; set; }

    private static string SearchQuery =>
        $"newer_than:1d from:({OtpSender}) subject:(\"{OtpSubject}\")";

    public static async Task<string?> TryReadRecentOtpAsync(
        IBrowserContext browserContext,
        DateTimeOffset requestedAtUtc,
        CancellationToken cancellationToken = default,
        Action<string>? report = null)
    {
        ArgumentNullException.ThrowIfNull(browserContext);
        LastFailureReason = null;
        using var allowBlank = BrowserPageGuard.AllowTransientBlankPages();
        var gmail = await browserContext.NewPageAsync();
        var closeTab = true;
        try
        {
            report?.Invoke($"Opening Gmail: {InboxUrl}");
            await gmail.GotoAsync(
                InboxUrl,
                new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 90_000,
                });
            await gmail.BringToFrontAsync();

            if (await LooksLikeGoogleLoginAsync(gmail))
            {
                closeTab = false;
                LastFailureReason =
                    $"Gmail login wall at {gmail.Url}. Sign in, then retry. Search URL: {SearchUrl}";
                throw new InvalidOperationException(LastFailureReason);
            }

            await WaitForInboxShellAsync(gmail, cancellationToken);

            // Fast path: OTP often visible in inbox snippet without search.
            var fromInbox = await TryExtractFromNewestVisibleAsync(
                gmail,
                requestedAtUtc,
                cancellationToken,
                requireSenderMatch: true);
            if (!string.IsNullOrWhiteSpace(fromInbox))
            {
                report?.Invoke($"Found OTP from {OtpSender}: {fromInbox}");
                return fromInbox;
            }

            report?.Invoke($"Searching Gmail: {SearchQuery}");
            await RunSearchAsync(gmail, SearchQuery, cancellationToken);

            var deadline = DateTime.UtcNow.AddSeconds(90);
            string? best = null;
            while (DateTime.UtcNow < deadline)
            {
                cancellationToken.ThrowIfCancellationRequested();
                best = await TryExtractFromNewestVisibleAsync(
                    gmail,
                    requestedAtUtc,
                    cancellationToken,
                    requireSenderMatch: true);
                if (!string.IsNullOrWhiteSpace(best))
                {
                    report?.Invoke($"Found OTP from {OtpSender}: {best}");
                    return best;
                }

                await RunSearchAsync(
                    gmail,
                    $"newer_than:1d (\"{OtpSubject}\" OR from:{OtpSender} OR \"OTP for login\")",
                    cancellationToken);
                best = await TryExtractFromNewestVisibleAsync(
                    gmail,
                    requestedAtUtc,
                    cancellationToken,
                    requireSenderMatch: false);
                if (!string.IsNullOrWhiteSpace(best))
                {
                    report?.Invoke($"Found OTP: {best}");
                    return best;
                }

                report?.Invoke($"Waiting for {OtpSender} OTP email…");
                await gmail.Keyboard.PressAsync("Control+Shift+r");
                await gmail.WaitForTimeoutAsync(2_500);
                await RunSearchAsync(gmail, SearchQuery, cancellationToken);
            }

            closeTab = false;
            LastFailureReason =
                $"No OTP mail from {OtpSender} found. Tab left open. Try: {SearchUrl}";
            report?.Invoke(LastFailureReason);
            return null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            closeTab = false;
            LastFailureReason ??= $"{ex.Message} | inbox={InboxUrl} | search={SearchUrl}";
            report?.Invoke(LastFailureReason);
            throw;
        }
        finally
        {
            if (closeTab)
            {
                try
                {
                    await gmail.CloseAsync();
                }
                catch
                {
                    // ignore
                }
            }
        }
    }

    private static async Task<bool> LooksLikeGoogleLoginAsync(IPage page)
    {
        var url = page.Url;
        return url.Contains("accounts.google.com", StringComparison.OrdinalIgnoreCase)
            || url.Contains("ServiceLogin", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task WaitForInboxShellAsync(IPage page, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow.AddSeconds(45);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (await LooksLikeGoogleLoginAsync(page))
            {
                throw new InvalidOperationException(
                    "Gmail is not signed in on this Chrome profile. Sign into Gmail once, Save profile, retry.");
            }

            var search = page.Locator("input[aria-label*='Search' i], form[role='search'] input").First;
            if (await search.CountAsync() > 0 && await search.IsVisibleAsync())
            {
                return;
            }

            await page.WaitForTimeoutAsync(400);
        }

        throw new InvalidOperationException("Gmail inbox did not load (search box missing).");
    }

    private static async Task RunSearchAsync(IPage page, string query, CancellationToken cancellationToken)
    {
        var search = page.Locator("input[aria-label*='Search' i], form[role='search'] input").First;
        await search.ClickAsync(new LocatorClickOptions { Timeout = 10_000 });
        await search.FillAsync(string.Empty);
        await search.FillAsync(query);
        await page.Keyboard.PressAsync("Enter");
        await page.WaitForTimeoutAsync(2_000);
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task<string?> TryExtractFromNewestVisibleAsync(
        IPage page,
        DateTimeOffset requestedAtUtc,
        CancellationToken cancellationToken,
        bool requireSenderMatch)
    {
        var rows = page.Locator("tr.zA, div[role='main'] tr[role='row']");
        var count = Math.Min(await rows.CountAsync(), 12);
        if (count == 0)
        {
            return null;
        }

        for (var i = 0; i < count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var row = rows.Nth(i);
            if (!await row.IsVisibleAsync())
            {
                continue;
            }

            var rowText = (await row.InnerTextAsync()) ?? string.Empty;
            if (requireSenderMatch && !LooksLikeAnsibleOtpMail(rowText))
            {
                continue;
            }

            if (!requireSenderMatch && !LooksLikeOtpMail(rowText))
            {
                continue;
            }

            if (LooksStaleRelative(rowText, requestedAtUtc))
            {
                continue;
            }

            // Snippet often already has: "Your One-Time Password (OTP) for login is: 059180"
            var fromSnippet = ExtractOtp(rowText);
            if (!string.IsNullOrWhiteSpace(fromSnippet) && LooksLikeAnsibleOtpMail(rowText))
            {
                return fromSnippet;
            }

            try
            {
                await row.ClickAsync(new LocatorClickOptions { Timeout = 5_000 });
            }
            catch (PlaywrightException)
            {
                continue;
            }

            await page.WaitForTimeoutAsync(900);
            var body = await ReadOpenMessageTextAsync(page);
            var otp = ExtractOtp(body) ?? ExtractOtp(rowText);
            if (!string.IsNullOrWhiteSpace(otp))
            {
                return otp;
            }

            await page.Keyboard.PressAsync("Escape");
            await page.WaitForTimeoutAsync(400);
        }

        return null;
    }

    private static bool LooksLikeAnsibleOtpMail(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var hasSender = text.Contains(OtpSender, StringComparison.OrdinalIgnoreCase);
        var hasSubject = text.Contains(OtpSubject, StringComparison.OrdinalIgnoreCase)
            || text.Contains("Login OTP", StringComparison.OrdinalIgnoreCase)
            || text.Contains("OTP for login", StringComparison.OrdinalIgnoreCase);
        return hasSender && (hasSubject || StandaloneOtp.IsMatch(text));
    }

    private static bool LooksLikeOtpMail(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        return LooksLikeAnsibleOtpMail(text)
            || text.Contains(OtpSubject, StringComparison.OrdinalIgnoreCase)
            || text.Contains("OTP for login", StringComparison.OrdinalIgnoreCase)
            || text.Contains("OTP Verification", StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksStaleRelative(string rowText, DateTimeOffset requestedAtUtc)
    {
        if (Regex.IsMatch(rowText, @"\b(\d+)\s*day", RegexOptions.IgnoreCase))
        {
            return true;
        }

        var hourMatch = Regex.Match(rowText, @"\b(\d+)\s*hour", RegexOptions.IgnoreCase);
        if (hourMatch.Success && int.TryParse(hourMatch.Groups[1].Value, out var hours) && hours >= 2)
        {
            return true;
        }

        _ = requestedAtUtc;
        return false;
    }

    private static async Task<string> ReadOpenMessageTextAsync(IPage page)
    {
        var body = page.Locator("div.a3s, div[data-message-id] div.a3s, div[role='listitem'] div.a3s").Last;
        if (await body.CountAsync() > 0)
        {
            try
            {
                return await body.InnerTextAsync() ?? string.Empty;
            }
            catch (PlaywrightException)
            {
            }
        }

        return await page.Locator("div[role='main']").InnerTextAsync() ?? string.Empty;
    }

    /// <summary>Extract 6-digit OTP; keeps leading zeros (e.g. 059180).</summary>
    public static string? ExtractOtp(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var forLogin = OtpForLoginIs.Match(text);
        if (forLogin.Success)
        {
            return forLogin.Groups[1].Value;
        }

        var labeled = OtpNearLabel.Match(text);
        if (labeled.Success)
        {
            return labeled.Groups[1].Value;
        }

        // Prefer last 6-digit token near OTP wording; else last 6-digit in text.
        var matches = StandaloneOtp.Matches(text);
        if (matches.Count == 0)
        {
            return null;
        }

        return matches[^1].Groups[1].Value;
    }
}
