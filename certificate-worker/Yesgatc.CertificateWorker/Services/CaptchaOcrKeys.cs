using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>Shared captcha provider / API key resolution.</summary>
public static class CaptchaOcrKeys
{
    /// <summary>
    /// Set at runtime from saved credentials so the key takes effect immediately
    /// without requiring an app restart.
    /// </summary>
    public static string? RuntimeApiKeyOverride { get; set; }

    public static bool IsDeepSeek(CaptchaOcrSettings settings) =>
        settings.Provider.Equals("DeepSeek", StringComparison.OrdinalIgnoreCase)
        || settings.Provider.Equals("DeepSeekChat", StringComparison.OrdinalIgnoreCase);

    public static bool IsGemini(CaptchaOcrSettings settings) =>
        settings.Provider.Equals("Gemini", StringComparison.OrdinalIgnoreCase)
        || settings.Provider.Equals("Google", StringComparison.OrdinalIgnoreCase);

    public static bool IsOpenAi(CaptchaOcrSettings settings) =>
        settings.Provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase)
        || settings.Provider.Equals("AI", StringComparison.OrdinalIgnoreCase);

    public static bool RequiresApiKey(CaptchaOcrSettings settings) =>
        IsGemini(settings) || IsOpenAi(settings);

    public static string? ResolveApiKey(CaptchaOcrSettings settings)
    {
        if (!string.IsNullOrWhiteSpace(RuntimeApiKeyOverride))
        {
            return RuntimeApiKeyOverride.Trim();
        }

        if (!string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            return settings.ApiKey.Trim();
        }

        if (IsGemini(settings))
        {
            return FirstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY");
        }

        if (IsOpenAi(settings))
        {
            return FirstEnv("OPENAI_API_KEY");
        }

        return null;
    }

    /// <summary>Human-readable label for activity logs.</summary>
    public static string DescribeProvider(CaptchaOcrSettings settings)
    {
        if (IsDeepSeek(settings))
        {
            return "DeepSeek · chat.deepseek.com";
        }

        if (IsGemini(settings))
        {
            var model = string.IsNullOrWhiteSpace(settings.Model)
                ? "gemini-3.6-flash"
                : settings.Model.Trim();
            return $"Gemini · {model}";
        }

        if (IsOpenAi(settings))
        {
            var model = string.IsNullOrWhiteSpace(settings.Model) ? "gpt-4o" : settings.Model.Trim();
            var merge = settings.CombineWithTesseract ? " + Tesseract" : string.Empty;
            return $"OpenAI · {model}{merge}";
        }

        return "Tesseract";
    }

    private static string? FirstEnv(params string[] names)
    {
        foreach (var name in names)
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return null;
    }
}
