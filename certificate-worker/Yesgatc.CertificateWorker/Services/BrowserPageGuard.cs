namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Temporarily allows about:blank tabs (e.g. while DeepSeek OCR opens a new page)
/// so AutomationService does not close them before navigation.
/// </summary>
public static class BrowserPageGuard
{
    private static int _allowBlank;

    public static bool AllowsTransientBlankPages => Volatile.Read(ref _allowBlank) > 0;

    public static IDisposable AllowTransientBlankPages()
    {
        Interlocked.Increment(ref _allowBlank);
        return new Releaser();
    }

    private sealed class Releaser : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                Interlocked.Decrement(ref _allowBlank);
            }
        }
    }
}
