using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class KeralaRegionTests
{
    [Theory]
    [InlineData("695001", true)]
    [InlineData("682001", true)]
    [InlineData("673001", true)]
    [InlineData("560001", false)]
    [InlineData("600001", false)]
    [InlineData("400001", false)]
    [InlineData("69500", false)]
    [InlineData("", false)]
    public void IsKeralaPincode_matches_67_68_69_circles(string pincode, bool expected)
    {
        Assert.Equal(expected, KeralaRegion.IsKeralaPincode(pincode));
    }

    [Theory]
    [InlineData("Kerala", true)]
    [InlineData("kerala", true)]
    [InlineData("Tamil Nadu", false)]
    [InlineData("", false)]
    public void IsKeralaState_matches_name(string state, bool expected)
    {
        Assert.Equal(expected, KeralaRegion.IsKeralaState(state));
    }
}
