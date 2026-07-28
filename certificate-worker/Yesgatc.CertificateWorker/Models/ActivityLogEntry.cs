using System.Windows.Media.Imaging;

namespace Yesgatc.CertificateWorker.Models;

public sealed class ActivityLogEntry
{
    public required string Text { get; init; }
    public BitmapImage? CaptchaImage { get; init; }
    public BitmapImage? CaptchaAiImage { get; init; }
    public string? CaptchaResolvedText { get; init; }
    public bool HasCaptchaPreview => CaptchaImage is not null || CaptchaAiImage is not null;

    public override string ToString() => Text;
}
