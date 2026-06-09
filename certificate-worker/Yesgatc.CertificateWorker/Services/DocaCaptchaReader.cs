using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public static class DocaCaptchaReader
{
    public static async Task<string> ReadCaptchaFromImageAsync(
        byte[] imageBytes,
        CaptchaOcrSettings settings,
        CancellationToken cancellationToken = default)
    {
        if (!UseOpenAi(settings))
        {
            return DocaCaptchaOcr.ReadCaptchaFromImage(imageBytes);
        }

        string tesseractText = string.Empty;
        if (settings.CombineWithTesseract || settings.FallbackToTesseract)
        {
            tesseractText = DocaCaptchaOcr.ReadCaptchaFromImage(imageBytes);
        }

        string? openAiText = null;
        try
        {
            openAiText = await OpenAiCaptchaOcr.ReadCaptchaFromImageAsync(imageBytes, settings, cancellationToken);
        }
        catch when (settings.FallbackToTesseract)
        {
            return tesseractText;
        }

        if (settings.CombineWithTesseract
            && DocaCaptchaOcr.IsValidCaptchaLength(tesseractText)
            && !string.IsNullOrWhiteSpace(openAiText)
            && DocaCaptchaOcr.IsValidCaptchaLength(openAiText))
        {
            return DocaCaptchaOcr.MergePreferringTesseract(openAiText, tesseractText);
        }

        if (!string.IsNullOrWhiteSpace(openAiText) && DocaCaptchaOcr.IsValidCaptchaLength(openAiText))
        {
            return openAiText;
        }

        return tesseractText;
    }

    private static bool UseOpenAi(CaptchaOcrSettings settings)
    {
        if (!settings.Provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase)
            && !settings.Provider.Equals("AI", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return !string.IsNullOrWhiteSpace(OpenAiCaptchaOcr.ResolveApiKey(settings));
    }
}
