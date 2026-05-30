namespace Yesgatc.CertificateWorker.Models;

public sealed class PartyContactDetails
{
    public string BelongToName { get; init; } = string.Empty;
    public string Address { get; init; } = string.Empty;
    public string Pincode { get; init; } = string.Empty;
    public string State { get; init; } = string.Empty;
    public string District { get; init; } = string.Empty;
    public string Mobile { get; init; } = string.Empty;
    public bool IsSelfVerification { get; init; }
}
