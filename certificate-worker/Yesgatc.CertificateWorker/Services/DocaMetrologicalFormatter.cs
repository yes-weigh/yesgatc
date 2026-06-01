namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Formats metrological values the way DOCA certificates expect (e.g. 30kg, 100g, 5g).
/// </summary>
public static class DocaMetrologicalFormatter
{
    public static string FormatMaximumCapacity(double value) =>
        $"{FirestoreFieldReader.FormatNumber(value)}kg";

    public static string FormatGrams(double value) =>
        $"{FirestoreFieldReader.FormatNumber(value)}g";
}
