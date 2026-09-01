using System.Security.Cryptography;
using System.Text;

namespace Yesgatc.DscEngine.Services;

internal static class DscPinProtect
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("YesGATC-DscEngine-pin");

    public static string Protect(string pin)
    {
        var bytes = ProtectedData.Protect(
            Encoding.UTF8.GetBytes(pin),
            Entropy,
            DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(bytes);
    }

    public static string? Unprotect(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored))
        {
            return null;
        }

        try
        {
            var bytes = ProtectedData.Unprotect(
                Convert.FromBase64String(stored),
                Entropy,
                DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch
        {
            return null;
        }
    }
}
