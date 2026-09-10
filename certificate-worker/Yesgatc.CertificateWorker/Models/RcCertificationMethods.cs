namespace Yesgatc.CertificateWorker.Models;

internal static class RcCertificationMethods
{
    public const string PdfSigner = "pdf_signer";
    public const string ManualUpload = "manual_upload";
    public const string AutoDsc = "auto_dsc";

    public static bool IsPdfSigner(string? value) =>
        string.Equals(value, PdfSigner, StringComparison.OrdinalIgnoreCase);

    public static bool IsManualUpload(string? value) =>
        string.Equals(value, ManualUpload, StringComparison.OrdinalIgnoreCase);

    public static bool IsAutoDsc(string? value) =>
        string.Equals(value, AutoDsc, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// eMAAP profile said PDF signer. Promote leftover manual / unset — never overwrite Auto DSC.
    /// </summary>
    public static bool ShouldPromoteToPdfSigner(string? currentMethod) =>
        !IsPdfSigner(currentMethod) && !IsAutoDsc(currentMethod);

    public static bool IsEffectivePdfSigner(string? certificationMethod, string? emaapSignerType) =>
        IsPdfSigner(certificationMethod) || (IsPdfSigner(emaapSignerType) && !IsAutoDsc(certificationMethod));
}
