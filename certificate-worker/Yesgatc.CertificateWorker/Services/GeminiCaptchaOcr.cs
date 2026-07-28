using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>Google Gemini vision captcha OCR (generateContent).</summary>
public static class GeminiCaptchaOcr
{
    /// <summary>Exact alphabet drawn by eMAAP (no I/O/l/0/1).</summary>
    private const string EmaapCharset =
        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(45),
    };

    private static readonly Regex CaptchaTextPattern = new(
        "^[A-Za-z0-9]{4,8}$",
        RegexOptions.Compiled);

    private static readonly Regex PipeSeparated = new(
        @"^[A-Za-z0-9](?:\|[A-Za-z0-9]){3,7}$",
        RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = true,
    };

    private const string CaptchaPrompt =
        """
        You are reading a CASE-SENSITIVE website login captcha image.

        Alphabet allowed (nothing else):
        UPPER: A B C D E F G H J K L M N P Q R S T U V W X Y Z  (no I, no O)
        lower: a b c d e f g h i j k m n p q r s t u v w x y z  (no lowercase L)
        digits: 2 3 4 5 6 7 8 9  (no 0, no 1)

        Rules:
        1. Read LEFT → RIGHT, one glyph at a time.
        2. NEVER change case. Upper and lower are different answers.
        3. Judge case by glyph shape AND relative height:
           - UPPERCASE is usually taller / blockier.
           - lowercase may be shorter or have tails (g, y, q, p, j).
        4. Confusable pairs — pick carefully:
           S/s/5 · Z/z/2 · B/b/8 · G/g/6 · Q/q · C/c · P/p · K/k · V/v · W/w · X/x · Y/y
        5. Do NOT invent I, O, l, 0, or 1 — those never appear.
        6. Typical length is 6 characters (sometimes 5–7).

        Return JSON ONLY:
        {"characters":["f","3","S","b","g","Q"]}
        Each array item is exactly one character with correct case.
        If unreadable: {"characters":[]}
        """;

    public static async Task<string> ReadCaptchaFromImageAsync(
        byte[] imageBytes,
        CaptchaOcrSettings settings,
        CancellationToken cancellationToken = default)
    {
        var apiKey = CaptchaOcrKeys.ResolveApiKey(settings);
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException(
                "Gemini captcha OCR requires Automation:CaptchaOcr:ApiKey, Captcha AI Key in the UI, or GEMINI_API_KEY.");
        }

        var baseUrl = string.IsNullOrWhiteSpace(settings.ApiBaseUrl)
            ? "https://generativelanguage.googleapis.com/v1beta"
            : settings.ApiBaseUrl.TrimEnd('/');
        var model = string.IsNullOrWhiteSpace(settings.Model)
            ? "gemini-3.6-flash"
            : settings.Model.Trim();

        // Black ink only (drop colored noise), then mild upscale.
        var visionBytes = ChooseVisionBytes(imageBytes);
        var imageBase64 = Convert.ToBase64String(visionBytes);

        var request = new GenerateContentRequest
        {
            SystemInstruction = new Content
            {
                Parts =
                [
                    new Part
                    {
                        Text =
                            "You extract case-sensitive captcha text. Preserve exact upper/lower case. Output valid JSON only.",
                    },
                ],
            },
            Contents =
            [
                new Content
                {
                    Parts =
                    [
                        new Part { Text = CaptchaPrompt },
                        new Part
                        {
                            InlineData = new InlineData
                            {
                                MimeType = "image/png",
                                Data = imageBase64,
                            },
                        },
                    ],
                },
            ],
            GenerationConfig = new GenerationConfig
            {
                Temperature = 0,
                MaxOutputTokens = 512,
                ResponseMimeType = "application/json",
                ResponseSchema = new
                {
                    type = "OBJECT",
                    properties = new
                    {
                        characters = new
                        {
                            type = "ARRAY",
                            items = new { type = "STRING" },
                        },
                    },
                    required = new[] { "characters" },
                },
            },
        };

        var url = $"{baseUrl}/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";
        using var response = await Http.PostAsJsonAsync(url, request, JsonOptions, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Gemini captcha OCR failed ({(int)response.StatusCode}): {TrimForError(body)}");
        }

        var parsed = JsonSerializer.Deserialize<GenerateContentResponse>(body, JsonOptions)
            ?? throw new InvalidOperationException("Gemini captcha OCR returned an empty response.");

        var raw = ExtractBestText(parsed);
        var normalized = ParseCaptchaAnswer(raw);
        return CaptchaTextPattern.IsMatch(normalized) ? normalized : string.Empty;
    }

    private static byte[] ChooseVisionBytes(byte[] imageBytes)
    {
        try
        {
            return DocaCaptchaOcr.BuildBlackOnlyVisionPngBytes(imageBytes);
        }
        catch
        {
            return imageBytes;
        }
    }

    private static string ExtractBestText(GenerateContentResponse parsed)
    {
        var parts = parsed.Candidates?
            .SelectMany(candidate => candidate.Content?.Parts ?? [])
            .Select(part => part.Text?.Trim())
            .Where(text => !string.IsNullOrWhiteSpace(text))
            .Cast<string>()
            .ToList() ?? [];

        if (parts.Count == 0)
        {
            return string.Empty;
        }

        // Prefer a JSON blob that contains "characters"; else last text part (thinking models).
        for (var i = parts.Count - 1; i >= 0; i--)
        {
            if (parts[i].Contains("characters", StringComparison.OrdinalIgnoreCase))
            {
                return parts[i];
            }
        }

        return parts[^1];
    }

    private static string ParseCaptchaAnswer(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)
            || raw.Equals("EMPTY", StringComparison.OrdinalIgnoreCase))
        {
            return string.Empty;
        }

        // Structured JSON: {"characters":["f","3","S",...]}
        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.TryGetProperty("characters", out var chars)
                && chars.ValueKind == JsonValueKind.Array)
            {
                var built = string.Concat(
                    chars.EnumerateArray()
                        .Select(item => item.GetString()?.Trim() ?? string.Empty)
                        .Where(s => s.Length > 0)
                        .Select(s => s.Length == 1 ? s : s[..1]));
                return SanitizeToEmaapCharset(built);
            }
        }
        catch (JsonException)
        {
            // fall through
        }

        // Pipe form: f|3|S|b|g|Q
        var compact = raw.Trim().Trim('`').Trim();
        if (PipeSeparated.IsMatch(compact))
        {
            return SanitizeToEmaapCharset(compact.Replace("|", string.Empty, StringComparison.Ordinal));
        }

        // Plain: strip spaces/punctuation, keep case.
        var plain = Regex.Replace(compact, "[^A-Za-z0-9]", string.Empty);
        return SanitizeToEmaapCharset(plain);
    }

    /// <summary>
    /// Drop / remap glyphs that eMAAP never draws (I,O,l,0,1) without uppercasing everything.
    /// </summary>
    private static string SanitizeToEmaapCharset(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var chars = text.Select(ch =>
        {
            if (EmaapCharset.Contains(ch))
            {
                return ch;
            }

            // Common misreads → closest legal glyph (keep case intent).
            return ch switch
            {
                'I' or '|' => 'J',
                'l' or '1' => 'i',
                'O' => 'Q',
                '0' => '8',
                _ => '\0',
            };
        }).Where(ch => ch != '\0').ToArray();

        return new string(chars);
    }

    private static string TrimForError(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return "no response body";
        }

        return body.Length <= 240 ? body : body[..240] + "...";
    }

    private sealed class GenerateContentRequest
    {
        [JsonPropertyName("system_instruction")]
        public Content? SystemInstruction { get; set; }

        public List<Content> Contents { get; set; } = [];
        public GenerationConfig? GenerationConfig { get; set; }
    }

    private sealed class Content
    {
        public List<Part> Parts { get; set; } = [];
    }

    private sealed class Part
    {
        public string? Text { get; set; }

        [JsonPropertyName("inline_data")]
        public InlineData? InlineData { get; set; }
    }

    private sealed class InlineData
    {
        [JsonPropertyName("mime_type")]
        public string MimeType { get; set; } = "image/png";

        public string Data { get; set; } = string.Empty;
    }

    private sealed class GenerationConfig
    {
        public double Temperature { get; set; }
        public int MaxOutputTokens { get; set; }
        public string? ResponseMimeType { get; set; }
        public object? ResponseSchema { get; set; }
    }

    private sealed class GenerateContentResponse
    {
        public List<Candidate>? Candidates { get; set; }
    }

    private sealed class Candidate
    {
        public Content? Content { get; set; }
    }
}
