namespace Yesgatc.DscEngine.Models;

public sealed class DscSettings
{
    public string Pkcs11Library { get; init; } = string.Empty;
    public string StampReason { get; init; } = "Digitally signed";
    public string StampLocation { get; init; } = "Kerala";
    public float StampWidth { get; init; } = 168;
    public float StampHeight { get; init; } = 38;
    public float StampMarginRight { get; init; } = 36;
    public float StampMarginBottom { get; init; } = 36;
    public string StampPlacement { get; init; } = "Officer";
}
