using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Progressive login for https://emaap.gov.in/gatc (replaces legacy doca.gov.in login).
/// Flow: email + password + canvas captcha → Send OTP → email OTP + captcha → Login.
/// </summary>
public static class EmaapLoginAutomation
{
    /// <summary>RC emaapengine: fill eMAAP user/pass, wait for manual captcha+OTP. No DeepSeek / Firebase OTP.</summary>
    public static bool PreferManualLoginUntilAuthenticated { get; set; }

    /// <summary>UTC time of last successful captcha → Send OTP click (for late Firebase poll).</summary>
    public static DateTimeOffset? LastOtpRequestedAtUtc { get; private set; }

    /// <summary>Captcha text that unlocked Send OTP — reuse on Login (no second DeepSeek).</summary>
    public static string? LastSendOtpCaptcha { get; private set; }

    private static DateTimeOffset? _lastResendOtpClickUtc;

    /// <summary>Fired on the Playwright thread when eMAAP session becomes logged-in.</summary>
    public static Action? OnLoggedIn { get; set; }

    public static bool IsEmaapUrl(string? url) =>
        !string.IsNullOrWhiteSpace(url)
        && url.Contains("emaap.gov.in", StringComparison.OrdinalIgnoreCase);

    public static async Task<bool> IsOtpStepAsync(IPage page)
    {
        var otp = page.Locator("input[name='otp'], input[placeholder*='OTP' i]");
        return await otp.CountAsync() > 0 && await otp.First.IsVisibleAsync();
    }

    /// <summary>
    /// After the ~5 min countdown, eMAAP shows "Resend OTP (n/3 attempts)".
    /// Click it once when enabled; updates <see cref="LastOtpRequestedAtUtc"/> for Firebase poll.
    /// </summary>
    public static async Task<bool> TryClickResendOtpIfEnabledAsync(IPage page)
    {
        if (!await IsOtpStepAsync(page))
        {
            return false;
        }

        // Avoid hammering — countdown is ~5 min; ignore re-clicks for 4 min.
        if (_lastResendOtpClickUtc is not null
            && DateTimeOffset.UtcNow - _lastResendOtpClickUtc.Value < TimeSpan.FromMinutes(4))
        {
            return false;
        }

        await page.BringToFrontAsync();
        await TryDismissLoginFailedDialogIfVisibleAsync(page);
        await TryDismissOtpSentDialogIfVisibleAsync(page);

        var clicked = await page.EvaluateAsync<bool>(
            """
            () => {
              const visible = (el) => {
                const style = getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              };
              const nodes = Array.from(document.querySelectorAll('a, button, span, div, p'));
              for (const el of nodes) {
                const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
                if (!t) continue;
                // Still counting down: "Resend in 3:12 (0/3 attempts)"
                if (/^Resend in\b/i.test(t)) return false;
                // Enabled: "Resend OTP (0/3 attempts)" or plain "Resend OTP"
                if (!/^Resend OTP\b/i.test(t)) continue;
                if (/3\/3/.test(t)) continue; // attempts exhausted
                if (!visible(el)) continue;
                const target = el.closest('a, button') || el;
                if (!visible(target)) continue;
                const pe = getComputedStyle(target).pointerEvents;
                if (pe === 'none') continue;
                target.scrollIntoView({ block: 'center' });
                target.click();
                return true;
              }
              return false;
            }
            """);

        if (!clicked)
        {
            return false;
        }

        _lastResendOtpClickUtc = DateTimeOffset.UtcNow;
        LastOtpRequestedAtUtc = DateTimeOffset.UtcNow;
        await WaitAndDismissOtpSentDialogAsync(page);
        await TryDismissOtpSentDialogIfVisibleAsync(page);
        return true;
    }

    public static async Task<bool> IsLoggedInAsync(IPage page)
    {
        var url = page.Url ?? "";
        if (!IsEmaapUrl(url))
        {
            return false;
        }

        if (await IsOtpStepAsync(page))
        {
            return false;
        }

        if (url.Contains("/login", StringComparison.OrdinalIgnoreCase))
        {
            var email = page.Locator("input[name='email'], input[type='email'], input[placeholder='Email']");
            return await email.CountAsync() == 0 || !await email.First.IsVisibleAsync();
        }

        return url.Contains("/gatc", StringComparison.OrdinalIgnoreCase);
    }

    private static void NotifyLoggedIn()
    {
        try
        {
            OnLoggedIn?.Invoke();
        }
        catch
        {
        }
    }

    /// <summary>
    /// After userid/password: wait for captcha canvas (and optional manual type).
    /// Returns LoggedIn / OtpRequired if that happens; otherwise null then DeepSeek OCR.
    /// </summary>
    private static async Task<DocaSessionState?> WaitAfterCredentialsForManualCaptchaOtpAsync(
        IPage page,
        int waitSeconds,
        CancellationToken cancellationToken)
    {
        if (waitSeconds <= 0)
        {
            return null;
        }

        var deadline = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(waitSeconds, 1, 300));
        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (await IsLoggedInAsync(page))
            {
                return DocaSessionState.LoggedIn;
            }

            if (await IsOtpStepAsync(page))
            {
                return DocaSessionState.OtpRequired;
            }

