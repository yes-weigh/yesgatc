using System.Security.Cryptography.X509Certificates;
using iText.Bouncycastleconnector;
using iText.Commons.Bouncycastle.Cert;
using iText.Forms.Form.Element;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Signatures;
using Yesgatc.DscEngine.Models;

namespace Yesgatc.DscEngine.Services;

public sealed class PdfDscSigner
{
    private readonly DscSettings _settings;

    public PdfDscSigner(DscSettings settings)
    {
        _settings = settings;
    }

    public byte[] SignVisible(byte[] unsignedPdf, DscTokenSession token, DscCertificateRecord record)
    {
        if (token.SigningCertificate is null)
        {
            throw new InvalidOperationException("Unlock the PROXKey PIN first.");
        }

        using var input = new MemoryStream(unsignedPdf, writable: false);
        using var output = new MemoryStream();
        using var reader = new PdfReader(input);
        var signer = new PdfSigner(reader, output, new StampingProperties().UseAppendMode());
        using var peek = new PdfDocument(new PdfReader(new MemoryStream(unsignedPdf, writable: false)));
        var page = peek.GetNumberOfPages();
        var box = peek.GetPage(page).GetPageSizeWithRotation();
        peek.Close();

        var width = _settings.StampWidth;
        var height = _settings.StampHeight;
        var rect = new Rectangle(
            box.GetRight() - _settings.StampMarginRight - width,
            box.GetBottom() + _settings.StampMarginBottom,
            width,
            height);

        signer.SetFieldName("YesGATC-DSC");
        signer.SetPageRect(rect);
        signer.SetPageNumber(page);
        signer.SetReason(_settings.StampReason);
        signer.SetLocation(_settings.StampLocation);
        var appearance = new SignatureFieldAppearance("YesGATC-DSC");
        appearance.SetContent(BuildStampText(token, record));
        signer.SetSignatureAppearance(appearance);

        var chain = ToItextChain(token.BuildChain());
        var signature = new ProxKeyExternalSignature(token);
        signer.SignDetached(signature, chain, null, null, null, 0, PdfSigner.CryptoStandard.CMS);
        return output.ToArray();
    }

    private string BuildStampText(DscTokenSession token, DscCertificateRecord record)
    {
        var signer = token.SigningCertificate!.SubjectCn;
        var when = DateTime.Now.ToString("dd MMM yyyy HH:mm");
        var cert = string.IsNullOrWhiteSpace(record.CertificateNumber)
            ? record.SerialNumber
            : record.CertificateNumber;
        return
            $"Digitally signed by {signer}{Environment.NewLine}" +
            $"Date: {when}{Environment.NewLine}" +
            $"{_settings.StampReason}{Environment.NewLine}" +
            cert;
    }

    private static IX509Certificate[] ToItextChain(IReadOnlyList<X509Certificate2> chain)
    {
        var factory = BouncyCastleFactoryCreator.GetFactory();
        return chain
            .Select(cert => factory.CreateX509Certificate(cert.RawData))
            .ToArray();
    }

    private sealed class ProxKeyExternalSignature : IExternalSignature
    {
        private readonly DscTokenSession _token;

        public ProxKeyExternalSignature(DscTokenSession token)
        {
            _token = token;
        }

        public string GetDigestAlgorithmName() => DigestAlgorithms.SHA256;

        public string GetSignatureAlgorithmName() => "RSA";

        public ISignatureMechanismParams? GetSignatureMechanismParameters() => null;

        public byte[] Sign(byte[] message) => _token.Sign(message);
    }
}
