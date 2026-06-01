using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.Versioning;

namespace Yesgatc.CertificateWorker.Services;

[SupportedOSPlatform("windows")]
public static class DocaUploadImagePreparer
{
    public const long DefaultMaxBytes = 350 * 1024;
    public const int DefaultMaxEdgePx = 1600;
    public const long DefaultJpegQuality = 85;

    public sealed record PreparedImage(string Path, long SizeBytes, bool WasOptimized, string Summary);

    public static PreparedImage PrepareMachinePhotoForUpload(
        string sourcePath,
        string outputDirectory,
        long maxBytes = DefaultMaxBytes,
        int maxEdgePx = DefaultMaxEdgePx,
        long jpegQuality = DefaultJpegQuality)
    {
        if (!File.Exists(sourcePath))
        {
            throw new FileNotFoundException("Machine photo was not found for DOCA upload.", sourcePath);
        }

        Directory.CreateDirectory(outputDirectory);
        var outputPath = Path.Combine(outputDirectory, "doca-machine-photo.jpg");
        var originalBytes = new FileInfo(sourcePath).Length;

        using var source = Image.FromFile(sourcePath);
        using var resized = ResizeToMaxEdge(source, maxEdgePx);
        SaveJpeg(resized, outputPath, jpegQuality);

        var preparedBytes = new FileInfo(outputPath).Length;
        var quality = jpegQuality;

        while (preparedBytes > maxBytes && (quality > 40 || maxEdgePx > 480))
        {
            if (quality > 40)
            {
                quality -= 5;
            }
            else
            {
                maxEdgePx = Math.Max(480, (int)(maxEdgePx * 0.85));
            }

            using var smaller = ResizeToMaxEdge(source, maxEdgePx);
            SaveJpeg(smaller, outputPath, quality);
            preparedBytes = new FileInfo(outputPath).Length;
        }

        var wasOptimized = preparedBytes < originalBytes
            || !sourcePath.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase);
        var summary =
            $"machine photo {FormatSize(originalBytes)} → {FormatSize(preparedBytes)} for DOCA upload";

        return new PreparedImage(outputPath, preparedBytes, wasOptimized, summary);
    }

    private static Image ResizeToMaxEdge(Image source, int maxEdgePx)
    {
        var width = source.Width;
        var height = source.Height;
        if (width <= maxEdgePx && height <= maxEdgePx)
        {
            return (Image)source.Clone();
        }

        var scale = Math.Min((double)maxEdgePx / width, (double)maxEdgePx / height);
        var targetWidth = Math.Max(1, (int)Math.Round(width * scale));
        var targetHeight = Math.Max(1, (int)Math.Round(height * scale));

        var bitmap = new Bitmap(targetWidth, targetHeight);
        bitmap.SetResolution(source.HorizontalResolution, source.VerticalResolution);

        using var graphics = Graphics.FromImage(bitmap);
        graphics.CompositingQuality = CompositingQuality.HighQuality;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.SmoothingMode = SmoothingMode.HighQuality;
        graphics.DrawImage(source, 0, 0, targetWidth, targetHeight);

        return bitmap;
    }

    private static void SaveJpeg(Image image, string outputPath, long quality)
    {
        var codec = ImageCodecInfo.GetImageEncoders()
            .FirstOrDefault(encoder => encoder.FormatID == ImageFormat.Jpeg.Guid)
            ?? throw new InvalidOperationException("JPEG encoder is not available on this system.");

        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, quality);
        image.Save(outputPath, codec, parameters);
    }

    private static string FormatSize(long bytes)
    {
        if (bytes >= 1024 * 1024)
        {
            return $"{bytes / 1024.0 / 1024.0:0.1} MB";
        }

        return $"{Math.Max(1, bytes / 1024)} KB";
    }
}
