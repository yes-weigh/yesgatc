using System.IO;

namespace Yesgatc.CertificateWorker.Services;

public static class WorkerDataPaths
{
    public static string RootDirectory
    {
        get
        {
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "YesGATC",
                "CertificateWorker");
            Directory.CreateDirectory(path);
            return path;
        }
    }

    public static string StampingImagesDirectory
    {
        get
        {
            var path = Path.Combine(RootDirectory, "stamping-images");
            Directory.CreateDirectory(path);
            return path;
        }
    }

    public static string CertificatePdfDirectory(string jobId)
    {
        var path = Path.Combine(RootDirectory, "certificate-pdfs", jobId);
        Directory.CreateDirectory(path);
        return path;
    }

    public static string? FindLatestStampedPdf(string jobId)
    {
        var directory = CertificatePdfDirectory(jobId);
        if (!Directory.Exists(directory))
        {
            return null;
        }

        return Directory.EnumerateFiles(directory, "*_stamped.pdf", SearchOption.TopDirectoryOnly)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }
}
