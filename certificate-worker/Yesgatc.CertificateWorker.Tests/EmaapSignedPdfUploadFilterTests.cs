using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class EmaapSignedPdfUploadFilterTests
{
    [Fact]
    public void Apply_keeps_certified_signed_after_2304()
    {
        var records = new[]
        {
            Make("old", "2304", signed: true),
            Make("ok", "3707", signed: true),
            Make("unsigned", "3708", signed: false),
            Make("done", "3709", signed: true, uploadedAt: "2026-08-25T00:00:00Z"),
            Make("voided", "3710", signed: true, voidedAt: "2026-08-24T00:00:00Z"),
        };

        var filtered = EmaapSignedPdfUploadFilter.Apply(records);

        Assert.Single(filtered);
        Assert.Equal("ok", filtered[0].Id);
    }

    [Fact]
    public void Apply_orders_by_sequence()
    {
        var records = new[]
        {
            Make("b", "2524", signed: true),
            Make("a", "2310", signed: true),
        };

        var filtered = EmaapSignedPdfUploadFilter.Apply(records);

        Assert.Equal(new[] { "a", "b" }, filtered.Select(r => r.Id).ToArray());
    }

    private static SiteCalibrationRecord Make(
        string id,
        string seq,
        bool signed,
        string? uploadedAt = null,
        string? voidedAt = null) =>
        new()
        {
            Id = id,
            RcId = "rc1",
            Status = "certified",
            SerialNumber = "SN" + id,
            CertificateNumber = $"IND/GATC/KL/26/04/26/{seq}",
            SignedCertificatePdfUrl = signed ? "https://example/signed.pdf" : null,
            EmaapSignedPdfUploadedAt = uploadedAt,
            CertificateVoidedAt = voidedAt,
        };
}
