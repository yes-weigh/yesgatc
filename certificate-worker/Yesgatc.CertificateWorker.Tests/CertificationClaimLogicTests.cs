using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class CertificationClaimLogicTests
{
    [Fact]
    public void Empty_claim_is_free()
    {
        Assert.False(CertificationClaimLogic.IsHeldByOther(
            null,
            null,
            "self",
            DateTimeOffset.UtcNow,
            TimeSpan.FromMinutes(12)));
    }

    [Fact]
    public void Own_claim_is_not_held_by_other()
    {
        Assert.False(CertificationClaimLogic.IsHeldByOther(
            "self",
            DateTimeOffset.UtcNow,
            "self",
            DateTimeOffset.UtcNow,
            TimeSpan.FromMinutes(12)));
    }

    [Fact]
    public void Live_foreign_claim_blocks()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.True(CertificationClaimLogic.IsHeldByOther(
            "other",
            now.AddMinutes(-2),
            "self",
            now,
            TimeSpan.FromMinutes(12)));
    }

    [Fact]
    public void Expired_foreign_claim_is_free()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.False(CertificationClaimLogic.IsHeldByOther(
            "other",
            now.AddMinutes(-13),
            "self",
            now,
            TimeSpan.FromMinutes(12)));
    }
}
