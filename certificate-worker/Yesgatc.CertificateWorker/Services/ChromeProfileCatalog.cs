using System.IO;
using System.Text.Json;

namespace Yesgatc.CertificateWorker.Services;

public sealed record ChromeProfileInfo(string DirectoryName, string DisplayName)
{
    public string Label =>
        string.IsNullOrWhiteSpace(DisplayName) || DisplayName.Equals(DirectoryName, StringComparison.Ordinal)
            ? DirectoryName
            : $"{DisplayName}  ·  {DirectoryName}";

    public override string ToString() => Label;
}

/// <summary>Lists Chrome profiles under the local User Data directory.</summary>
public static class ChromeProfileCatalog
{
    public static IReadOnlyList<ChromeProfileInfo> ListProfiles()
    {
        var userData = AutomationService.ResolveSystemChromeUserDataDir();
        if (!Directory.Exists(userData))
        {
            return [];
        }

        var byDir = new Dictionary<string, ChromeProfileInfo>(StringComparer.OrdinalIgnoreCase);
        var localStatePath = Path.Combine(userData, "Local State");
        if (File.Exists(localStatePath))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(localStatePath));
                if (doc.RootElement.TryGetProperty("profile", out var profile)
                    && profile.TryGetProperty("info_cache", out var cache)
                    && cache.ValueKind == JsonValueKind.Object)
                {
                    foreach (var entry in cache.EnumerateObject())
                    {
                        var dirName = entry.Name;
                        var profilePath = Path.Combine(userData, dirName);
                        if (!Directory.Exists(profilePath))
                        {
                            continue;
                        }

                        byDir[dirName] = new ChromeProfileInfo(dirName, BuildDisplayName(entry.Value, dirName));
                    }
                }
            }
            catch
            {
                // Fall through to folder scan.
            }
        }

        foreach (var dir in Directory.EnumerateDirectories(userData))
        {
            var name = Path.GetFileName(dir);
            if (!IsProfileFolderName(name) || byDir.ContainsKey(name))
            {
                continue;
            }

            byDir[name] = new ChromeProfileInfo(name, name);
        }

        return byDir.Values
            .OrderBy(p => p.DirectoryName.Equals("Default", StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenBy(p => p.DirectoryName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool IsProfileFolderName(string name) =>
        name.Equals("Default", StringComparison.OrdinalIgnoreCase)
        || name.StartsWith("Profile ", StringComparison.OrdinalIgnoreCase);

    private static string BuildDisplayName(JsonElement info, string directoryName)
    {
        var name = GetString(info, "name");
        var email = GetString(info, "user_name");
        if (string.IsNullOrWhiteSpace(email))
        {
            email = GetString(info, "gaia_name");
        }

        if (!string.IsNullOrWhiteSpace(name) && !string.IsNullOrWhiteSpace(email))
        {
            return $"{name} ({email})";
        }

        if (!string.IsNullOrWhiteSpace(email))
        {
            return email;
        }

        if (!string.IsNullOrWhiteSpace(name))
        {
            return name;
        }

        return directoryName;
    }

    private static string? GetString(JsonElement info, string property)
    {
        if (!info.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var text = value.GetString();
        return string.IsNullOrWhiteSpace(text) ? null : text.Trim();
    }
}

/// <summary>Runtime + persisted Chrome profile directory for system-profile launches.</summary>
public static class ChromeProfilePreference
{
    /// <summary>Selected profile folder name, e.g. Default or Profile 1. Null/empty = not chosen yet.</summary>
    public static string? RuntimeDirectory { get; set; }

    public static bool HasSelection => !string.IsNullOrWhiteSpace(RuntimeDirectory);

    public static string ResolveDirectory(string? settingsFallback)
    {
        if (!string.IsNullOrWhiteSpace(RuntimeDirectory))
        {
            return RuntimeDirectory.Trim();
        }

        if (!string.IsNullOrWhiteSpace(settingsFallback))
        {
            return settingsFallback.Trim();
        }

        return "Default";
    }

    public static void Clear() => RuntimeDirectory = null;
}
