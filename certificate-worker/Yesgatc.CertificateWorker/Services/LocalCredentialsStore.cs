using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class LocalCredentialsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public string FilePath { get; }

    public LocalCredentialsStore()
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "YesGATC",
            "CertificateWorker");
        Directory.CreateDirectory(directory);
        FilePath = Path.Combine(directory, "credentials.local.json");
    }

    public StoredCredentials Load()
    {
        if (!File.Exists(FilePath))
        {
            return new StoredCredentials();
        }

        try
        {
            var json = File.ReadAllText(FilePath);
            var stored = JsonSerializer.Deserialize<StoredCredentials>(json, JsonOptions) ?? new StoredCredentials();
            stored.MigrateLegacyRcCredentials(json);
            return stored;
        }
        catch
        {
            return new StoredCredentials();
        }
    }

    public void Save(StoredCredentials credentials)
    {
        var json = JsonSerializer.Serialize(credentials, JsonOptions);
        File.WriteAllText(FilePath, json);
    }

    public void SaveAll(string aadhar, string password, string docaEmail, string docaPassword, string captchaApiKey = "")
    {
        Save(new StoredCredentials
        {
            SuperAdmin = new CredentialSettings { Aadhar = aadhar.Trim(), Password = password },
            Doca = new DocaCredentialSettings { Email = docaEmail.Trim(), Password = docaPassword },
            CaptchaApiKey = captchaApiKey.Trim(),
        });
    }
}

public sealed class StoredCredentials
{
    public CredentialSettings SuperAdmin { get; set; } = new();
    public DocaCredentialSettings Doca { get; set; } = new();
    public string CaptchaApiKey { get; set; } = string.Empty;

    [JsonPropertyName("rc")]
    public CredentialSettings? LegacyRc { get; set; }

    public void MigrateLegacyRcCredentials(string rawJson)
    {
        if (!string.IsNullOrWhiteSpace(SuperAdmin.Aadhar))
        {
            return;
        }

        if (LegacyRc is not null && !string.IsNullOrWhiteSpace(LegacyRc.Aadhar))
        {
            SuperAdmin = LegacyRc;
            return;
        }

        if (rawJson.Contains("\"rc\"", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                using var doc = JsonDocument.Parse(rawJson);
                if (doc.RootElement.TryGetProperty("rc", out var rcNode))
                {
                    SuperAdmin = JsonSerializer.Deserialize<CredentialSettings>(rcNode.GetRawText(), new JsonSerializerOptions
                    {
                        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    }) ?? new CredentialSettings();
                }
            }
            catch
            {
                // Ignore malformed legacy file.
            }
        }
    }
}
