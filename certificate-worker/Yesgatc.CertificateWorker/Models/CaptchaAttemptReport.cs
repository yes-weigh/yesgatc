namespace Yesgatc.CertificateWorker.Models;

public sealed record CaptchaAttemptReport(
    byte[] ImageBytes,
    string ResolvedText,
    string OcrProvider,
    int AttemptNumber,
    bool Success,
    string Outcome);
