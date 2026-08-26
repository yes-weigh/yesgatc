using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class UnsignedCertificatePdfCleanupTests
{
    [Fact]
    public void ResolveStoragePath_uses_certificate_pdf_folder()
    {
        var job = Make(path: "siteCalibrations/abc/certificate-pdf/1.pdf");

        Assert.Equal("siteCalibrations/abc/certificate-pdf/1.pdf", UnsignedCertificatePdfCleanup.ResolveStoragePath(job));
    }

    [Fact]
    public void ResolveStoragePath_parses_firebase_url()
    {
        var job = Make(
            path: null,
            url: "https://firebasestorage.googleapis.com/v0/b/yesgatc.firebasestorage.app/o/siteCalibrations%2Fabc%2Fcertificate-pdf%2F1.pdf?alt=media&token=x");

        Assert.Equal("siteCalibrations/abc/certificate-pdf/1.pdf", UnsignedCertificatePdfCleanup.ResolveStoragePath(job));
    }

    [Fact]
    public void ResolveStoragePath_rejects_signed_folder()
    {
        var job = Make(path: "siteCalibrations/abc/signed-certificate/1.pdf");

        Assert.Null(UnsignedCertificatePdfCleanup.ResolveStoragePath(job));
    }

    [Fact]
    public void ResolveStoragePath_rejects_signed_path_collision()
    {
        var path = "siteCalibrations/abc/certificate-pdf/1.pdf";
        var job = Make(path: path, signedPath: path);

        Assert.Null(UnsignedCertificatePdfCleanup.ResolveStoragePath(job));
    }

    private static SiteCalibrationRecord Make(
        string? path,
        string? url = null,
        string? signedPath = null) =>
        new()
        {
            Id = "abc",
            CertificatePdfPath = path,
            CertificatePdfUrl = url,
            SignedCertificatePdfPath = signedPath,
        };
}
