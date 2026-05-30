using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class FirebaseAuthService
{
    private readonly HttpClient _http = new();
    private readonly FirebaseSettings _settings;

    public FirebaseAuthService(FirebaseSettings settings)
    {
        _settings = settings;
    }

    public async Task<FirebaseSignInResult> SignInAsSuperAdminAsync(
        string aadhar,
        string password,
        CancellationToken cancellationToken = default)
    {
        var session = await SignInWithAadharAsync(aadhar, password, cancellationToken);
        var documents = new FirestoreDocumentClient(_settings);
        var fields = await documents.GetFieldsAsync("users", session.UserId, session.IdToken, cancellationToken);
        var role = FirestoreFieldReader.ReadString(fields, "role");

        if (!string.Equals(role, "super_admin", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "This account is not a Super Admin. Use the Super Admin Aadhar and password from the web app.");
        }

        var displayName = FirstNonEmpty(
            FirestoreFieldReader.ReadString(fields, "username"),
            session.Email);

        return session with { DisplayName = displayName, Role = role };
    }

    public async Task<FirebaseSignInResult> SignInWithAadharAsync(string aadhar, string password, CancellationToken cancellationToken = default)
    {
        var normalizedAadhar = new string(aadhar.Where(char.IsDigit).ToArray());
        if (normalizedAadhar.Length != 12)
        {
            throw new InvalidOperationException("Aadhar must be 12 digits.");
        }

        if (string.IsNullOrWhiteSpace(password))
        {
            throw new InvalidOperationException("Password is required.");
        }

        var email = $"{normalizedAadhar}@{_settings.AuthEmailDomain}";
        var url =
            $"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={Uri.EscapeDataString(_settings.ApiKey)}";

        using var response = await _http.PostAsJsonAsync(
            url,
            new SignInRequest(email, password, true),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(ParseAuthError(body));
        }

        var payload = await response.Content.ReadFromJsonAsync<SignInResponse>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Empty sign-in response from Firebase.");

        if (string.IsNullOrWhiteSpace(payload.IdToken) || string.IsNullOrWhiteSpace(payload.LocalId))
        {
            throw new InvalidOperationException("Firebase sign-in did not return a session token.");
        }

        return new FirebaseSignInResult(payload.LocalId, payload.IdToken, payload.Email ?? email);
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }

    private static string ParseAuthError(string body)
    {
        if (body.Contains("INVALID_LOGIN_CREDENTIALS", StringComparison.OrdinalIgnoreCase)
            || body.Contains("INVALID_PASSWORD", StringComparison.OrdinalIgnoreCase)
            || body.Contains("EMAIL_NOT_FOUND", StringComparison.OrdinalIgnoreCase))
        {
            return "Invalid Super Admin Aadhar or password.";
        }

        return "Firebase sign-in failed. Check your credentials and network connection.";
    }

    private sealed record SignInRequest(
        [property: JsonPropertyName("email")] string Email,
        [property: JsonPropertyName("password")] string Password,
        [property: JsonPropertyName("returnSecureToken")] bool ReturnSecureToken);

    private sealed record SignInResponse(
        [property: JsonPropertyName("idToken")] string IdToken,
        [property: JsonPropertyName("localId")] string LocalId,
        [property: JsonPropertyName("email")] string? Email);
}

public sealed record FirebaseSignInResult(
    string UserId,
    string IdToken,
    string Email,
    string DisplayName = "",
    string Role = "");
