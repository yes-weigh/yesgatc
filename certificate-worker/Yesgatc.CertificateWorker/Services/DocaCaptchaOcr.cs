using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using Tesseract;
using DrawingImageFormat = System.Drawing.Imaging.ImageFormat;

namespace Yesgatc.CertificateWorker.Services;

public static class DocaCaptchaOcr
{
    private static readonly Regex AlphanumericOnly = new("[^A-Za-z0-9]", RegexOptions.Compiled);
    private static readonly int[] BinarizeThresholds = [110, 120, 130, 140, 150];

    public static string ReadCaptchaFromImage(byte[] imageBytes)
    {
        var tessdataPath = Path.Combine(AppContext.BaseDirectory, "tessdata");
        if (!Directory.Exists(tessdataPath))
        {
            throw new InvalidOperationException(
                $"Tesseract data folder not found at {tessdataPath}. Rebuild the project or run npm run worker:dev.");
        }

        var candidates = new List<string>();

        foreach (var threshold in BinarizeThresholds)
        {
            var segmented = TryReadSegmentedCharacters(imageBytes, tessdataPath, threshold);
            if (segmented.Length is >= 4 and <= 8)
            {
                candidates.Add(segmented);
            }
        }

        foreach (var charCount in new[] { 6, 5, 7 })
        {
            var equalWidth = TryReadEqualWidthCharacters(imageBytes, tessdataPath, charCount);
            if (equalWidth.Length == charCount)
            {
                candidates.Add(equalWidth);
            }
        }

        var voted = PickBestByVote(candidates);
        if (voted.Length is >= 4 and <= 8)
        {
            return voted;
        }

        var best = string.Empty;
        var bestScore = -1;

        foreach (var threshold in BinarizeThresholds)
        {
            foreach (var mode in new[] { PageSegMode.SingleLine, PageSegMode.SparseText, PageSegMode.SingleBlock })
            {
                var candidate = TryReadWholeImage(imageBytes, tessdataPath, mode, threshold);
                var score = ScoreCaptcha(candidate);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = candidate;
                }
            }
        }

