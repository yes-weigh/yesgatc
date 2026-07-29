namespace Yesgatc.CertificateWorker.Models;

public static class VerificationStatuses
{
    public const string Draft = "draft";
    public const string Submitted = "submitted";
    public const string Approved = "approved";
    public const string Certified = "certified";
    public const string Rejected = "rejected";

    public static readonly string[] All = [Draft, Submitted, Approved, Certified, Rejected];

    public static string Normalize(string? status) =>
        All.FirstOrDefault(value => string.Equals(value, status?.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? Draft;

    public static string Label(string? status) => Normalize(status) switch
    {
        Submitted => "Submitted",
        Approved => "Approved",
        Certified => "Certified",
        Rejected => "Rejected",
        _ => "Draft",
    };
}
