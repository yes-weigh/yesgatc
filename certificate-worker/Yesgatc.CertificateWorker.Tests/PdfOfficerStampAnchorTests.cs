using System.Drawing;
using System.Drawing.Imaging;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class PdfOfficerStampAnchorTests
{
    [Fact]
    public void FromLabel_places_box_above_officer_line_like_dsc()
    {
        var rect = PdfOfficerStampAnchor.FromLabel(
            labelLeft: 320,
            labelBottom: 40,
            labelRight: 500,
            labelTop: 52,
            pageLeft: 0,
            pageBottom: 0,
            pageRight: 595,
            pageTop: 842);

        Assert.Equal(320, rect.X, 1);
        Assert.Equal(57, rect.Y, 1);
        Assert.Equal(168, rect.Width, 1);
        Assert.Equal(38, rect.Height, 1);
    }
}

public sealed class SignatureImagePrepTests
{
    [Fact]
    public void KnockOutWhite_makes_white_transparent_keeps_ink()
    {
        using var bitmap = new Bitmap(8, 8, PixelFormat.Format32bppArgb);
        using (var gfx = Graphics.FromImage(bitmap))
        {
            gfx.Clear(Color.White);
        }

        bitmap.SetPixel(3, 3, Color.FromArgb(255, 20, 40, 160));
        using var raw = new MemoryStream();
        bitmap.Save(raw, ImageFormat.Png);

        var png = SignatureImagePrep.KnockOutWhite(raw.ToArray());
        using var result = new Bitmap(new MemoryStream(png));
        Assert.True(result.Width <= 8);
        Assert.True(result.Height <= 8);

        var foundInk = false;
        for (var y = 0; y < result.Height; y++)
        {
            for (var x = 0; x < result.Width; x++)
            {
                var pixel = result.GetPixel(x, y);
                if (pixel.A > 200 && pixel.B > 100)
                {
                    foundInk = true;
                }

                if (pixel.A == 255 && pixel.R > 240 && pixel.G > 240 && pixel.B > 240)
                {
                    Assert.Fail("White background was not removed.");
                }
            }
        }

        Assert.True(foundInk);
    }
}

public sealed class PdfImageStampServiceTests
{
    [Fact]
    public void Stamp_draws_png_on_last_page()
    {
        using var document = new PdfDocument();
        var page = document.AddPage();
        page.Width = XUnit.FromPoint(595);
        page.Height = XUnit.FromPoint(842);
        using var pdfStream = new MemoryStream();
        document.Save(pdfStream, closeStream: false);
        var unsigned = pdfStream.ToArray();

        using var bitmap = new Bitmap(40, 20, PixelFormat.Format32bppArgb);
        using (var gfx = Graphics.FromImage(bitmap))
        {
            gfx.Clear(Color.Transparent);
            gfx.FillRectangle(Brushes.Navy, 2, 2, 36, 16);
        }

        using var pngStream = new MemoryStream();
        bitmap.Save(pngStream, ImageFormat.Png);
        var stamped = PdfImageStampService.Stamp(unsigned, pngStream.ToArray());
        Assert.True(stamped.Length > unsigned.Length);
    }
}

public sealed class PdfImageStampPathTests
{
    [Fact]
    public void IsSafeSignedStoragePath_only_signed_certificate_folder()
    {
        Assert.True(PdfImageStampService.IsSafeSignedStoragePath(
            "siteCalibrations/abc/signed-certificate/1.pdf", "abc"));
        Assert.False(PdfImageStampService.IsSafeSignedStoragePath(
            "siteCalibrations/abc/certificate-pdf/1.pdf", "abc"));
        Assert.False(PdfImageStampService.IsSafeSignedStoragePath(
            "siteCalibrations/other/signed-certificate/1.pdf", "abc"));
    }

    [Fact]
    public void UniquePath_adds_suffix_when_file_exists()
    {
        var directory = Path.Combine(Path.GetTempPath(), "yesgatc-stamp-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var first = Path.Combine(directory, "cert_signed.pdf");
            File.WriteAllText(first, "a");
            var second = PdfImageStampService.UniquePath(first);
            Assert.Equal(Path.Combine(directory, "cert_signed-2.pdf"), second);
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }
}
