using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using UglyToad.PdfPig;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed record CertificateStampResult(string OutputPath, DateTimeOffset StampedAt);

public static class CertificatePdfStampService
{
    private const double NameDetailGap = 10;
    private const double LineSpacing = 1.12;

    static CertificatePdfStampService()
    {
        GlobalFontSettings.UseWindowsFontsUnderWindows = true;
    }

    public static CertificateStampResult StampPrincipalOfficerSignature(
        string sourcePdfPath,
        CertificateStampSettings settings,
        DateTimeOffset? stampedAt = null)
    {
        if (!File.Exists(sourcePdfPath))
        {
            throw new FileNotFoundException("Certificate PDF was not found.", sourcePdfPath);
        }

        var officerName = settings.PrincipalOfficerName.Trim();
        if (string.IsNullOrWhiteSpace(officerName))
        {
            throw new InvalidOperationException("PrincipalOfficerName is required to stamp the certificate PDF.");
        }

        var timestamp = stampedAt ?? ResolveStampTime(settings);
        var anchor = FindSignatureAnchor(sourcePdfPath);
        var outputPath = BuildStampedOutputPath(sourcePdfPath);

        using var document = PdfReader.Open(sourcePdfPath, PdfDocumentOpenMode.Modify);
        if (document.Version < 14)
        {
            document.Version = 14;
        }

        var pageIndex = Math.Clamp(anchor.PageIndex, 0, document.PageCount - 1);
        var page = document.Pages[pageIndex];
        var pageWidth = page.Width.Point;
        var pageHeight = page.Height.Point;

        using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
        DrawSignatureBlock(gfx, officerName, timestamp, anchor, pageWidth, pageHeight, settings);

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        document.Save(outputPath);
        return new CertificateStampResult(outputPath, timestamp);
    }

