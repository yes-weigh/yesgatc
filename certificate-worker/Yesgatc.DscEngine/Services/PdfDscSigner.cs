using System.Security.Cryptography.X509Certificates;
using iText.Bouncycastleconnector;
using iText.Commons.Bouncycastle.Cert;
using iText.Forms.Form.Element;
using iText.IO.Image;
using iText.Kernel.Pdf;
using iText.Layout.Borders;
using iText.Layout.Element;
using iText.Layout.Properties;
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

    public byte[] SignVisible(
        byte[] unsignedPdf,
        DscTokenSession token,
        DscCertificateRecord record,
        DscStampLayout? layout = null)
    {
        if (token.SigningCertificate is null)
        {
            throw new InvalidOperationException("Unlock the DSC token PIN first.");
        }

        layout ??= new DscStampLayout
        {
            Width = _settings.StampWidth,
            Height = _settings.StampHeight,
            Margin = Math.Max(_settings.StampMarginRight, _settings.StampMarginBottom),
        };

        using var input = new MemoryStream(unsignedPdf, writable: false);
        using var output = new MemoryStream();
        using var reader = new PdfReader(input);
        var signer = new PdfSigner(reader, output, new StampingProperties().UseAppendMode());
        using var peek = new PdfDocument(new PdfReader(new MemoryStream(unsignedPdf, writable: false)));
        var page = peek.GetNumberOfPages();
        var box = peek.GetPage(page).GetPageSizeWithRotation();
        peek.Close();

        var rect = layout.Placement == "Officer"
            ? OfficerStampAnchor.Find(unsignedPdf, layout) ?? layout.ToRect(box)
            : layout.ToRect(box);
        var signerName = token.SigningCertificate.SubjectCn;
        signer.SetFieldName("YesGATC-DSC");
        signer.SetPageRect(rect);
        signer.SetPageNumber(page);
        signer.SetReason(_settings.StampReason);
        signer.SetLocation(_settings.StampLocation);
        var appearance = new SignatureFieldAppearance("YesGATC-DSC");
        appearance.SetContent(BuildTightStamp(signerName, AdobeLogoImage.TryLoad(), rect.GetHeight()));
        signer.SetSignatureAppearance(appearance);

        var chain = ToItextChain(token.BuildChain());
        var signature = new ProxKeyExternalSignature(token);
        signer.SignDetached(signature, chain, null, null, null, 0, PdfSigner.CryptoStandard.CMS);
        return output.ToArray();
    }

    private Div BuildTightStamp(string signerName, ImageData? logo, float stampHeight)
    {
        var when = DateTime.Now.ToString("yyyy.MM.dd HH:mm:ss zzz");
        var lines = new Div()
            .SetMargin(0)
            .SetPadding(0);
        foreach (var line in new[]
                 {
                     $"Digitally signed by {signerName}",
                     $"Date: {when}",
                     $"Reason: {_settings.StampReason}",
                     $"Location: {_settings.StampLocation}",
                 })
        {
            lines.Add(new Paragraph(line)
                .SetFontSize(5.5f)
                .SetMargin(0)
                .SetMultipliedLeading(1.05f));
        }

        if (logo is null)
        {
            return lines;
        }

        var table = new Table(UnitValue.CreatePercentArray([16f, 84f]))
            .UseAllAvailableWidth()
            .SetBorder(Border.NO_BORDER)
            .SetMargin(0)
            .SetPadding(0);
        table.AddCell(new Cell()
            .SetBorder(Border.NO_BORDER)
            .SetPadding(0)
            .SetVerticalAlignment(VerticalAlignment.MIDDLE)
            .Add(new Image(logo)
                .SetAutoScale(true)
                .SetMaxHeight(Math.Max(16, stampHeight - 2))));
        table.AddCell(new Cell()
            .SetBorder(Border.NO_BORDER)
            .SetPaddingLeft(2)
            .SetPaddingTop(0)
            .SetPaddingBottom(0)
            .SetPaddingRight(0)
            .SetVerticalAlignment(VerticalAlignment.MIDDLE)
            .Add(lines));

        return new Div().SetMargin(0).SetPadding(0).Add(table);
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
