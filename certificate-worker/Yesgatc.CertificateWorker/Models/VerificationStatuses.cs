namespace Yesgatc.CertificateWorker.Models;

public static class VerificationStatuses
{
    public const string Draft = "draft";
    public const string Submitted = "submitted";
    public const string Approved = "approved";
    public const string Certified = "certified";

    public static readonly string[] All = [Draft, Submitted, Approved, Certified];

    public static string Normalize(string? status) =>
        All.FirstOrDefault(value => string.Equals(value, status?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? Draft;

    public static string Label(string? status) => Normalize(status) switch
    {
        Submitted => "Submitted",
        Approved => "Approved",
        Certified => "Certified",
        _ => "Draft",
    };
}
