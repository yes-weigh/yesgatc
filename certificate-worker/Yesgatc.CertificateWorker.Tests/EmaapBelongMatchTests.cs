using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class EmaapBelongMatchTests
{
    [Fact]
    public void Matches_sony_vs_sory_typo()
    {
        Assert.True(EmaapBelongMatch.Matches(
            "Sony tv thudiyan h. Kodakara",
            "Sory tv thudiyan h Kodakara"));
    }

    [Fact]
    public void Matches_gk_with_and_without_periods()
    {
        Assert.True(EmaapBelongMatch.Matches("G.K ELECTRONICS", "GK ELECTRONICS"));
    }

    [Fact]
    public void Rejects_unrelated_party()
    {
        Assert.False(EmaapBelongMatch.Matches(
            "Sony tv thudiyan h. Kodakara",
            "Meezan electronic scales pvt ltd"));
    }
}
