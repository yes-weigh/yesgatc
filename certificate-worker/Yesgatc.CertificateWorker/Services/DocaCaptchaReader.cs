using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public static class DocaCaptchaReader
{
    public static async Task<string> ReadCaptchaFromImageAsync(
        byte[] imageBytes,
        CaptchaOcrSettings settings,
        CancellationToken cancellationToken = default)
    {
        if (UseOpenAi(settings))
        {
            try
            {
                var fromAi = await OpenAiCaptchaOcr.ReadCaptchaFromImageAsync(imageBytes, settings, cancellationToken);
                if (fromAi.Length is >= 4 and <= 8)
                {
                    return fromAi;
                }
            }
            catch when (settings.FallbackToTesseract)
            {
            }
        }

        return DocaCaptchaOcr.ReadCaptchaFromImage(imageBytes);
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
