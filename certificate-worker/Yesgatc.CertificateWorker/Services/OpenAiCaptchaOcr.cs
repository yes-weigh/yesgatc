using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public static class OpenAiCaptchaOcr
{
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(30),
    };

    private static readonly Regex CaptchaTextPattern = new(
        "^[A-Z0-9]{4,8}$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static async Task<string> ReadCaptchaFromImageAsync(
        byte[] imageBytes,
        CaptchaOcrSettings settings,
        CancellationToken cancellationToken = default)
    {
        var apiKey = ResolveApiKey(settings);
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException(
                "OpenAI captcha OCR requires Automation:CaptchaOcr:ApiKey or OPENAI_API_KEY.");
        }

        var baseUrl = string.IsNullOrWhiteSpace(settings.ApiBaseUrl)
            ? "https://api.openai.com/v1"
            : settings.ApiBaseUrl.TrimEnd('/');
        var model = string.IsNullOrWhiteSpace(settings.Model) ? "gpt-4o" : settings.Model.Trim();
        var visionBytes = DocaCaptchaOcr.BuildVisionApiPngBytes(imageBytes);
        var imageBase64 = Convert.ToBase64String(visionBytes);

        var request = new ChatCompletionRequest
        {
            Model = model,
            Temperature = 0,
            MaxTokens = 16,
            Messages =
            [
                new ChatMessage
                {
                    Role = "user",
                    Content =
                    [
                        new ChatContentPart
                        {
                            Type = "text",
                            Text =
                                "This image is a website login captcha with spaced alphanumeric characters. " +
                                "Reply with ONLY the captcha text: uppercase letters A-Z and digits 0-9, no spaces. " +
                                "Pay close attention to similar characters: S vs 5, O vs 0, B vs 8, G vs 6, Z vs 2, I vs 1. " +
                                "Example: if you see 'Q 7 6 A 2 S' reply Q76A2S. If unreadable reply EMPTY.",
                        },
                        new ChatContentPart
                        {
                            Type = "image_url",
                            ImageUrl = new ChatImageUrl { Url = $"data:image/png;base64,{imageBase64}" },
                        },
                    ],
                },
            ],
        };

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/chat/completions")
        {
            Content = JsonContent.Create(request, options: JsonOptions),
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        using var response = await Http.SendAsync(httpRequest, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"OpenAI captcha OCR failed ({(int)response.StatusCode}): {TrimForError(body)}");
        }

        var completion = JsonSerializer.Deserialize<ChatCompletionResponse>(body, JsonOptions)
            ?? throw new InvalidOperationException("OpenAI captcha OCR returned an empty response.");

        var raw = completion.Choices?.FirstOrDefault()?.Message?.Content?.Trim() ?? string.Empty;
        if (raw.Equals("EMPTY", StringComparison.OrdinalIgnoreCase))
        {
            return string.Empty;
        }

        var normalized = DocaCaptchaOcr.NormalizeCaptchaText(raw);
        return CaptchaTextPattern.IsMatch(normalized) ? normalized : string.Empty;
    }

    /// <summary>
    /// Set at runtime from saved credentials so the key takes effect immediately
    /// without requiring an app restart.
    /// </summary>
    public static string? RuntimeApiKeyOverride { get; set; }

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

        var fromEnv = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        return string.IsNullOrWhiteSpace(fromEnv) ? null : fromEnv.Trim();
    }

    private static string TrimForError(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return "no response body";
        }

        return body.Length <= 240 ? body : body[..240] + "...";
    }

    private sealed class ChatCompletionRequest
    {
        public string Model { get; set; } = string.Empty;
        public List<ChatMessage> Messages { get; set; } = [];
        public int MaxTokens { get; set; }
        public int Temperature { get; set; }
    }

    private sealed class ChatMessage
    {
        public string Role { get; set; } = string.Empty;
        public List<ChatContentPart> Content { get; set; } = [];
    }

    private sealed class ChatContentPart
    {
        public string Type { get; set; } = string.Empty;
        public string? Text { get; set; }

        [JsonPropertyName("image_url")]
        public ChatImageUrl? ImageUrl { get; set; }
    }

    private sealed class ChatImageUrl
    {
        public string Url { get; set; } = string.Empty;
    }

    private sealed class ChatCompletionResponse
    {
        public List<ChatChoice>? Choices { get; set; }
    }

    private sealed class ChatChoice
    {
        public ChatResponseMessage? Message { get; set; }
    }

    private sealed class ChatResponseMessage
    {
        public string? Content { get; set; }
    }
}
