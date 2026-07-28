using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// Polls Firestore <c>emaapOtpInbox</c> for codes written by the emaapOtpWebhook Cloud Function.
/// Only claims OTPs received at/after this Send OTP (tight window) — never older codes.
/// </summary>
public static class FirestoreEmaapOtpReader
{
    public const string Collection = "emaapOtpInbox";

    /// <summary>Ignore Firebase OTPs until mail + Apps Script have time to land.</summary>
    private const int MinSecondsAfterSend = 20;

    /// <summary>Clock skew only — do NOT accept previous Send OTP codes.</summary>
    private const int EarliestSkewSeconds = 10;

    private static readonly Regex SixDigit = new(@"^\d{6}$", RegexOptions.Compiled);

    public static string? LastFailureReason { get; set; }

    private sealed record ClaimResult(string? Code, int TotalOpen, int StaleOpen);

    /// <summary>One Firestore poll — claim newest OTP for this Send OTP only.</summary>
    public static async Task<string?> TryClaimOnceAsync(
        FirebaseSettings firebase,
        Func<CancellationToken, Task<string>> resolveIdToken,
        DateTimeOffset requestedAtUtc,
        CancellationToken cancellationToken = default)
    {
        if (DateTimeOffset.UtcNow < requestedAtUtc.AddSeconds(MinSecondsAfterSend))
        {
            return null;
        }

        var idToken = await resolveIdToken(cancellationToken);
        var earliest = requestedAtUtc.AddSeconds(-EarliestSkewSeconds);
        var result = await TryClaimNewestAsync(firebase, idToken, earliest, cancellationToken);
        return result.Code;
    }

    public static async Task<string?> WaitForOtpAsync(
        FirebaseSettings firebase,
        Func<CancellationToken, Task<string>> resolveIdToken,
        DateTimeOffset requestedAtUtc,
        CancellationToken cancellationToken = default,
        int timeoutSeconds = 180,
        int pollIntervalMs = 2500)
    {
        LastFailureReason = null;
        var deadline = DateTimeOffset.UtcNow.AddSeconds(Math.Clamp(timeoutSeconds, 15, 360));
        var earliest = requestedAtUtc.AddSeconds(-EarliestSkewSeconds);
        Exception? lastError = null;
        var lastStaleOpen = 0;
        var lastTotalOpen = 0;

        // Wait for email + Apps Script before claiming (avoids grabbing prior OTP).
        var readyAt = requestedAtUtc.AddSeconds(MinSecondsAfterSend);
        var initialWait = readyAt - DateTimeOffset.UtcNow;
        if (initialWait > TimeSpan.Zero)
        {
            var waitMs = (int)Math.Min(initialWait.TotalMilliseconds, (deadline - DateTimeOffset.UtcNow).TotalMilliseconds);
            if (waitMs > 0)
            {
                await Task.Delay(waitMs, cancellationToken);
            }
        }

        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var idToken = await resolveIdToken(cancellationToken);
                var result = await TryClaimNewestAsync(firebase, idToken, earliest, cancellationToken);
                lastTotalOpen = result.TotalOpen;
                lastStaleOpen = result.StaleOpen;
                if (!string.IsNullOrWhiteSpace(result.Code))
                {
                    return result.Code;
                }
            }
            catch when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                lastError = ex;
            }

            await Task.Delay(pollIntervalMs, cancellationToken);
        }

        if (lastError is not null)
        {
            LastFailureReason = $"Firebase OTP poll failed: {lastError.Message}";
        }
        else if (lastStaleOpen > 0)
        {
            LastFailureReason =
                $"Firebase has {lastStaleOpen} old OTP(s) from before this Send OTP — ignored. Wait for Apps Script to relay the NEW mail.";
        }
        else if (lastTotalOpen > 0)
        {
            LastFailureReason =
                $"Firebase inbox has open OTP(s) but none after this Send OTP — check receivedAt.";
        }
        else
        {
            LastFailureReason =
                "No OTP in Firebase emaapOtpInbox yet — run Apps Script relayEmaapOtps (or wait for 1-min trigger).";
        }

        return null;
    }

    private static async Task<ClaimResult> TryClaimNewestAsync(
        FirebaseSettings firebase,
        string idToken,
        DateTimeOffset earliestUtc,
        CancellationToken cancellationToken)
    {
        var totalOpen = 0;
        var staleOpen = 0;
        var client = new FirestoreDocumentClient(firebase);
        var rows = await client.ListCollectionAsync(Collection, idToken, cancellationToken);

        var openFresh = new List<(string Id, string Code, DateTimeOffset Received)>();
        var openStaleIds = new List<string>();

        foreach (var (id, fields) in rows)
        {
            if (FirestoreDocumentClient.ReadBool(fields, "consumed"))
            {
                continue;
            }

            var code = FirestoreDocumentClient.ReadString(fields, "code")?.Trim();
            if (string.IsNullOrWhiteSpace(code) || !SixDigit.IsMatch(code))
            {
                continue;
            }

            totalOpen++;
            var received = ReadTimestamp(fields, "receivedAt");
            if (received is null || received.Value < earliestUtc)
            {
                staleOpen++;
                openStaleIds.Add(id);
                continue;
            }

            openFresh.Add((id, code, received.Value));
        }

        // Retire stale open docs so they never confuse later polls.
        foreach (var staleId in openStaleIds)
        {
            try
            {
                await client.PatchFieldsAsync(
                    Collection,
                    staleId,
                    new Dictionary<string, object?>
                    {
                        ["consumed"] = true,
                        ["consumedAt"] = DateTimeOffset.UtcNow.ToString("O"),
                    },
                    idToken,
                    cancellationToken);
            }
            catch
            {
                // Best-effort cleanup.
            }
        }

        if (openFresh.Count == 0)
        {
            return new ClaimResult(null, totalOpen, staleOpen);
        }

        var best = openFresh.OrderByDescending(x => x.Received).First();

        // Claim winner; also retire other fresh-but-older codes from earlier resends in-window.
        foreach (var row in openFresh)
        {
            var isWinner = row.Id == best.Id;
            try
            {
                await client.PatchFieldsAsync(
                    Collection,
                    row.Id,
                    new Dictionary<string, object?>
                    {
                        ["consumed"] = true,
                        ["consumedAt"] = DateTimeOffset.UtcNow.ToString("O"),
                    },
                    idToken,
                    cancellationToken);
            }
            catch
            {
                if (isWinner)
                {
                    throw;
                }
            }
        }

        return new ClaimResult(best.Code, totalOpen, staleOpen);
    }

    private static DateTimeOffset? ReadTimestamp(Dictionary<string, JsonElement> fields, string key)
    {
        if (!fields.TryGetValue(key, out var element))
        {
            return null;
        }

        if (element.TryGetProperty("timestampValue", out var ts) && ts.GetString() is { } isoTs
            && DateTimeOffset.TryParse(isoTs, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsedTs))
        {
            return parsedTs.ToUniversalTime();
        }

        if (element.TryGetProperty("stringValue", out var sv) && sv.GetString() is { } iso
            && DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed))
        {
            return parsed.ToUniversalTime();
        }

        return null;
    }
}