        return bestScore >= 0 ? best : string.Empty;
    }

    public static string NormalizeCaptchaText(string raw)
    {
        var cleaned = AlphanumericOnly.Replace(raw, string.Empty).ToUpperInvariant();
        return cleaned;
    }

    /// <summary>Upscale captcha PNG for vision APIs — same preprocessing Tesseract uses.</summary>
    public static byte[] BuildVisionApiPngBytes(byte[] imageBytes)
    {
        using var scaled = PreprocessForOcrScaledOnly(imageBytes);
        using var memory = new MemoryStream();
        scaled.Save(memory, DrawingImageFormat.Png);
        return memory.ToArray();
    }

    public static bool IsValidCaptchaLength(string text) => text.Length is >= 4 and <= 8;

    /// <summary>When AI and Tesseract disagree char-by-char, keep segmented Tesseract chars.</summary>
    public static string MergePreferringTesseract(string aiText, string tesseractText)
    {
        if (string.Equals(aiText, tesseractText, StringComparison.OrdinalIgnoreCase))
        {
            return aiText.ToUpperInvariant();
        }

        if (!IsValidCaptchaLength(tesseractText))
        {
            return IsValidCaptchaLength(aiText) ? aiText.ToUpperInvariant() : string.Empty;
        }

        if (!IsValidCaptchaLength(aiText) || aiText.Length != tesseractText.Length)
        {
            return tesseractText.ToUpperInvariant();
        }

        var merged = tesseractText.ToUpperInvariant().ToCharArray();
        for (var i = 0; i < merged.Length; i++)
        {
            if (char.ToUpperInvariant(aiText[i]) == char.ToUpperInvariant(tesseractText[i]))
            {
                merged[i] = char.ToUpperInvariant(aiText[i]);
            }
        }

        return new string(merged);
    }

    private static string PickBestByVote(IReadOnlyList<string> candidates)
    {
        if (candidates.Count == 0)
        {
            return string.Empty;
        }

        return candidates
            .GroupBy(static text => text)
            .OrderByDescending(static group => group.Count())
            .ThenByDescending(static group => group.Key.Length)
            .First()
            .Key;
    }

    private static string TryReadSegmentedCharacters(byte[] imageBytes, string tessdataPath, int threshold)
    {
        using var scaled = PreprocessForOcrScaledOnly(imageBytes);
        using var binary = Binarize(scaled, threshold);
        var regions = FindCharacterRegions(binary);
        if (regions.Count is < 4 or > 8)
        {
            return string.Empty;
        }

        var result = new StringBuilder(regions.Count);
        foreach (var region in regions)
        {
            using var charBitmap = CropRegion(binary, region, padding: 4);
            var ch = OcrSingleCharacterBest(charBitmap, tessdataPath);
            if (ch.Length != 1)
            {
                return string.Empty;
            }

            result.Append(ch);
        }

        return result.ToString();
    }

    private static string TryReadEqualWidthCharacters(byte[] imageBytes, string tessdataPath, int charCount)
    {
        using var scaled = PreprocessForOcrScaledOnly(imageBytes);
        using var binary = Binarize(scaled, threshold: 130);
        var margin = Math.Max(2, binary.Width / (charCount * 12));
        var cellWidth = binary.Width / charCount;

        var result = new StringBuilder(charCount);
        for (var i = 0; i < charCount; i++)
        {
            var left = (i * cellWidth) + margin;
            var width = cellWidth - (2 * margin);
            if (width < 4)
            {
                return string.Empty;
            }

            var region = new Rectangle(left, 0, width, binary.Height);
            using var charBitmap = CropRegion(binary, region, padding: 2);
            var ch = OcrSingleCharacterBest(charBitmap, tessdataPath);
            if (ch.Length != 1)
            {
                return string.Empty;
            }

            result.Append(ch);
        }

        return result.ToString();
    }

    private static List<Rectangle> FindCharacterRegions(Bitmap binary)
    {
        var columnHasInk = new bool[binary.Width];
        for (var x = 0; x < binary.Width; x++)
        {
            for (var y = 0; y < binary.Height; y++)
            {
                if (IsInk(binary.GetPixel(x, y)))
                {
                    columnHasInk[x] = true;
                    break;
                }
            }
        }

        var regions = new List<Rectangle>();
        var start = -1;
        for (var x = 0; x < binary.Width; x++)
        {
            if (columnHasInk[x] && start < 0)
            {
                start = x;
            }
            else if (!columnHasInk[x] && start >= 0)
            {
                AddRegionIfValid(binary, regions, start, x - 1);
                start = -1;
            }
        }

        if (start >= 0)
        {
            AddRegionIfValid(binary, regions, start, binary.Width - 1);
        }

        return regions;
    }

    private static void AddRegionIfValid(Bitmap binary, List<Rectangle> regions, int left, int right)
    {
        var width = right - left + 1;
        if (width < 4)
        {
            return;
        }

        var top = binary.Height;
        var bottom = 0;
        for (var x = left; x <= right; x++)
        {
            for (var y = 0; y < binary.Height; y++)
            {
                if (!IsInk(binary.GetPixel(x, y)))
                {
                    continue;
                }

                top = Math.Min(top, y);
                bottom = Math.Max(bottom, y);
            }
        }

        if (bottom <= top)
        {
            return;
        }

        regions.Add(new Rectangle(left, top, width, bottom - top + 1));
    }

    private static Bitmap CropRegion(Bitmap source, Rectangle region, int padding)
    {
        var left = Math.Max(0, region.Left - padding);
        var top = Math.Max(0, region.Top - padding);
        var right = Math.Min(source.Width - 1, region.Left + region.Width - 1 + padding);
        var bottom = Math.Min(source.Height - 1, region.Top + region.Height - 1 + padding);
        var width = right - left + 1;
        var height = bottom - top + 1;

        var cropped = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(cropped))
        {
            graphics.Clear(Color.White);
            graphics.DrawImage(source, new Rectangle(0, 0, width, height), new Rectangle(left, top, width, height), GraphicsUnit.Pixel);
        }

        return cropped;
    }

    private static string OcrSingleCharacterBest(Bitmap charBitmap, string tessdataPath)
    {
        var bestChar = string.Empty;
        var bestConfidence = -1f;
        var owned = new List<Bitmap>();

        try
        {
            var variants = new List<Bitmap> { charBitmap };
            owned.Add(ScaleUp(charBitmap, minHeight: 72));
            owned.Add(ScaleUp(charBitmap, minHeight: 96));
            variants.AddRange(owned);

            foreach (var threshold in new[] { 120, 130, 140 })
            {
                var binarized = Binarize(charBitmap, threshold);
                owned.Add(binarized);
                variants.Add(binarized);
            }

            foreach (var variant in variants)
            {
                var (text, confidence) = OcrWithConfidence(variant, tessdataPath);
                if (text.Length == 1 && confidence > bestConfidence)
                {
                    bestConfidence = confidence;
                    bestChar = text;
                }
            }
        }
        finally
        {
            foreach (var variant in owned)
            {
                variant.Dispose();
            }
        }

        return bestChar;
    }

    private static (string Text, float Confidence) OcrWithConfidence(Bitmap bitmap, string tessdataPath)
    {
        using var memory = new MemoryStream();
        bitmap.Save(memory, DrawingImageFormat.Png);

        using var engine = new TesseractEngine(tessdataPath, "eng", EngineMode.Default);
        engine.SetVariable("tessedit_char_whitelist", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
        engine.DefaultPageSegMode = PageSegMode.SingleChar;

        using var pix = Pix.LoadFromMemory(memory.ToArray());
        using var page = engine.Process(pix);
        var raw = NormalizeCaptchaText(page.GetText() ?? string.Empty);
        if (raw.Length == 0)
        {
            return (string.Empty, 0f);
        }

        var confidence = page.GetMeanConfidence();
        return (raw[..1], confidence);
    }

    private static Bitmap ScaleUp(Bitmap source, int minHeight)
    {
        var scale = Math.Max(2, (minHeight + source.Height - 1) / Math.Max(1, source.Height));
        var output = new Bitmap(source.Width * scale, source.Height * scale, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(output))
        {
            graphics.Clear(Color.White);
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(source, 0, 0, output.Width, output.Height);
        }

        return output;
    }

    private static int ScoreCaptcha(string text)
    {
        if (text.Length is < 4 or > 8)
        {
            return -1;
        }

        return text.Length switch
        {
            6 => 10,
            5 => 9,
            4 => 8,
            7 => 7,
            _ => 6,
        };
    }

    private static string TryReadWholeImage(byte[] imageBytes, string tessdataPath, PageSegMode mode, int threshold)
    {
        using var processed = PreprocessForOcr(imageBytes, threshold);
        using var memory = new MemoryStream();
        processed.Save(memory, DrawingImageFormat.Png);

        using var engine = new TesseractEngine(tessdataPath, "eng", EngineMode.Default);
        engine.SetVariable("tessedit_char_whitelist", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
        engine.DefaultPageSegMode = mode;

        using var pix = Pix.LoadFromMemory(memory.ToArray());
        using var page = engine.Process(pix);
        return NormalizeCaptchaText(page.GetText() ?? string.Empty);
    }

    private static Bitmap PreprocessForOcrScaledOnly(byte[] imageBytes)
    {
        using var source = new Bitmap(new MemoryStream(imageBytes));
        var scale = Math.Max(4, 500 / Math.Max(1, Math.Min(source.Width, source.Height)));
        var width = source.Width * scale;
        var height = source.Height * scale;

        var output = new Bitmap(width, height, PixelFormat.Format24bppRgb);
        using (var graphics = Graphics.FromImage(output))
        {
            graphics.Clear(Color.White);
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(source, 0, 0, width, height);
        }

        return output;
    }

    private static Bitmap PreprocessForOcr(byte[] imageBytes, int threshold)
    {
        using var scaled = PreprocessForOcrScaledOnly(imageBytes);
        return Binarize(scaled, threshold);
    }

    private static Bitmap Binarize(Bitmap scaled, int threshold)
    {
        var output = new Bitmap(scaled.Width, scaled.Height, PixelFormat.Format24bppRgb);
        for (var y = 0; y < scaled.Height; y++)
        {
            for (var x = 0; x < scaled.Width; x++)
            {
                var pixel = scaled.GetPixel(x, y);
                var gray = (int)(pixel.R * 0.299 + pixel.G * 0.587 + pixel.B * 0.114);
                output.SetPixel(x, y, gray < threshold ? Color.Black : Color.White);
            }
        }

        return output;
    }

    private static bool IsInk(Color pixel) =>
        (int)(pixel.R * 0.299 + pixel.G * 0.587 + pixel.B * 0.114) < 130;
}
