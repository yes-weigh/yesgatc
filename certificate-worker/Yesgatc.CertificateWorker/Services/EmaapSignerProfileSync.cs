using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// After eMAAP login: if the portal profile is PDF signer, cache <c>users.certificationMethod</c>.
/// Promotes leftover manual upload. Does not overwrite Auto DSC.
/// </summary>
internal static class EmaapSignerProfileSync
{
    public static async Task TryRefreshAsync(
        IPage page,
        string rcUserId,
        string idToken,
        FirebaseSettings firebase,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(rcUserId) || string.IsNullOrWhiteSpace(idToken))
        {
            return;
        }

        try
        {
            var detected = await DetectAsync(page, cancellationToken).ConfigureAwait(false);
            if (!string.Equals(detected, RcCertificationMethods.PdfSigner, StringComparison.Ordinal))
            {
                return;
            }

            var documents = new FirestoreDocumentClient(firebase);
            var fields = await documents.GetFieldsAsync("users", rcUserId, idToken, cancellationToken)
                .ConfigureAwait(false);
            var current = FirestoreFieldReader.ReadString(fields, "certificationMethod");
            var cached = FirestoreFieldReader.ReadString(fields, "emaapSignerType");
            if (!RcCertificationMethods.ShouldPromoteToPdfSigner(current)
                || RcCertificationMethods.IsPdfSigner(cached))
            {
                return;
            }

            await documents.PatchStringFieldsAsync(
                "users",
                rcUserId,
                new Dictionary<string, string>
                {
                    ["emaapSignerType"] = RcCertificationMethods.PdfSigner,
                    ["emaapSignerTypeSyncedAt"] = DateTime.UtcNow.ToString("o"),
                },
                idToken,
                cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            // Best-effort. Super Admin switch still gates the queue.
        }
    }

    private static async Task<string?> DetectAsync(IPage page, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var fromHere = EmaapSignerTypeParser.TryParse(await SafeBodyTextAsync(page));
        if (fromHere is not null)
        {
            return fromHere;
        }

        var returnUrl = page.Url;
        var opened = await page.EvaluateAsync<bool>(
            """
            () => {
              const nodes = Array.from(document.querySelectorAll('a, button, span, li, div'));
              const hit = nodes.find(el => {
                const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return /^(my\s*)?profile$/i.test(t) || /^user\s*profile$/i.test(t) || /^account$/i.test(t);
              });
              if (!hit) return false;
              const target = hit.closest('a, button') || hit;
              target.click();
              return true;
            }
            """);
        if (!opened)
        {
            return null;
        }

        await page.WaitForTimeoutAsync(800);
        var fromProfile = EmaapSignerTypeParser.TryParse(await SafeBodyTextAsync(page));
        try
        {
            if (!string.IsNullOrWhiteSpace(returnUrl)
                && !string.Equals(page.Url, returnUrl, StringComparison.OrdinalIgnoreCase))
            {
                await page.GoBackAsync(new PageGoBackOptions { Timeout = 8_000 });
            }
        }
        catch (PlaywrightException)
        {
        }

        return fromProfile;
    }

    private static async Task<string> SafeBodyTextAsync(IPage page)
    {
        try
        {
            return await page.EvaluateAsync<string>("() => document.body?.innerText || ''") ?? string.Empty;
        }
        catch (PlaywrightException)
        {
            return string.Empty;
        }
    }
}
