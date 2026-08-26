using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>Knock out near-white pixels (web CSS equivalent of hiding a white card behind ink).</summary>
internal static class SignatureImagePrep
{
    public static byte[] KnockOutWhite(byte[] imageBytes, byte whiteThreshold = 248)
    {
        using var input = new MemoryStream(imageBytes, writable: false);
        using var loaded = new Bitmap(input);
        using var source = loaded.Clone(
            new Rectangle(0, 0, loaded.Width, loaded.Height),
            PixelFormat.Format32bppArgb);

        var bounds = new Rectangle(0, 0, source.Width, source.Height);
        var data = source.LockBits(bounds, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        try
        {
            var bytes = Math.Abs(data.Stride) * data.Height;
            var buffer = new byte[bytes];
            System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buffer, 0, bytes);
            var stride = Math.Abs(data.Stride);
            for (var y = 0; y < source.Height; y++)
            {
                var row = y * stride;
                for (var x = 0; x < source.Width; x++)
                {
                    var i = row + (x * 4);
                    var b = buffer[i];
                    var g = buffer[i + 1];
                    var r = buffer[i + 2];
                    var min = Math.Min(r, Math.Min(g, b));
                    if (min >= whiteThreshold)
                    {
                        buffer[i + 3] = 0;
                        continue;
                    }

                    var feather = whiteThreshold - 18;
                    if (min >= feather)
                    {
                        buffer[i + 3] = (byte)Math.Clamp((whiteThreshold - min) * 255 / 18, 0, 255);
                    }
                }
            }

            System.Runtime.InteropServices.Marshal.Copy(buffer, 0, data.Scan0, bytes);
        }
        finally
        {
            source.UnlockBits(data);
        }

        using var cropped = CropToInk(source);
        using var output = new MemoryStream();
        cropped.Save(output, ImageFormat.Png);
        return output.ToArray();
    }

    private static Bitmap CropToInk(Bitmap source)
    {
        var minX = source.Width;
        var minY = source.Height;
        var maxX = -1;
        var maxY = -1;
        for (var y = 0; y < source.Height; y++)
        {
            for (var x = 0; x < source.Width; x++)
            {
                if (source.GetPixel(x, y).A < 12)
                {
                    continue;
                }

                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }
        }

        if (maxX < minX)
        {
            return source.Clone(new Rectangle(0, 0, source.Width, source.Height), PixelFormat.Format32bppArgb);
        }

        var pad = 2;
        var left = Math.Max(0, minX - pad);
        var top = Math.Max(0, minY - pad);
        var right = Math.Min(source.Width - 1, maxX + pad);
        var bottom = Math.Min(source.Height - 1, maxY + pad);
        return source.Clone(
            new Rectangle(left, top, right - left + 1, bottom - top + 1),
            PixelFormat.Format32bppArgb);
    }
}