    private static DateTimeOffset ResolveStampTime(CertificateStampSettings settings)
    {
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(settings.TimeZoneId);
        var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, timeZone);
        return local;
    }

    private static string BuildStampedOutputPath(string sourcePdfPath)
    {
        var directory = Path.GetDirectoryName(sourcePdfPath)
            ?? throw new InvalidOperationException("Could not resolve the certificate PDF directory.");
        var baseName = Path.GetFileNameWithoutExtension(sourcePdfPath);
        return Path.Combine(directory, $"{baseName}_stamped.pdf");
    }

    private static SignatureAnchor FindSignatureAnchor(string pdfPath)
    {
        using var document = UglyToad.PdfPig.PdfDocument.Open(pdfPath);
        foreach (var page in document.GetPages())
        {
            var words = page.GetWords().ToList();
            for (var index = 0; index < words.Count; index++)
            {
                if (!IsSignatureLabelStart(words, index))
                {
                    continue;
                }

                var matched = words.Skip(index).Take(4).ToList();
                var left = matched.Min(word => word.BoundingBox.Left);
                var right = matched.Max(word => word.BoundingBox.Right);
                var top = matched.Max(word => word.BoundingBox.Top);
                var pageRight = page.MediaBox.Bounds.Left + page.MediaBox.Bounds.Width;
                var contentRight = words.Count > 0
                    ? words.Max(word => word.BoundingBox.Right)
                    : pageRight;

                return new SignatureAnchor(page.Number - 1, left, right, top, pageRight, contentRight);
            }
        }

        // DOCA OV certificates keep the signature label in a stable spot on page 1.
        return new SignatureAnchor(0, 330, 520, 168, 595, 520);
    }

    private static bool IsSignatureLabelStart(IReadOnlyList<UglyToad.PdfPig.Content.Word> words, int index)
    {
        if (index + 3 >= words.Count)
        {
            return false;
        }

        return words[index].Text.Contains("Signature", StringComparison.OrdinalIgnoreCase)
            && words[index + 1].Text.Contains("of", StringComparison.OrdinalIgnoreCase)
            && words[index + 2].Text.Contains("Principal", StringComparison.OrdinalIgnoreCase)
            && words[index + 3].Text.Contains("Officer", StringComparison.OrdinalIgnoreCase);
    }

    private static void DrawSignatureBlock(
        XGraphics gfx,
        string officerName,
        DateTimeOffset timestamp,
        SignatureAnchor anchor,
        double pageWidth,
        double pageHeight,
        CertificateStampSettings settings)
    {
        var nameFont = new XFont("Arial", settings.NameFontSize, XFontStyleEx.Bold);
        var detailFont = new XFont("Arial", settings.DetailFontSize, XFontStyleEx.Regular);
        var brush = XBrushes.Black;

        var (nameLine1, nameLine2) = SplitOfficerName(officerName);
        var dateLine = $"Date: {timestamp:yyyy.MM.dd}";
        var timeLine = FormatStampTimeLine(timestamp, settings);

        var detailLines = new[]
        {
            "Digitally signed by",
            officerName.ToUpperInvariant(),
            dateLine,
            timeLine
        };

        var detailLineHeight = detailFont.GetHeight() * LineSpacing;
        var detailBlockHeight = detailLineHeight * detailLines.Length;
        var detailBlockWidth = detailLines.Max(line => gfx.MeasureString(line, detailFont).Width);

        var nameLineHeight = nameFont.GetHeight() * LineSpacing;
        var nameBlockHeight = string.IsNullOrWhiteSpace(nameLine2) ? nameLineHeight : nameLineHeight * 2;
        var nameBlockWidth = Math.Max(
            gfx.MeasureString(nameLine1, nameFont).Width,
            string.IsNullOrWhiteSpace(nameLine2) ? 0 : gfx.MeasureString(nameLine2, nameFont).Width);

        var sealHeight = Math.Max(nameBlockHeight, detailBlockHeight);

        // PdfPig uses PDF coords (origin bottom-left). PDFsharp uses top-left, Y increases downward.
        var signatureLineTop = pageHeight - anchor.Top;
        var blockBottomY = signatureLineTop - settings.GapAboveSignatureLabel + settings.OffsetY;
        var blockTopY = blockBottomY - sealHeight;

        // Position in PDFsharp drawable coordinates (crop box), not PdfPig media coords.
        var detailRight = pageWidth - settings.RightMargin + settings.OffsetX;
        var nameLeft = detailRight - detailBlockWidth - NameDetailGap - nameBlockWidth;

        DrawWatermark(
            gfx,
            settings,
            nameLeft,
            detailRight,
            blockTopY,
            blockTopY + detailBlockHeight);

        var detailY = blockTopY;
        foreach (var line in detailLines)
        {
            var lineWidth = gfx.MeasureString(line, detailFont).Width;
            gfx.DrawString(line, detailFont, brush, new XPoint(detailRight - lineWidth, detailY));
            detailY += detailLineHeight;
        }

        var nameTopY = blockTopY + (detailBlockHeight - nameBlockHeight) / 2 + settings.NameOffsetY;
        gfx.DrawString(nameLine1, nameFont, brush, new XPoint(nameLeft, nameTopY));
        if (!string.IsNullOrWhiteSpace(nameLine2))
        {
            gfx.DrawString(nameLine2, nameFont, brush, new XPoint(nameLeft, nameTopY + nameLineHeight));
        }
    }

    private static void DrawWatermark(
        XGraphics gfx,
        CertificateStampSettings settings,
        double sealLeft,
        double sealRight,
        double sealTop,
        double sealBottom)
    {
        var watermarkPath = ResolveWatermarkPath(settings);
        if (!File.Exists(watermarkPath))
        {
            return;
        }

        var tempPath = Path.Combine(Path.GetTempPath(), $"yesgatc-watermark-{Guid.NewGuid():N}.png");
        try
        {
            SaveProcessedWatermark(watermarkPath, tempPath, settings.WatermarkOpacity);
            using var watermark = XImage.FromFile(tempPath);
            var aspect = watermark.PixelWidth / (double)watermark.PixelHeight;
            var height = settings.WatermarkHeight;
            var width = height * aspect;
            var centerX = (sealLeft + sealRight) / 2;
            var centerY = (sealTop + sealBottom) / 2 + settings.WatermarkOffsetY;

            gfx.DrawImage(watermark, centerX - width / 2, centerY - height / 2, width, height);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    private static string ResolveWatermarkPath(CertificateStampSettings settings)
    {
        return Path.IsPathRooted(settings.WatermarkPath)
            ? settings.WatermarkPath
            : Path.Combine(AppContext.BaseDirectory, settings.WatermarkPath);
    }

    private static void SaveProcessedWatermark(string sourcePath, string outputPath, double opacity)
    {
        using var source = (Bitmap)Image.FromFile(sourcePath);
        using var processed = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);

        var alphaScale = (float)Math.Clamp(opacity, 0, 1);
        for (var y = 0; y < source.Height; y++)
        {
            for (var x = 0; x < source.Width; x++)
            {
                var pixel = source.GetPixel(x, y);
                if (pixel.R < 45 && pixel.G < 45 && pixel.B < 45)
                {
                    processed.SetPixel(x, y, Color.Transparent);
                    continue;
                }

                var sourceAlpha = pixel.A / 255f;
                var alpha = (int)Math.Round(255 * alphaScale * sourceAlpha);
                var red = Math.Min(255, pixel.R + 90);
                var green = Math.Min(255, pixel.G + 50);
                var blue = Math.Min(255, pixel.B + 50);
                processed.SetPixel(x, y, Color.FromArgb(alpha, red, green, blue));
            }
        }

        processed.Save(outputPath, ImageFormat.Png);
    }

    private static (string Line1, string Line2) SplitOfficerName(string officerName)
    {
        var parts = officerName.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0)
        {
            return (officerName.ToUpperInvariant(), string.Empty);
        }

        if (parts.Length == 1)
        {
            return (parts[0].ToUpperInvariant(), string.Empty);
        }

        return (parts[0].ToUpperInvariant(), parts[1].ToUpperInvariant());
    }

    private static string FormatStampTimeLine(DateTimeOffset timestamp, CertificateStampSettings settings)
    {
        if (!string.IsNullOrWhiteSpace(settings.TimeZoneOffsetLabel))
        {
            return $"{timestamp:HH:mm:ss} {settings.TimeZoneOffsetLabel}";
        }

        var offset = timestamp.ToString("zzz", CultureInfo.InvariantCulture).Replace(":", string.Empty);
        return $"{timestamp:HH:mm:ss} {offset}";
    }

    private sealed record SignatureAnchor(
        int PageIndex,
        double Left,
        double Right,
        double Top,
        double PageRight,
        double ContentRight);
}
