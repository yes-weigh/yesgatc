using Yesgatc.CertificateWorker.Services;
using Xunit;

namespace Yesgatc.CertificateWorker.Tests;

public sealed class EmaapCertificateResumeTests
{
    [Fact]
    public void Mismatched_pdf_number_is_not_resumed()
    {
        var message =
            "eMAAP PDF IND/GATC/KL/26/04/26/4707 does not contain serial G0628.";

        Assert.Null(FirestoreService.TryExtractEmaapCertificateNumber(message));
    }

    [Fact]
    public void Issued_certificate_number_is_still_extracted()
    {
        var message = "PDF synced IND/GATC/KL/26/04/26/4780";

        Assert.Equal(
            "IND/GATC/KL/26/04/26/4780",
            FirestoreService.TryExtractEmaapCertificateNumber(message));
    }
}
