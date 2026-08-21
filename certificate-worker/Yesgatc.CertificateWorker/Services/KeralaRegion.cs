namespace Yesgatc.CertificateWorker.Services;

/// <summary>GATC / eMAAP filing is Kerala-only (PIN circles 67, 68, 69).</summary>
public static class KeralaRegion
{
    public const string StateName = "Kerala";

    public static bool IsKeralaPincode(string? pincode)
    {
        var digits = PincodeLookupService.NormalizePincode(pincode ?? string.Empty);
        return digits.Length == 6 && digits[0] == '6' && digits[1] is '7' or '8' or '9';
    }

    public static bool IsKeralaState(string? state) =>
        string.Equals(state?.Trim(), StateName, StringComparison.OrdinalIgnoreCase);
}
