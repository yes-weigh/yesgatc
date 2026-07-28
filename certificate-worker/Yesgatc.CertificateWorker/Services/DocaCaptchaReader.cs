using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public static class DocaCaptchaReader
{
    public static async Task<string> ReadCaptchaFromImageAsync(
        byte[] imageBytes,
        CaptchaOcrSettings settings,
        CancellationToken cancellationToken = default,
        IBrowserContext? browserContext = null,
        IPage? returnToPage = null)
    {
        if (CaptchaOcrKeys.IsDeepSeek(settings))
        {
            if (browserContext is null)
            {
                throw new InvalidOperationException(
                    "DeepSeek captcha OCR needs the worker browser context (open eMAAP first).");
            }

            return await DeepSeekChatCaptchaOcr.ReadCaptchaFromImageAsync(
                imageBytes,
                browserContext,
                settings,
                cancellationToken,
                returnToPage);
        }

        if (!UseAiProvider(settings))
        {
            return DocaCaptchaOcr.ReadCaptchaFromImage(imageBytes);
        }

        string tesseractText = string.Empty;
        if (settings.CombineWithTesseract || settings.FallbackToTesseract)
        {
            tesseractText = DocaCaptchaOcr.ReadCaptchaFromImage(imageBytes);
        }

        string? aiText = null;
        try
        {
            aiText = CaptchaOcrKeys.IsGemini(settings)
                ? await GeminiCaptchaOcr.ReadCaptchaFromImageAsync(imageBytes, settings, cancellationToken)
                : await OpenAiCaptchaOcr.ReadCaptchaFromImageAsync(imageBytes, settings, cancellationToken);
        }
        catch when (settings.FallbackToTesseract)
        {
            return tesseractText;
        }

        // Gemini/DeepSeek/eMAAP: prefer AI answer as-is (case-sensitive). Skip Tesseract merge that uppercases.
        if (CaptchaOcrKeys.IsGemini(settings))
        {
            if (!string.IsNullOrWhiteSpace(aiText) && DocaCaptchaOcr.IsValidCaptchaLength(aiText))
            {
                return aiText;
            }

            return tesseractText;
        }

        if (settings.CombineWithTesseract
            && DocaCaptchaOcr.IsValidCaptchaLength(tesseractText)
            && !string.IsNullOrWhiteSpace(aiText)
            && DocaCaptchaOcr.IsValidCaptchaLength(aiText))
        {
            return DocaCaptchaOcr.MergePreferringTesseract(aiText, tesseractText);
        }

        if (!string.IsNullOrWhiteSpace(aiText) && DocaCaptchaOcr.IsValidCaptchaLength(aiText))
        {
            return aiText;
        }

        return tesseractText;
    }

    private static bool UseAiProvider(CaptchaOcrSettings settings)
    {
        if (CaptchaOcrKeys.IsDeepSeek(settings))
        {
            return true;
        }

        if (CaptchaOcrKeys.IsGemini(settings) || CaptchaOcrKeys.IsOpenAi(settings))
        {
            return !string.IsNullOrWhiteSpace(CaptchaOcrKeys.ResolveApiKey(settings));
        }

        return false;
    }
}
