using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class CertificationQueueFilterTests
{
    [Fact]
    public void Apply_skips_superseded_and_voided()
    {
        var records = new[]
        {
            Make("a1", "rc1", "SN1", "approved", supersededBy: "new"),
            Make("a2", "rc1", "SN2", "approved", voidedAt: "2026-01-01T00:00:00Z"),
            Make("s1", "rc1", "SN3", "submitted"),
        };

        var filtered = CertificationQueueFilter.Apply(records);

        Assert.Single(filtered);
        Assert.Equal("s1", filtered[0].Id);
    }

    [Fact]
    public void Apply_skips_approved_when_same_serial_has_submitted_resubmit()
    {
        var records = new[]
        {
            Make("old", "rc1", "SN100", "approved"),
            Make("new", "rc1", "SN100", "submitted", resubmittedFrom: "old"),
        };

        var filtered = CertificationQueueFilter.Apply(records);

        Assert.Single(filtered);
        Assert.Equal("new", filtered[0].Id);
    }

    [Fact]
    public void Apply_keeps_submitted_resubmit_and_drops_superseded_approved()
    {
        var records = new[]
        {
            Make("old", "rc1", "SN200", "approved", supersededBy: "new"),
            Make("new", "rc1", "SN200", "submitted", resubmittedFrom: "old"),
        };

        var filtered = CertificationQueueFilter.Apply(records);

        Assert.Single(filtered);
        Assert.Equal("new", filtered[0].Id);
    }

    private static SiteCalibrationRecord Make(
        string id,
        string rcId,
        string serial,
        string status,
        string? supersededBy = null,
        string? voidedAt = null,
        string? resubmittedFrom = null,
        string? pdfUrl = null) =>
        new()
        {
            Id = id,
            RcId = rcId,
            SerialNumber = serial,
            Status = status,
            SupersededByResubmissionId = supersededBy,
            CertificateVoidedAt = voidedAt,
            ResubmittedFromId = resubmittedFrom,
            CertificatePdfUrl = pdfUrl,
        };
}
