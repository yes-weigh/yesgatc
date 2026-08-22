using System.Drawing;
using System.Drawing.Imaging;
using iText.IO.Image;

namespace Yesgatc.DscEngine.Services;

internal static class AdobeLogoImage
{
    public static ImageData? TryLoad()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "adobelogo.png");
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            using var source = new Bitmap(path);
            using var clear = PunchBlackBackground(source);
            using var buffer = new MemoryStream();
            clear.Save(buffer, ImageFormat.Png);
            return ImageDataFactory.Create(buffer.ToArray());
        }
        catch
        {
            return null;
        }
    }

    private static Bitmap PunchBlackBackground(Bitmap source)
    {
        var result = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);
        for (var y = 0; y < source.Height; y++)
        {
            for (var x = 0; x < source.Width; x++)
            {
                var pixel = source.GetPixel(x, y);
                var luma = (pixel.R * 3 + pixel.G * 6 + pixel.B) / 10;
                if (luma < 40)
                {
                    result.SetPixel(x, y, Color.Transparent);
                    continue;
                }

                result.SetPixel(x, y, Color.FromArgb(255, pixel.R, pixel.G, pixel.B));
            }
        }

        return result;
    }
}
