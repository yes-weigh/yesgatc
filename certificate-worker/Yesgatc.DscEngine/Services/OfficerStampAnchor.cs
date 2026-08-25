using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;
using iText.Kernel.Pdf.Canvas.Parser.Listener;
using iText.Kernel.Geom;
using Yesgatc.DscEngine.Models;

namespace Yesgatc.DscEngine.Services;

internal static class OfficerStampAnchor
{
    private static readonly string[] Patterns =
    [
        @"Signature\s+of\s+the\s+verifying\s+officer",
        @"Signature\s+of\s+the\s+verifying",
        @"verifying\s+officer",
    ];

    public static Rectangle? Find(byte[] pdf, DscStampLayout layout)
    {
        using var reader = new PdfReader(new MemoryStream(pdf, writable: false));
        using var document = new PdfDocument(reader);
        var pageNumber = document.GetNumberOfPages();
        var page = document.GetPage(pageNumber);
        var pageBox = page.GetPageSizeWithRotation();
        var label = FindLabel(page, pageNumber, pageBox);
        if (label is null)
        {
            return null;
        }

        var height = Math.Clamp(layout.Height, 28, 56);
        var maxWidth = pageBox.GetRight() - label.GetLeft() - 6;
        var width = Math.Clamp(Math.Min(layout.Width, maxWidth), 110, pageBox.GetWidth() / 2f);
        var x = label.GetLeft();
        if (x + width > pageBox.GetRight() - 4)
        {
            x = pageBox.GetRight() - 4 - width;
        }

        var gap = 5f;
        var y = label.GetTop() + gap;
        x = Math.Clamp(x, pageBox.GetLeft() + 8, pageBox.GetRight() - width - 4);
        y = Math.Clamp(y, pageBox.GetBottom() + 8, pageBox.GetTop() - height - 8);
        return new Rectangle(x, y, width, height);
    }

    private static Rectangle? FindLabel(PdfPage page, int pageNumber, Rectangle pageBox)
    {
        var hits = new List<Rectangle>();
        foreach (var pattern in Patterns)
        {
            var strategy = new RegexBasedLocationExtractionStrategy(pattern);
            new PdfCanvasProcessor(strategy).ProcessPageContent(page);
            foreach (var location in strategy.GetResultantLocations())
            {
                if (location.GetPageNumber() != 0 && location.GetPageNumber() != pageNumber)
                {
                    continue;
                }

                var rect = location.GetRectangle();
                if (rect is not null && rect.GetWidth() > 2 && rect.GetHeight() > 2)
                {
                    hits.Add(rect);
                }
            }

            if (hits.Count > 0)
            {
                break;
            }
        }

        if (hits.Count == 0)
        {
            return null;
        }

        var rightHalf = hits.Where(hit => hit.GetX() > pageBox.GetWidth() * 0.4f).ToList();
        var block = rightHalf.Count > 0 ? rightHalf : hits;
        var left = block.Min(hit => hit.GetLeft());
        var bottom = block.Min(hit => hit.GetBottom());
        var right = block.Max(hit => hit.GetRight());
        var top = block.Max(hit => hit.GetTop());
        return new Rectangle(left, bottom, Math.Max(8, right - left), Math.Max(8, top - bottom));
    }
}
