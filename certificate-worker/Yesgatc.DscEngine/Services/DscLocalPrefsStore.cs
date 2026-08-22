using System.Text.Json;

namespace Yesgatc.DscEngine.Services;

public sealed class DscLocalPrefs
{
    public string StampPlacement { get; set; } = "Officer";
    public float CustomX { get; set; } = 360;
    public float CustomY { get; set; } = 36;
}

public sealed class DscLocalPrefsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public string FilePath { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "YesGATC",
        "DscEngine",
        "dsc-prefs.json");

    public DscLocalPrefs Load()
    {
        try
        {
            if (!File.Exists(FilePath))
            {
                return new DscLocalPrefs();
            }

            return JsonSerializer.Deserialize<DscLocalPrefs>(File.ReadAllText(FilePath), JsonOptions)
                ?? new DscLocalPrefs();
        }
        catch
        {
            return new DscLocalPrefs();
        }
    }

    public void Save(DscLocalPrefs prefs)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(prefs, JsonOptions));
    }
}
