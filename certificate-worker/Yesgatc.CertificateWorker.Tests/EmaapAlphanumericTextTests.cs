using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class EmaapAlphanumericTextTests
{
    [Fact]
    public void Sanitize_replaces_ampersand_in_jayasundaran_address()
    {
        var cleaned = EmaapAlphanumericText.Sanitize(
            "OUSHAADI AGENCY & SAI RAM POOJA STORES NANDIKKARA",
            EmaapAlphanumericText.AddressMaxLength);

        Assert.Equal("OUSHAADI AGENCY AND SAI RAM POOJA STORES NANDIKKARA", cleaned);
        Assert.True(EmaapAlphanumericText.IsAccepted(cleaned));
    }

    [Fact]
    public void Sanitize_strips_other_punctuation()
    {
        var cleaned = EmaapAlphanumericText.Sanitize("TC 26/640 (3), OOTTUKUZHY-ROAD.");
        Assert.Equal("TC 26 640 3 OOTTUKUZHY ROAD", cleaned);
    }

    [Fact]
    public void Sanitize_decodes_html_ampersand()
    {
        Assert.Equal("A AND B STORES", EmaapAlphanumericText.Sanitize("A &amp; B STORES"));
    }

    [Fact]
    public void Sanitize_truncates_belongs_to()
    {
        var longName = new string('A', 80);
        var cleaned = EmaapAlphanumericText.Sanitize(longName, EmaapAlphanumericText.BelongToMaxLength);
        Assert.Equal(50, cleaned.Length);
    }

    [Fact]
    public void Sanitize_empty_stays_empty()
    {
        Assert.Equal(string.Empty, EmaapAlphanumericText.Sanitize("   "));
        Assert.False(EmaapAlphanumericText.IsAccepted(""));
        Assert.False(EmaapAlphanumericText.IsAccepted("A & B"));
    }

    [Fact]
    public void Require_throws_when_only_punctuation()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => EmaapAlphanumericText.Require("@@@ ///", 50, "Address"));
        Assert.Contains("Address", ex.Message, StringComparison.Ordinal);
    }
}