            await Task.Delay(1000, cancellationToken);
        }

        if (await IsLoggedInAsync(page))
        {
            return DocaSessionState.LoggedIn;
        }

        if (await IsOtpStepAsync(page))
        {
            return DocaSessionState.OtpRequired;
        }

        return null;
    }

    private static async Task<DocaSessionState> ContinueFromOtpStepAsync(
        IPage page,
        AutomationSettings settings,
        FirebaseSettings? firebase,
        Func<CancellationToken, Task<string>>? resolveFirebaseIdToken,
        CancellationToken cancellationToken,
        Func<CaptchaAttemptReport, Task>? reportAttemptAsync)
    {
        var masterHit = await TrySubmitMasterOtpAsync(
            page,
            settings,
            cancellationToken,
            reportAttemptAsync);
        if (masterHit == DocaSessionState.LoggedIn)
        {
            return DocaSessionState.LoggedIn;
        }

        var since = LastOtpRequestedAtUtc ?? DateTimeOffset.UtcNow.AddMinutes(-10);
        var emailOtp = await TryReadEmailOtpAsync(
            page,
            settings,
            firebase,
            resolveFirebaseIdToken,
            since,
            cancellationToken);
        if (!string.IsNullOrWhiteSpace(emailOtp))
        {
            return await SubmitOtpAsync(
                page,
                settings,
                emailOtp,
                cancellationToken,
                reportAttemptAsync);
        }

        return DocaSessionState.OtpRequired;
    }

    public static async Task<DocaSessionState> TryLoginThroughOtpGateAsync(
        IPage page,
        AutomationSettings settings,
        DocaCredentialSettings credentials,
        CancellationToken cancellationToken = default,
        Func<CaptchaAttemptReport, Task>? reportAttemptAsync = null,
        FirebaseSettings? firebase = null,
        Func<CancellationToken, Task<string>>? resolveFirebaseIdToken = null)
    {
        var email = credentials.Email.Trim();
        var password = credentials.Password;
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            return DocaSessionState.LoginRequired;
        }

        await WaitForLoginFormAsync(page, cancellationToken);

        if (await IsLoggedInAsync(page))
        {
            return DocaSessionState.LoggedIn;
        }

        if (PreferManualLoginUntilAuthenticated)
        {
            if (!await IsOtpStepAsync(page))
            {
                await FillCredentialsAsync(page, credentials);
            }

            await page.BringToFrontAsync();
            var waitSeconds = settings.EmaapEngineManualLoginWaitSeconds > 0
                ? settings.EmaapEngineManualLoginWaitSeconds
                : 900;
            var deadline = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(waitSeconds, 30, 1800));
            while (DateTimeOffset.UtcNow < deadline)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (await IsLoggedInAsync(page))
                {
                    NotifyLoggedIn();
                    return DocaSessionState.LoggedIn;
                }

                await Task.Delay(300, cancellationToken);
            }

            if (await IsLoggedInAsync(page))
            {
                NotifyLoggedIn();
                return DocaSessionState.LoggedIn;
            }

            return DocaSessionState.LoginRequired;
        }

        if (await IsOtpStepAsync(page))
        {
            return await ContinueFromOtpStepAsync(
                page,
                settings,
                firebase,
                resolveFirebaseIdToken,
                cancellationToken,
                reportAttemptAsync);
        }

        await FillCredentialsAsync(page, credentials);
        await page.BringToFrontAsync();

        if (!settings.AutoSolveCaptcha)
        {
            return DocaSessionState.LoginRequired;
        }

        var afterManualWait = await WaitAfterCredentialsForManualCaptchaOtpAsync(
            page,
            settings.EmaapManualCaptchaOtpWaitSeconds,
            cancellationToken);
        if (afterManualWait == DocaSessionState.LoggedIn)
        {
            return DocaSessionState.LoggedIn;
        }

        if (afterManualWait == DocaSessionState.OtpRequired
            || await IsOtpStepAsync(page))
        {
            return await ContinueFromOtpStepAsync(
                page,
                settings,
                firebase,
                resolveFirebaseIdToken,
                cancellationToken,
                reportAttemptAsync);
        }

        var typedCaptcha = await ReadCaptchaInputValueAsync(page);
        if (typedCaptcha.Length >= 4)
        {
            LastSendOtpCaptcha = typedCaptcha;
            LastOtpRequestedAtUtc = DateTimeOffset.UtcNow;
            await ClickSendOtpAsync(page);
            await WaitAndDismissOtpSentDialogAsync(page, maxSeconds: 15);
            if (await IsLoggedInAsync(page))
            {
                return DocaSessionState.LoggedIn;
            }

            if (await IsOtpStepAsync(page))
            {
                return await ContinueFromOtpStepAsync(
                    page,
                    settings,
                    firebase,
                    resolveFirebaseIdToken,
                    cancellationToken,
                    reportAttemptAsync);
            }
        }

        var maxAttempts = Math.Max(1, settings.CaptchaMaxAttempts);
        var ocrProvider = ResolveOcrProviderLabel(settings.CaptchaOcr);
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var imageBytes = await ReadCaptchaCanvasBytesAsync(page, cancellationToken);
            var captchaText = await DocaCaptchaReader.ReadCaptchaFromImageAsync(
                imageBytes,
                settings.CaptchaOcr,
                cancellationToken,
                page.Context,
                page);
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

            await page.BringToFrontAsync();
            await FillCaptchaAsync(page, captchaText);
            LastSendOtpCaptcha = captchaText;
            var otpRequestedAt = DateTimeOffset.UtcNow;
            LastOtpRequestedAtUtc = otpRequestedAt;
            await ClickSendOtpAsync(page);

            var hasMasterOtp = IsConfiguredMasterOtp(settings);
            SendOtpOutcome sendOutcome;
            var otpVisible = false;
            var incorrectCaptcha = false;

            if (hasMasterOtp)
            {
                var afterMaster = await TrySubmitMasterOtpImmediateAsync(
                    page,
                    settings,
                    cancellationToken,
                    reportAttemptAsync);
                if (afterMaster == DocaSessionState.LoggedIn)
                {
                    if (reportAttemptAsync is not null)
                    {
                        await reportAttemptAsync(new CaptchaAttemptReport(
                            imageBytes,
                            captchaText,
                            ocrProvider,
                            attempt,
                            true,
                            "otp_sent"));
                    }

                    return DocaSessionState.LoggedIn;
                }

                incorrectCaptcha = await IsIncorrectCaptchaErrorAsync(page);
                otpVisible = await IsOtpStepAsync(page);
                sendOutcome = incorrectCaptcha
                    ? SendOtpOutcome.IncorrectCaptcha
                    : otpVisible
                        ? SendOtpOutcome.OtpStep
                        : SendOtpOutcome.Timeout;
            }
            else
            {
                await WaitAndDismissOtpSentDialogAsync(page, maxSeconds: 15);
                sendOutcome = await WaitForSendOtpOutcomeAsync(
                    page,
                    cancellationToken,
                    maxSeconds: 20);
                otpVisible = sendOutcome == SendOtpOutcome.OtpStep;
                incorrectCaptcha = sendOutcome == SendOtpOutcome.IncorrectCaptcha;
            }

            if (sendOutcome == SendOtpOutcome.LoggedIn)
            {
                if (reportAttemptAsync is not null)
                {
                    await reportAttemptAsync(new CaptchaAttemptReport(
                        imageBytes,
                        captchaText,
                        ocrProvider,
                        attempt,
                        true,
                        "otp_sent"));
                }

                return DocaSessionState.LoggedIn;
            }

            if (!hasMasterOtp && otpVisible)
            {
                // Email OTP path — captcha accepted; dismiss OK then wait for inbox code.
                await page.BringToFrontAsync();
                await TryDismissOtpSentDialogIfVisibleAsync(page);
            }

            if (reportAttemptAsync is not null)
            {
                await reportAttemptAsync(new CaptchaAttemptReport(
                    imageBytes,
                    captchaText,
                    ocrProvider,
                    attempt,
                    otpVisible,
                    otpVisible
                        ? "otp_sent"
                        : incorrectCaptcha
                            ? "incorrect_captcha"
                            : "send_otp_failed"));
            }

            if (!otpVisible)
            {
                if (attempt < maxAttempts)
                {
                    await ClickCaptchaRefreshAsync(page, cancellationToken);
                }

                continue;
            }

            // Master already tried above — only poll inbox when master is not configured.
            if (hasMasterOtp)
            {
                return DocaSessionState.OtpRequired;
            }

            string? emailOtp = null;
            emailOtp = await TryReadEmailOtpAsync(
                page,
                settings,
                firebase,
                resolveFirebaseIdToken,
                otpRequestedAt,
                cancellationToken);

            await page.BringToFrontAsync();
            await TryDismissOtpSentDialogIfVisibleAsync(page);
            await TryDismissLoginFailedDialogIfVisibleAsync(page);

            if (!string.IsNullOrWhiteSpace(emailOtp))
            {
                return await SubmitOtpAsync(
                    page,
                    settings,
                    emailOtp,
                    cancellationToken,
                    reportAttemptAsync);
            }

            return DocaSessionState.OtpRequired;
        }

        return DocaSessionState.LoginRequired;
    }

    private static async Task<string?> TryReadEmailOtpAsync(
        IPage page,
        AutomationSettings settings,
        FirebaseSettings? firebase,
        Func<CancellationToken, Task<string>>? resolveFirebaseIdToken,
        DateTimeOffset otpRequestedAt,
        CancellationToken cancellationToken)
    {
        string? emailOtp = null;
        if (settings.EmaapOtpUseFirestore
            && firebase is not null
            && resolveFirebaseIdToken is not null)
        {
            try
            {
                emailOtp = await FirestoreEmaapOtpReader.WaitForOtpAsync(
                    firebase,
                    resolveFirebaseIdToken,
                    otpRequestedAt,
                    cancellationToken,
                    timeoutSeconds: settings.EmaapOtpPollSeconds);
            }
            catch when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                FirestoreEmaapOtpReader.LastFailureReason ??= ex.Message;
                emailOtp = null;
            }
        }
        else if (settings.EmaapOtpUseFirestore)
        {
            FirestoreEmaapOtpReader.LastFailureReason =
                "Firebase OTP enabled but worker has no id token resolver — Sign in to YESGATC first.";
        }

        if (string.IsNullOrWhiteSpace(emailOtp) && settings.EmaapOtpUseGmailFallback)
        {
            try
            {
                emailOtp = await GmailOtpReader.TryReadRecentOtpAsync(
                    page.Context,
                    otpRequestedAt,
                    cancellationToken,
                    report: null);
            }
            catch when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                GmailOtpReader.LastFailureReason ??= ex.Message;
                emailOtp = null;
            }
        }

        return emailOtp;
    }

    /// <summary>
    /// After Send OTP: dismiss OK and fill master OTP the instant the OTP field appears.
    /// </summary>
    private static async Task<DocaSessionState> TrySubmitMasterOtpImmediateAsync(
        IPage page,
        AutomationSettings settings,
        CancellationToken cancellationToken,
        Func<CaptchaAttemptReport, Task>? reportAttemptAsync,
        int maxSeconds = 8)
    {
        if (!IsConfiguredMasterOtp(settings))
        {
            return DocaSessionState.OtpRequired;
        }

        var deadline = DateTime.UtcNow.AddSeconds(Math.Max(1, maxSeconds));
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await IsIncorrectCaptchaErrorAsync(page))
            {
                return DocaSessionState.OtpRequired;
            }

            if (await IsLoggedInAsync(page))
            {
                return DocaSessionState.LoggedIn;
            }

            await TryDismissOtpSentDialogIfVisibleAsync(page);
            await TryDismissLoginFailedDialogIfVisibleAsync(page);

            if (await IsOtpStepAsync(page))
            {
                return await TrySubmitMasterOtpAsync(
                    page,
                    settings,
                    cancellationToken,
                    reportAttemptAsync);
            }

            await page.WaitForTimeoutAsync(40);
        }

        await TryDismissOtpSentDialogIfVisibleAsync(page);
        return await TrySubmitMasterOtpAsync(
            page,
            settings,
            cancellationToken,
            reportAttemptAsync);
    }

    private static bool IsConfiguredMasterOtp(AutomationSettings settings)
    {
        var master = settings.EmaapMasterOtp?.Trim() ?? string.Empty;
        return !string.IsNullOrWhiteSpace(master) && Regex.IsMatch(master, @"^\d{6}$");
    }

    /// <summary>Try configured master OTP; returns LoggedIn or OtpRequired (failed / skipped).</summary>
    public static async Task<DocaSessionState> TrySubmitMasterOtpAsync(
        IPage page,
        AutomationSettings settings,
        CancellationToken cancellationToken = default,
        Func<CaptchaAttemptReport, Task>? reportAttemptAsync = null)
    {
        if (!IsConfiguredMasterOtp(settings))
        {
            return DocaSessionState.OtpRequired;
        }

        var master = settings.EmaapMasterOtp!.Trim();

        if (!await IsOtpStepAsync(page))
        {
            return await IsLoggedInAsync(page)
                ? DocaSessionState.LoggedIn
                : DocaSessionState.OtpRequired;
        }

        // Master OTP: fill + login only — no captcha canvas re-wait, no DeepSeek retry loop.
        var state = await SubmitOtpAsync(
            page,
            settings,
            master,
            cancellationToken,
            reportAttemptAsync,
            skipCaptchaRetry: true,
            fastOutcome: true);
        if (state == DocaSessionState.LoggedIn)
        {
            return DocaSessionState.LoggedIn;
        }

        await TryDismissLoginFailedDialogIfVisibleAsync(page);
        return DocaSessionState.OtpRequired;
    }

    public static async Task<DocaSessionState> SubmitOtpAsync(
        IPage page,
        AutomationSettings settings,
        string otp,
        CancellationToken cancellationToken = default,
        Func<CaptchaAttemptReport, Task>? reportAttemptAsync = null,
        bool skipCaptchaRetry = false,
        bool fastOutcome = false)
    {
        var code = otp.Trim();
        if (string.IsNullOrWhiteSpace(code))
        {
            return DocaSessionState.OtpRequired;
        }

        // Already on OTP step — skip WaitForLoginForm (captcha canvas ready loop wastes seconds).
        if (!await IsOtpStepAsync(page))
        {
            await WaitForLoginFormAsync(page, cancellationToken);
            if (!await IsOtpStepAsync(page))
            {
                if (await IsLoggedInAsync(page))
                {
                    return DocaSessionState.LoggedIn;
                }

                return DocaSessionState.LoginRequired;
            }
        }

        await page.BringToFrontAsync();
        await TryDismissOtpSentDialogIfVisibleAsync(page);

        var otpField = page.Locator("input[name='otp'], input[placeholder*='OTP' i]").First;
        await otpField.FillAsync(code);

        // eMAAP keeps the same captcha after Send OTP — do NOT open DeepSeek again.
        // Reuse field value or the captcha that unlocked Send OTP, then click Login.
        var captchaInField = await ReadCaptchaInputValueAsync(page);
        if (string.IsNullOrWhiteSpace(captchaInField) || captchaInField.Length < 4)
        {
            if (!string.IsNullOrWhiteSpace(LastSendOtpCaptcha))
            {
                await FillCaptchaAsync(page, LastSendOtpCaptcha);
            }
        }

        await otpField.FillAsync(code);
        await ClickLoginAsync(page);

        var firstOutcome = await WaitForLoginOutcomeAsync(
            page,
            cancellationToken,
            maxSeconds: fastOutcome ? 6 : 20,
            pollMs: fastOutcome ? 80 : 300);
        if (firstOutcome == LoginOutcome.LoggedIn)
        {
            return DocaSessionState.LoggedIn;
        }

        // Wrong/expired OTP — OK already clicked; stay on form so idle poller can submit newest.
        if (firstOutcome == LoginOutcome.InvalidOtp)
        {
            await TryDismissLoginFailedDialogIfVisibleAsync(page);
            return DocaSessionState.OtpRequired;
        }

        if (!settings.AutoSolveCaptcha || skipCaptchaRetry)
        {
            return DocaSessionState.OtpRequired;
        }

        // Only re-OCR if Login rejected captcha.
        if (firstOutcome != LoginOutcome.IncorrectCaptcha && await IsOtpStepAsync(page))
        {
            // Still on OTP step for other reasons (wrong OTP etc.) — no DeepSeek spam.
            return DocaSessionState.OtpRequired;
        }

        var maxAttempts = Math.Max(1, settings.CaptchaMaxAttempts);
        var ocrProvider = ResolveOcrProviderLabel(settings.CaptchaOcr);
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();

            await ClickCaptchaRefreshAsync(page, cancellationToken);
            var imageBytes = await ReadCaptchaCanvasBytesAsync(page, cancellationToken);
            var captchaText = await DocaCaptchaReader.ReadCaptchaFromImageAsync(
                imageBytes,
                settings.CaptchaOcr,
                cancellationToken,
                page.Context,
                page);
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
                        "otp_ocr_failed"));
                }

                continue;
            }

            await page.BringToFrontAsync();
            await FillCaptchaAsync(page, captchaText);
            LastSendOtpCaptcha = captchaText;
            await otpField.FillAsync(code);
            await ClickLoginAsync(page);

            var loginOutcome = await WaitForLoginOutcomeAsync(page, cancellationToken);
            var loggedIn = loginOutcome == LoginOutcome.LoggedIn;
            if (reportAttemptAsync is not null)
            {
                await reportAttemptAsync(new CaptchaAttemptReport(
                    imageBytes,
                    captchaText,
                    ocrProvider,
                    attempt,
                    loggedIn,
                    loggedIn
                        ? "otp_login_success"
                        : loginOutcome == LoginOutcome.IncorrectCaptcha
                            ? "incorrect_captcha"
                            : "otp_login_failed"));
            }

            if (loggedIn)
            {
                return DocaSessionState.LoggedIn;
            }

            if (loginOutcome == LoginOutcome.InvalidOtp)
            {
                await TryDismissLoginFailedDialogIfVisibleAsync(page);
                return DocaSessionState.OtpRequired;
            }

            if (loginOutcome != LoginOutcome.IncorrectCaptcha)
            {
                return DocaSessionState.OtpRequired;
            }
        }

        return DocaSessionState.OtpRequired;
    }

    private static async Task<string> ReadCaptchaInputValueAsync(IPage page)
    {
        try
        {
            var captchaInput = page.Locator("input.captcha-input, input[placeholder*='captcha' i]").First;
            if (await captchaInput.CountAsync() == 0)
            {
                return string.Empty;
            }

            return (await captchaInput.InputValueAsync())?.Trim() ?? string.Empty;
        }
        catch (PlaywrightException)
        {
            return string.Empty;
        }
    }

    private static string ResolveOcrProviderLabel(CaptchaOcrSettings settings) =>
        CaptchaOcrKeys.DescribeProvider(settings);

    private static async Task WaitForLoginFormAsync(IPage page, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await page.WaitForSelectorAsync(
            "input[name='email'], input[type='email'], input[placeholder='Email']",
            new PageWaitForSelectorOptions { State = WaitForSelectorState.Visible, Timeout = 30_000 });
        await page.WaitForSelectorAsync(
            ".captcha-canvas, canvas.captcha-canvas",
            new PageWaitForSelectorOptions { State = WaitForSelectorState.Visible, Timeout = 30_000 });
        await WaitForCaptchaCanvasReadyAsync(page);
    }

    private static async Task FillCredentialsAsync(IPage page, DocaCredentialSettings credentials)
    {
        var email = credentials.Email.Trim();
        var password = credentials.Password;
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            throw new InvalidOperationException(
                "eMAAP email/password empty — cannot fill login form.");
        }

        await page.BringToFrontAsync();

        var emailField = page.Locator(
            "input[name='email'], input[type='email'], input[placeholder='Email'], input[placeholder*='email' i]").First;
        await emailField.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 20_000,
        });
        await emailField.ClickAsync();
        await emailField.FillAsync(string.Empty);
        await emailField.FillAsync(email);

        var passwordField = page.Locator(
            "input[name='password'], input[type='password'], input[placeholder='Password'], input[placeholder*='password' i]").First;
        await passwordField.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 10_000,
        });
        await passwordField.ClickAsync();
        await passwordField.FillAsync(string.Empty);
        await passwordField.FillAsync(password);

        // Confirm React controlled inputs kept the values.
        var emailNow = await emailField.InputValueAsync();
        var passwordNow = await passwordField.InputValueAsync();
        if (!string.Equals(emailNow.Trim(), email, StringComparison.Ordinal)
            || string.IsNullOrEmpty(passwordNow))
        {
            await emailField.PressSequentiallyAsync(email, new LocatorPressSequentiallyOptions { Delay = 15 });
            await passwordField.FillAsync(string.Empty);
            await passwordField.PressSequentiallyAsync(password, new LocatorPressSequentiallyOptions { Delay = 15 });
        }
    }

    private static async Task FillCaptchaAsync(IPage page, string captchaText)
    {
        var captchaInput = page.Locator("input.captcha-input, input[placeholder*='captcha' i]").First;
        await captchaInput.ClickAsync();
        await captchaInput.FillAsync(captchaText);
    }

    private static async Task ClickSendOtpAsync(IPage page)
    {
        var sendOtp = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Send OTP" });
        if (await sendOtp.CountAsync() == 0)
        {
            sendOtp = page.Locator("button[type='submit']")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("Send OTP|Sending OTP", RegexOptions.IgnoreCase),
                });
        }

        if (await sendOtp.CountAsync() == 0)
        {
            throw new InvalidOperationException("Could not find eMAAP Send OTP button.");
        }

        await sendOtp.First.ClickAsync(new LocatorClickOptions { Timeout = 15_000 });
    }

    /// <summary>After Send OTP: wait for SweetAlert, dismiss OK (DOM click — overlay blocks Playwright).</summary>
    private static async Task WaitAndDismissOtpSentDialogAsync(IPage page, int maxSeconds = 15)
    {
        var deadline = DateTime.UtcNow.AddSeconds(Math.Max(1, maxSeconds));
        while (DateTime.UtcNow < deadline)
        {
            if (await IsOtpSentDialogVisibleAsync(page))
            {
                await TryDismissOtpSentDialogIfVisibleAsync(page);
                return;
            }

            if (await IsOtpStepAsync(page))
            {
                return;
            }

            if (await IsIncorrectCaptchaErrorAsync(page))
            {
                return;
            }

            await page.WaitForTimeoutAsync(120);
        }

        await TryDismissOtpSentDialogIfVisibleAsync(page);
    }

    /// <summary>Click OK only if OTP-sent dialog already showing. Never throws.</summary>
    private static async Task TryDismissOtpSentDialogIfVisibleAsync(IPage page)
    {
        try
        {
            if (!await IsOtpSentDialogVisibleAsync(page))
            {
                return;
            }

            await TryClickSweetAlertOkAsync(page);
        }
        catch (PlaywrightException)
        {
            // ignore
        }
    }

    private static async Task<bool> IsOtpSentDialogVisibleAsync(IPage page)
    {
        var markers = page.Locator("text=/OTP Sent/i")
            .Or(page.Locator("text=/Please check your email/i"));
        if (await markers.CountAsync() == 0)
        {
            return false;
        }

        for (var i = 0; i < Math.Min(await markers.CountAsync(), 4); i++)
        {
            if (await markers.Nth(i).IsVisibleAsync())
            {
                return true;
            }
        }

        return false;
    }

    private static async Task ClickLoginAsync(IPage page)
    {
        await page.BringToFrontAsync();
        await TryDismissOtpSentDialogIfVisibleAsync(page);

        // MUST be the orange form Login — NOT header "Login" dropdown (Business/Department).
        var clicked = await page.EvaluateAsync<bool>(
            """
            () => {
              const visible = (el) => {
                const style = getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              };
              const inHeaderNav = (el) => !!(
                el.closest('header, nav, .navbar, .nav, .dropdown, [class*="dropdown"], [class*="Navbar"], [class*="Header"]')
              );
              const isFormLogin = (el) => {
                const t = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
                if (!/^login$/i.test(t)) return false;
                if (inHeaderNav(el)) return false;
                // Prefer button inside SIGN IN / login form near OTP.
                if (el.closest('form, .login, .signin, [class*="login"], [class*="sign"]')) return true;
                // Wide orange primary button in page center (not tiny nav control).
                const r = el.getBoundingClientRect();
                if (r.width >= 120 && r.height >= 36 && r.top > 120) return true;
                return false;
              };

              const candidates = Array.from(
                document.querySelectorAll('button, input[type="submit"]')
              ).filter(isFormLogin);

              // Prefer the lowest / largest (form footer Login).
              candidates.sort((a, b) => {
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                return (rb.top + rb.width) - (ra.top + ra.width);
              });

              const btn = candidates[0];
              if (!btn || !visible(btn)) return false;
              btn.scrollIntoView({ block: 'center', inline: 'center' });
              btn.focus();
              btn.click();
              return true;
            }
            """);

        if (clicked)
        {
            return;
        }

        var formLogin = page.Locator("form button, form input[type='submit'], .swal-overlay ~ * button")
            .Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex("^\\s*Login\\s*$", RegexOptions.IgnoreCase),
            });
        if (await formLogin.CountAsync() == 0)
        {
            formLogin = page.Locator("button")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("^\\s*Login\\s*$", RegexOptions.IgnoreCase),
                });
        }

        var count = await formLogin.CountAsync();
        for (var i = count - 1; i >= 0; i--)
        {
            var btn = formLogin.Nth(i);
            try
            {
                var box = await btn.BoundingBoxAsync();
                if (box is null || box.Y < 100 || box.Width < 100)
                {
                    continue; // skip header dropdown
                }

                await btn.ScrollIntoViewIfNeededAsync();
                await btn.ClickAsync(new LocatorClickOptions { Force = true, Timeout = 5_000 });
                return;
            }
            catch (PlaywrightException)
            {
                // try next
            }
        }

        throw new InvalidOperationException("Could not find eMAAP form Login button (avoided header dropdown).");
    }

    private enum SendOtpOutcome
    {
        OtpStep,
        IncorrectCaptcha,
        LoggedIn,
        Timeout,
    }

    private enum LoginOutcome
    {
        LoggedIn,
        IncorrectCaptcha,
        InvalidOtp,
        Timeout,
    }

    private static async Task<bool> IsIncorrectCaptchaErrorAsync(IPage page)
    {
        var err = page.Locator("text=/Incorrect captcha/i")
            .Or(page.Locator("text=/invalid captcha/i"))
            .Or(page.Locator("text=/wrong captcha/i"));

        var count = await err.CountAsync();
        for (var i = 0; i < Math.Min(count, 5); i++)
        {
            if (await err.Nth(i).IsVisibleAsync())
            {
                return true;
            }
        }

        return false;
    }

    private static async Task<bool> IsInvalidOrExpiredOtpDialogAsync(IPage page)
    {
        try
        {
            var markers = page.Locator("text=/Invalid or expired OTP/i")
                .Or(page.Locator("text=/Login Failed/i"));
            var count = await markers.CountAsync();
            for (var i = 0; i < Math.Min(count, 6); i++)
            {
                if (await markers.Nth(i).IsVisibleAsync())
                {
                    return true;
                }
            }
        }
        catch (PlaywrightException)
        {
        }

        return false;
    }

    /// <summary>Dismiss SweetAlert v1 OK (OTP sent, Login Failed, etc.).</summary>
    private static async Task TryClickSweetAlertOkAsync(IPage page)
    {
        for (var attempt = 0; attempt < 6; attempt++)
        {
            var clicked = await page.EvaluateAsync<bool>(
                """
                () => {
                  const selectors = [
                    'button.swal-button--confirm',
                    'button.swal-button.swal-button--confirm',
                    '.swal-overlay button.swal-button--confirm',
                    '.swal-modal button.swal-button--confirm',
                    'button.swal2-confirm',
                  ];
                  for (const sel of selectors) {
                    const b = document.querySelector(sel);
                    if (b) { b.click(); return true; }
                  }
                  for (const b of document.querySelectorAll('button')) {
                    const t = (b.innerText || '').trim();
                    if (t !== 'OK' && t !== 'Ok') continue;
                    const style = getComputedStyle(b);
                    if (style.display === 'none' || style.visibility === 'hidden') continue;
                    b.click();
                    return true;
                  }
                  return false;
                }
                """);

            if (!clicked)
            {
                var ok = page.Locator("button.swal-button--confirm, button.swal-button").First;
                if (await ok.CountAsync() > 0)
                {
                    try
                    {
                        await ok.ClickAsync(new LocatorClickOptions { Force = true, Timeout = 2_000 });
                    }
                    catch (PlaywrightException)
                    {
                        await page.Keyboard.PressAsync("Enter");
                    }
                }
                else
                {
                    await page.Keyboard.PressAsync("Enter");
                }
            }

            await page.WaitForTimeoutAsync(300);
            if (!await IsInvalidOrExpiredOtpDialogAsync(page)
                && !await IsOtpSentDialogVisibleAsync(page))
            {
                return;
            }
        }
    }

    private static async Task TryDismissLoginFailedDialogIfVisibleAsync(IPage page)
    {
        try
        {
            if (!await IsInvalidOrExpiredOtpDialogAsync(page))
            {
                return;
            }

            await TryClickSweetAlertOkAsync(page);
        }
        catch (PlaywrightException)
        {
            // ignore
        }
    }

    private static async Task<SendOtpOutcome> WaitForSendOtpOutcomeAsync(
        IPage page,
        CancellationToken cancellationToken,
        int maxSeconds = 20)
    {
        var deadline = DateTime.UtcNow.AddSeconds(Math.Max(1, maxSeconds));
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await IsIncorrectCaptchaErrorAsync(page))
            {
                return SendOtpOutcome.IncorrectCaptcha;
            }

            await TryDismissOtpSentDialogIfVisibleAsync(page);

            if (await IsOtpStepAsync(page))
            {
                return SendOtpOutcome.OtpStep;
            }

            if (await IsLoggedInAsync(page))
            {
                return SendOtpOutcome.LoggedIn;
            }

            await page.WaitForTimeoutAsync(120);
        }

        if (await IsIncorrectCaptchaErrorAsync(page))
        {
            return SendOtpOutcome.IncorrectCaptcha;
        }

        await TryDismissOtpSentDialogIfVisibleAsync(page);
        if (await IsOtpStepAsync(page))
        {
            return SendOtpOutcome.OtpStep;
        }

        if (await IsLoggedInAsync(page))
        {
            return SendOtpOutcome.LoggedIn;
        }

        return SendOtpOutcome.Timeout;
    }

    private static async Task<LoginOutcome> WaitForLoginOutcomeAsync(
        IPage page,
        CancellationToken cancellationToken,
        int maxSeconds = 20,
        int pollMs = 300)
    {
        var deadline = DateTime.UtcNow.AddSeconds(Math.Max(1, maxSeconds));
        var delay = Math.Clamp(pollMs, 50, 1_000);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (await IsIncorrectCaptchaErrorAsync(page))
            {
                return LoginOutcome.IncorrectCaptcha;
            }

            if (await IsInvalidOrExpiredOtpDialogAsync(page))
            {
                await TryDismissLoginFailedDialogIfVisibleAsync(page);
                return LoginOutcome.InvalidOtp;
            }

            if (await IsLoggedInAsync(page))
            {
                return LoginOutcome.LoggedIn;
            }

            await page.WaitForTimeoutAsync(delay);
        }

        if (await IsIncorrectCaptchaErrorAsync(page))
        {
            return LoginOutcome.IncorrectCaptcha;
        }

        if (await IsInvalidOrExpiredOtpDialogAsync(page))
        {
            await TryDismissLoginFailedDialogIfVisibleAsync(page);
            return LoginOutcome.InvalidOtp;
        }

        return await IsLoggedInAsync(page) ? LoginOutcome.LoggedIn : LoginOutcome.Timeout;
    }

    private static async Task<bool> WaitForOtpStepAsync(IPage page, CancellationToken cancellationToken)
    {
        var outcome = await WaitForSendOtpOutcomeAsync(page, cancellationToken);
        return outcome == SendOtpOutcome.OtpStep;
    }

    private static async Task<bool> WaitForLoggedInAsync(IPage page, CancellationToken cancellationToken)
    {
        var outcome = await WaitForLoginOutcomeAsync(page, cancellationToken);
        return outcome == LoginOutcome.LoggedIn;
    }

    private static async Task<byte[]> ReadCaptchaCanvasBytesAsync(IPage page, CancellationToken cancellationToken)
    {
        await WaitForCaptchaCanvasReadyAsync(page);
        cancellationToken.ThrowIfCancellationRequested();

        var fromCanvas = await page.EvaluateAsync<string?>(
            """
            () => {
              const canvas = document.querySelector('.captcha-canvas') || document.querySelector('canvas');
              if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;
              try {
                const dataUrl = canvas.toDataURL('image/png');
                const comma = dataUrl.indexOf(',');
                return comma >= 0 ? dataUrl.slice(comma + 1) : null;
              } catch {
                return null;
              }
            }
            """);

        if (!string.IsNullOrWhiteSpace(fromCanvas))
        {
            try
            {
                return Convert.FromBase64String(fromCanvas);
            }
            catch (FormatException)
            {
                // fall through to screenshot
            }
        }

        var canvas = page.Locator(".captcha-canvas, canvas").First;
        return await canvas.ScreenshotAsync(new LocatorScreenshotOptions { Type = ScreenshotType.Png });
    }

    private static async Task WaitForCaptchaCanvasReadyAsync(IPage page)
    {
        var canvas = page.Locator(".captcha-canvas, canvas").First;
        await canvas.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Visible, Timeout = 20_000 });
        for (var i = 0; i < 25; i++)
        {
            var ready = await canvas.EvaluateAsync<bool>(
                "c => c && c.width > 0 && c.height > 0");
            if (ready)
            {
                return;
            }

            await page.WaitForTimeoutAsync(200);
        }
    }

    private static async Task ClickCaptchaRefreshAsync(IPage page, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // Snapshot canvas so we know when refresh painted a new captcha.
        var before = await page.EvaluateAsync<string?>(
            """
            () => {
              const canvas = document.querySelector('.captcha-canvas') || document.querySelector('canvas');
              if (!canvas) return null;
              try { return canvas.toDataURL('image/png').slice(-80); } catch { return null; }
            }
            """);

        var refresh = page.Locator(
            ".captcha-refresh-btn, button.captcha-refresh-btn, button[aria-label*='refresh' i], button[title*='refresh' i]").First;
        if (await refresh.CountAsync() == 0 || !await refresh.IsVisibleAsync())
        {
            // Icon button beside captcha input (circular arrow).
            refresh = page.Locator("input.captcha-input, input[placeholder*='captcha' i]")
                .Locator("xpath=ancestor::*[1]/following-sibling::button[1]")
                .Or(page.Locator("input.captcha-input + button, .captcha-box button, .captcha-input-wrap button"))
                .First;
        }

        if (await refresh.CountAsync() == 0 || !await refresh.IsVisibleAsync())
        {
            refresh = page.Locator("button:near(input.captcha-input)").Last;
        }

        if (await refresh.CountAsync() > 0 && await refresh.IsVisibleAsync())
        {
            await refresh.ClickAsync(new LocatorClickOptions { Timeout = 5_000 });
        }

        var captchaInput = page.Locator("input.captcha-input, input[placeholder*='captcha' i]").First;
        if (await captchaInput.CountAsync() > 0)
        {
            await captchaInput.FillAsync(string.Empty);
        }

        await WaitForCaptchaCanvasReadyAsync(page);

        // Wait until canvas pixels change (new captcha).
        for (var i = 0; i < 20; i++)
        {
            var after = await page.EvaluateAsync<string?>(
                """
                () => {
                  const canvas = document.querySelector('.captcha-canvas') || document.querySelector('canvas');
                  if (!canvas) return null;
                  try { return canvas.toDataURL('image/png').slice(-80); } catch { return null; }
                }
                """);
            if (!string.IsNullOrEmpty(after) && after != before)
            {
                break;
            }

            await page.WaitForTimeoutAsync(200);
        }

        await page.WaitForTimeoutAsync(300);
    }
}
