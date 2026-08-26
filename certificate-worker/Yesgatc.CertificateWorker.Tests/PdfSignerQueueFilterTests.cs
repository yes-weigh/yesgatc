using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class PdfSignerQueueFilterTests
{
    private static readonly HashSet<string> SignerRcs = new(StringComparer.Ordinal) { "knr", "ktm" };

    [Fact]
    public void Apply_keeps_unsigned_certified_after_2304_for_pdf_signer_rcs()
    {
        var records = new[]
        {
            Make("legacy", "knr", "2304"),
            Make("ok", "knr", "2305"),
            Make("other-rc", "iwp", "3707"),
            Make("signed", "ktm", "3708", signed: true),
            Make("voided", "knr", "3709", voidedAt: "2026-08-24T00:00:00Z"),
        };

        var filtered = PdfSignerQueueFilter.Apply(records, SignerRcs);

        Assert.Single(filtered);
        Assert.Equal("ok", filtered[0].Id);
    }

    [Fact]
    public void Apply_empty_when_no_pdf_signer_rcs()
    {
        var records = new[] { Make("ok", "knr", "3707") };

        var filtered = PdfSignerQueueFilter.Apply(records, new HashSet<string>(StringComparer.Ordinal));

        Assert.Empty(filtered);
    }

    [Fact]
    public void Apply_orders_by_sequence()
    {
        var records = new[]
        {
            Make("b", "knr", "2524"),
            Make("a", "ktm", "2310"),
        };

        var filtered = PdfSignerQueueFilter.Apply(records, SignerRcs);

        Assert.Equal(new[] { "a", "b" }, filtered.Select(r => r.Id).ToArray());
    }

    [Fact]
    public void Apply_scopes_to_rc_id()
    {
        var records = new[]
        {
            Make("a", "knr", "2310"),
            Make("b", "ktm", "2311"),
        };

        var filtered = PdfSignerQueueFilter.Apply(records, SignerRcs, "ktm");

        Assert.Single(filtered);
        Assert.Equal("b", filtered[0].Id);
    }

    private static SiteCalibrationRecord Make(
        string id,
        string rcId,
        string seq,
        bool signed = false,
        string? voidedAt = null) =>
        new()
        {
            Id = id,
            RcId = rcId,
            Status = "certified",
            SerialNumber = "SN" + id,
            CertificateNumber = $"IND/GATC/KL/26/04/26/{seq}",
            SignedCertificatePdfUrl = signed ? "https://example/signed.pdf" : null,
            CertificateVoidedAt = voidedAt,
        };
}
