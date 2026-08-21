namespace Yesgatc.CertificateWorker.Services;

internal static class CertificationClaimLogic
{
    public static bool IsHeldByOther(
        string? ownerWorkerId,
        DateTimeOffset? claimedAt,
        string selfWorkerId,
        DateTimeOffset now,
        TimeSpan ttl)
    {
        if (string.IsNullOrWhiteSpace(ownerWorkerId))
        {
            return false;
        }

        if (string.Equals(ownerWorkerId, selfWorkerId, StringComparison.Ordinal))
        {
            return false;
        }

        if (claimedAt is null)
        {
            return true;
        }

        return now - claimedAt.Value < ttl;
    }
}
