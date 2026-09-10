using Yesgatc.CertificateWorker.Models;
using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class EmaapSignerTypeParserTests
{
    [Fact]
    public void Parse_labeled_pdf_signer()
    {
        const string text = "Signing Method : PDF Signer\nName: LINESH T R";
        Assert.Equal(RcCertificationMethods.PdfSigner, EmaapSignerTypeParser.TryParse(text));
    }

    [Fact]
    public void Parse_labeled_manual_upload()
    {
        const string text = "Certificate Signing: Manual Upload";
        Assert.Equal(RcCertificationMethods.ManualUpload, EmaapSignerTypeParser.TryParse(text));
    }

    [Fact]
    public void Parse_bare_pdf_signer_token()
    {
        Assert.Equal(
            RcCertificationMethods.PdfSigner,
            EmaapSignerTypeParser.TryParse("Welcome PDF Signer dashboard"));
    }

    [Fact]
    public void Parse_ignores_upload_signed_pdf_button_copy()
    {
        Assert.Null(EmaapSignerTypeParser.TryParse("Download  Upload Signed PDF"));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("manual_upload", true)]
    [InlineData("pdf_signer", false)]
    [InlineData("auto_dsc", false)]
    public void Promote_manual_or_unset_only(string? current, bool promote)
    {
        Assert.Equal(promote, RcCertificationMethods.ShouldPromoteToPdfSigner(current));
    }

    [Fact]
    public void Effective_pdf_signer_from_emaap_cache_unless_auto_dsc()
    {
        Assert.True(RcCertificationMethods.IsEffectivePdfSigner("manual_upload", "pdf_signer"));
        Assert.False(RcCertificationMethods.IsEffectivePdfSigner("auto_dsc", "pdf_signer"));
        Assert.True(RcCertificationMethods.IsEffectivePdfSigner("pdf_signer", null));
    }
}

public sealed class EmaapIssuedSignButtonsTests
{
    [Theory]
    [InlineData("Upload Signed PDF", true)]
    [InlineData("Sign and Upload", true)]
    [InlineData("Sign & Upload", true)]
    [InlineData("Sign PDF", true)]
    [InlineData("Download", false)]
    [InlineData("Sign Out", false)]
    public void Matches_sign_or_upload_labels(string label, bool expected)
    {
        Assert.Equal(expected, EmaapIssuedSignButtons.IsSignOrUploadLabel(label));
    }
}
