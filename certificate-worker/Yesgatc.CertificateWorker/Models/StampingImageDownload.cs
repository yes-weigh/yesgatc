namespace Yesgatc.CertificateWorker.Models;

public sealed record StampingImageDownload(
    string LocalPath,
    string Directory,
    string FileName,
    long SizeBytes,
    string SourceUrl,
    string JobId,
    string SerialNumber);
