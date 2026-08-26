namespace Yesgatc.CertificateWorker.Services;

internal readonly record struct PdfStampRect(float X, float Y, float Width, float Height);

/// <summary>
/// Same placement as DSC Engine: box above “Signature of the verifying officer” on the last page.
/// </summary>
internal static class PdfOfficerStampAnchor
{
    public const float DefaultWidth = 168;
    public const float DefaultHeight = 38;
    /// <summary>Nudge the officer image right of the DSC box so the name sits over the label.</summary>
    public const float ImageOffsetX = 28;

    private static readonly string[] Patterns =
    [
        @"signature\s+of\s+the\s+verifying\s+officer",
        @"signature\s+of\s+the\s+verifying",
        @"verifying\s+officer",
    ];

    public static PdfStampRect FromLabel(
        float labelLeft,
        float labelBottom,
        float labelRight,
        float labelTop,
        float pageLeft,
        float pageBottom,
        float pageRight,
        float pageTop,
        float stampWidth = DefaultWidth,
        float stampHeight = DefaultHeight)
    {
        var pageWidth = pageRight - pageLeft;
        var height = Math.Clamp(stampHeight, 28, 56);
        var maxWidth = pageRight - labelLeft - 6;
        var width = Math.Clamp(Math.Min(stampWidth, maxWidth), 110, pageWidth / 2f);
        var x = labelLeft;
        if (x + width > pageRight - 4)
        {
            x = pageRight - 4 - width;
        }

        const float gap = 5f;
        var y = labelTop + gap;
        x = Math.Clamp(x, pageLeft + 8, pageRight - width - 4);
        y = Math.Clamp(y, pageBottom + 8, pageTop - height - 8);
        _ = labelBottom;
        _ = labelRight;
        return new PdfStampRect(x, y, width, height);
    }

    public static PdfStampRect FallbackBottomRight(
        float pageLeft,
        float pageBottom,
        float pageRight,
        float pageTop,
        float stampWidth = DefaultWidth,
        float stampHeight = DefaultHeight)
    {
        const float margin = 36;
        var width = Math.Clamp(stampWidth, 80, pageRight - pageLeft - 8);
        var height = Math.Clamp(stampHeight, 28, pageTop - pageBottom - 8);
        var x = pageRight - margin - width;
        var y = pageBottom + margin;
        x = Math.Clamp(x, pageLeft, pageRight - width);
        y = Math.Clamp(y, pageBottom, pageTop - height);
        return new PdfStampRect(x, y, width, height);
    }

    public static PdfStampRect? Find(byte[] pdf)
    {
        using var document = UglyToad.PdfPig.PdfDocument.Open(pdf);
        var page = document.GetPage(document.NumberOfPages);
        var pageLeft = 0f;
        var pageBottom = 0f;
        var pageRight = (float)page.Width;
        var pageTop = (float)page.Height;
        var label = FindLabel(page, pageRight);
        if (label is null)
        {
            return null;
        }

        return FromLabel(
            label.Value.Left,
            label.Value.Bottom,
            label.Value.Right,
            label.Value.Top,
            pageLeft,
            pageBottom,
            pageRight,
            pageTop);
    }

    private static (float Left, float Bottom, float Right, float Top)? FindLabel(
        UglyToad.PdfPig.Content.Page page,
        float pageWidth)
    {
        var words = page.GetWords().ToList();
        if (words.Count == 0)
        {
            return null;
        }

        List<(float Left, float Bottom, float Right, float Top)> hits = [];
        foreach (var pattern in Patterns)
        {
            hits = MatchWindows(words, pattern);
            if (hits.Count > 0)
            {
                break;
            }
        }

        if (hits.Count == 0)
        {
            return null;
        }

        var rightHalf = hits.Where(hit => hit.Left > pageWidth * 0.4f).ToList();
        var block = rightHalf.Count > 0 ? rightHalf : hits;
        return (
            block.Min(hit => hit.Left),
            block.Min(hit => hit.Bottom),
            block.Max(hit => hit.Right),
            block.Max(hit => hit.Top));
    }

    private static List<(float Left, float Bottom, float Right, float Top)> MatchWindows(
        IReadOnlyList<UglyToad.PdfPig.Content.Word> words,
        string pattern)
    {
        var regex = new System.Text.RegularExpressions.Regex(
            pattern,
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        var hits = new List<(float Left, float Bottom, float Right, float Top)>();
        for (var start = 0; start < words.Count; start++)
        {
            for (var len = 2; len <= 8 && start + len <= words.Count; len++)
            {
                var slice = words.Skip(start).Take(len).ToList();
                var text = string.Join(" ", slice.Select(word => word.Text));
                if (!regex.IsMatch(text))
                {
                    continue;
                }

                hits.Add((
                    (float)slice.Min(word => word.BoundingBox.Left),
                    (float)slice.Min(word => word.BoundingBox.Bottom),
                    (float)slice.Max(word => word.BoundingBox.Right),
                    (float)slice.Max(word => word.BoundingBox.Top)));
            }
        }

        return hits;
    }
}
