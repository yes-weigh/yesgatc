using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public static class DocaLoginAutomation
{
    private static readonly Regex PostSubmitFailurePattern = new(
        @"\b(invalid captcha|captcha (is )?invalid|captcha mismatch|wrong captcha|invalid credentials|incorrect (email|password|credentials)|login failed)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static async Task<DocaSessionState> TryLoginAsync(
        IPage page,
        AutomationSettings settings,
        DocaCredentialSettings credentials,
        CancellationToken cancellationToken = default,
        Func<CaptchaAttemptReport, Task>? reportAttemptAsync = null)
    {
        var email = credentials.Email.Trim();
        var password = credentials.Password;
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            return DocaSessionState.LoginRequired;
        }

        await WaitForLoginFormAsync(page, cancellationToken);

        if (!settings.AutoSolveCaptcha)
        {
            await FillCredentialsAsync(page, credentials);
            return DocaSessionState.LoginRequired;
        }

        return await TryLoginWithOcrAsync(page, settings, credentials, cancellationToken, reportAttemptAsync);
    }

    private static async Task<DocaSessionState> TryLoginWithOcrAsync(
        IPage page,
        AutomationSettings settings,
        DocaCredentialSettings credentials,
        CancellationToken cancellationToken,
        Func<CaptchaAttemptReport, Task>? reportAttemptAsync)
    {
        await FillCredentialsAsync(page, credentials);

        var maxAttempts = Math.Max(1, settings.CaptchaMaxAttempts);
        var ocrProvider = ResolveOcrProviderLabel(settings.CaptchaOcr);
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var imageBytes = await ReadCaptchaImageBytesAsync(page, cancellationToken);
            var captchaText = await DocaCaptchaReader.ReadCaptchaFromImageAsync(
                imageBytes,
                settings.CaptchaOcr,
                cancellationToken);
            if (string.IsNullOrWhiteSpace(captchaText) || captchaText.Length < 4)
            {
                if (reportAttemptAsync is not null)
                {
                    await reportAttemptAsync(new CaptchaAttemptReport(
                        imageBytes,
                        captchaText,
                        ocrProvider,
                        attempt,
                        false,
                        "ocr_failed"));
                }

                if (attempt < maxAttempts)
                {
                    await ClickCaptchaRefreshAsync(page, cancellationToken);
                }

                continue;
            }

            await FillCaptchaAsync(page, captchaText);
            await SubmitLoginAsync(page);

            var loginSucceeded = await WaitForLoginResultAsync(page, cancellationToken);
            if (reportAttemptAsync is not null)
            {
                await reportAttemptAsync(new CaptchaAttemptReport(
                    imageBytes,
                    captchaText,
                    ocrProvider,
                    attempt,
                    loginSucceeded,
                    loginSucceeded ? "login_success" : "invalid_captcha"));
            }

            if (loginSucceeded)
            {
                return DocaSessionState.LoggedIn;
            }

            if (attempt < maxAttempts)
            {
                await ClickCaptchaRefreshAsync(page, cancellationToken);
            }
        }

        return DocaSessionState.LoginRequired;
    }

    private static string ResolveOcrProviderLabel(CaptchaOcrSettings settings)
    {
        if (settings.Provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase)
            || settings.Provider.Equals("AI", StringComparison.OrdinalIgnoreCase))
        {
            return settings.CombineWithTesseract ? "openai+tesseract" : "openai";
        }

        return "tesseract";
    }

    private static async Task<byte[]> ReadCaptchaImageBytesAsync(IPage page, CancellationToken cancellationToken)
    {
        await WaitForCaptchaImageReadyAsync(page);
        var captchaImage = FindCaptchaImage(page);
        cancellationToken.ThrowIfCancellationRequested();

        // DOCA generates a new captcha on every /captcha-image HTTP request.
        // Read pixels already painted in Chrome — never fetch that URL separately.
        var domBytes = await ExtractRenderedCaptchaBytesAsync(page);
        if (domBytes is { Length: > 100 })
        {
            return domBytes;
        }

        return await captchaImage.ScreenshotAsync(new LocatorScreenshotOptions { Type = ScreenshotType.Png });
    }

    private static async Task ClickCaptchaRefreshAsync(IPage page, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var previousSrc = await FindCaptchaImage(page).GetAttributeAsync("src") ?? string.Empty;

        var refresh = page.Locator(".captcha-box button[onclick*='refreshCaptcha'], button[onclick*='refreshCaptcha']").First;
        if (await refresh.CountAsync() > 0)
        {
            await refresh.ClickAsync(new LocatorClickOptions { Timeout = 5_000 });
        }
        else
        {
            await page.EvaluateAsync("() => { if (typeof refreshCaptcha === 'function') refreshCaptcha(); }");
        }

        await WaitForCaptchaImageChangeAsync(page, previousSrc);
        await ClearCaptchaInputAsync(page);
    }

    private static async Task WaitForLoginFormAsync(IPage page, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await page.WaitForSelectorAsync(
            "#captcha, input[name='captcha'], input[placeholder*='Captcha' i]",
            new PageWaitForSelectorOptions { State = WaitForSelectorState.Visible, Timeout = 20_000 });
        await page.WaitForSelectorAsync(
            "#captcha-image, .captcha-box img",
            new PageWaitForSelectorOptions { State = WaitForSelectorState.Visible, Timeout = 20_000 });
        await WaitForCaptchaImageReadyAsync(page);
    }

    private static async Task FillCredentialsAsync(IPage page, DocaCredentialSettings credentials)
    {
        var emailField = page.Locator("input[type='email'], input[name*='email' i], input[id*='email' i]").First;
        if (await emailField.CountAsync() > 0)
        {
            await emailField.FillAsync(credentials.Email.Trim());
        }

        var passwordField = page.Locator("input[type='password']").First;
        if (await passwordField.CountAsync() > 0)
        {
            await passwordField.FillAsync(credentials.Password);
        }
    }

    private static async Task FillCaptchaAsync(IPage page, string captchaText)
    {
        var captchaInput = FindCaptchaInput(page);
        await captchaInput.ClickAsync();
        await captchaInput.FillAsync(captchaText);
    }

    private static async Task SubmitLoginAsync(IPage page)
    {
        var loginButton = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Login Now" });
        if (await loginButton.CountAsync() == 0)
        {
            loginButton = page.Locator("button, input[type='submit']")
                .Filter(new LocatorFilterOptions { HasTextRegex = new Regex("^\\s*Login Now\\s*$", RegexOptions.IgnoreCase) });
        }

        if (await loginButton.CountAsync() == 0)
        {
            throw new InvalidOperationException("Could not find the DOCA Login Now button.");
        }

        await loginButton.First.ClickAsync(new LocatorClickOptions { Timeout = 15_000 });
    }

    private static async Task<bool> WaitForLoginResultAsync(IPage page, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow.AddSeconds(18);

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!await IsStillOnLoginPageAsync(page))
            {
                return true;
            }

            if (await HasPostSubmitLoginFailureAsync(page))
            {
                return false;
            }

            await page.WaitForTimeoutAsync(400);
        }

        return !await IsStillOnLoginPageAsync(page);
    }

    private static async Task<bool> IsStillOnLoginPageAsync(IPage page)
    {
        if (page.Url.Contains("/login", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var captchaInput = page.Locator("#captcha, input[name='captcha']");
        return await captchaInput.CountAsync() > 0;
    }

    private static async Task<bool> HasPostSubmitLoginFailureAsync(IPage page)
    {
        var alerts = page.Locator(".alert-danger, .alert-warning, .invalid-feedback, .help-block.text-danger");
        var count = await alerts.CountAsync();
        for (var i = 0; i < count; i++)
        {
            var text = (await alerts.Nth(i).InnerTextAsync()).Trim();
            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }

            if (text.Contains("please login first", StringComparison.OrdinalIgnoreCase)
                && !PostSubmitFailurePattern.IsMatch(text))
            {
                continue;
            }

            if (PostSubmitFailurePattern.IsMatch(text))
            {
                return true;
            }
        }

        return false;
    }

    private static ILocator FindCaptchaImage(IPage page) =>
        page.Locator("#captcha-image, .captcha-box .captcha-img img, .captcha-box img").First;

    private static ILocator FindCaptchaInput(IPage page) =>
        page.Locator("#captcha, input[name='captcha']").First;

    private static async Task WaitForCaptchaImageReadyAsync(IPage page)
    {
        var captchaImage = FindCaptchaImage(page);
        await captchaImage.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Visible, Timeout = 15_000 });

        for (var i = 0; i < 25; i++)
        {
            var ready = await captchaImage.EvaluateAsync<bool>(
                "img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0");
            if (ready)
            {
                return;
            }

            await page.WaitForTimeoutAsync(200);
        }
    }

    private static async Task<byte[]?> ExtractRenderedCaptchaBytesAsync(IPage page)
    {
        var base64 = await page.EvaluateAsync<string?>(
            """
            () => {
              const img =
                document.querySelector('#captcha-image') ||
                document.querySelector('.captcha-box img');
              if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
                return null;
              }

              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              const ctx = canvas.getContext('2d');
              if (!ctx) return null;

              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0);

              const dataUrl = canvas.toDataURL('image/png');
              const comma = dataUrl.indexOf(',');
              return comma >= 0 ? dataUrl.slice(comma + 1) : null;
            }
            """);

        if (string.IsNullOrWhiteSpace(base64))
        {
            return null;
        }

        try
        {
            return Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static async Task WaitForCaptchaImageChangeAsync(IPage page, string previousSrc)
    {
        var captchaImage = FindCaptchaImage(page);
        for (var i = 0; i < 20; i++)
        {
            await page.WaitForTimeoutAsync(250);
            var currentSrc = await captchaImage.GetAttributeAsync("src") ?? string.Empty;
            if (!string.Equals(currentSrc, previousSrc, StringComparison.Ordinal))
            {
                await WaitForCaptchaImageReadyAsync(page);
                return;
            }
        }

        await WaitForCaptchaImageReadyAsync(page);
    }

    private static async Task ClearCaptchaInputAsync(IPage page)
    {
        await FindCaptchaInput(page).FillAsync(string.Empty);
    }
}
