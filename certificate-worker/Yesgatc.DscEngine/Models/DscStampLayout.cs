using iText.Kernel.Geom;

namespace Yesgatc.DscEngine.Models;

public sealed class DscStampLayout
{
    public string Placement { get; init; } = "Officer";
    public float Width { get; init; } = 168;
    public float Height { get; init; } = 38;
    public float Margin { get; init; } = 36;
    public float CustomX { get; init; }
    public float CustomY { get; init; }

    public Rectangle ToRect(Rectangle page)
    {
        var width = Math.Clamp(Width, 80, page.GetWidth() - 8);
        var height = Math.Clamp(Height, 28, page.GetHeight() - 8);
        var margin = Math.Max(8, Margin);
        var rect = Placement switch
        {
            "BottomLeft" => new Rectangle(page.GetLeft() + margin, page.GetBottom() + margin, width, height),
            "BottomCenter" => new Rectangle(
                page.GetLeft() + (page.GetWidth() - width) / 2f,
                page.GetBottom() + margin,
                width,
                height),
            "TopRight" => new Rectangle(
                page.GetRight() - margin - width,
                page.GetTop() - margin - height,
                width,
                height),
            "Custom" => new Rectangle(CustomX, CustomY, width, height),
            _ => new Rectangle(page.GetRight() - margin - width, page.GetBottom() + margin, width, height),
        };

        var x = Math.Clamp(rect.GetX(), page.GetLeft(), page.GetRight() - width);
        var y = Math.Clamp(rect.GetY(), page.GetBottom(), page.GetTop() - height);
        return new Rectangle(x, y, width, height);
    }
}
