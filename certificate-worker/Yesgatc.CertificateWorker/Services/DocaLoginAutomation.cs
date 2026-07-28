using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>eMAAP-only login dispatcher. The legacy doca.gov.in image-captcha login is retired.</summary>
public static class DocaLoginAutomation
{
    public static async Task<DocaSessionState> TryLoginAsync(
        IPage page,
        AutomationSettings settings,
        DocaCredentialSettings credentials,
        CancellationToken cancellationToken = default,
        Func<CaptchaAttemptReport, Task>? reportAttemptAsync = null,
        FirebaseSettings? firebase = null,
        Func<CancellationToken, Task<string>>? resolveFirebaseIdToken = null)
    {
        if (EmaapLoginAutomation.IsEmaapUrl(page.Url) || EmaapLoginAutomation.IsEmaapUrl(settings.DocaLoginUrl))
        {
            return await EmaapLoginAutomation.TryLoginThroughOtpGateAsync(
                page,
                settings,
                credentials,
                cancellationToken,
                reportAttemptAsync,
                firebase,
                resolveFirebaseIdToken);
        }

        throw new InvalidOperationException("DOCA website (doca.gov.in) login is no longer supported. Use eMAAP (emaap.gov.in).");
    }
}
