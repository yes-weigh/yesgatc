using System.Security.Cryptography.X509Certificates;
using Net.Pkcs11Interop.Common;
using Net.Pkcs11Interop.HighLevelAPI;

namespace Yesgatc.DscEngine.Services;

public sealed class DscTokenInfo
{
    public required string LibraryPath { get; init; }
    public required string SlotLabel { get; init; }
    public required string Manufacturer { get; init; }
    public required bool TokenPresent { get; init; }
    public required string TokenLabel { get; init; }
}

public sealed class DscSigningCertificate
{
    public required X509Certificate2 Certificate { get; init; }
    public required byte[] Id { get; init; }
    public required string Label { get; init; }

    public string SubjectCn => ReadCn(Certificate.Subject) ?? Certificate.Subject;
    public string IssuerCn => ReadCn(Certificate.Issuer) ?? Certificate.Issuer;

    private static string? ReadCn(string distinguishedName)
    {
        const string prefix = "CN=";
        var parts = distinguishedName.Split(',', StringSplitOptions.TrimEntries);
        var cn = parts.FirstOrDefault(part => part.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        return cn?[prefix.Length..];
    }
}

public sealed class DscTokenSession : IDisposable
{
    private readonly object _gate = new();
    private IPkcs11Library? _library;
    private ISession? _session;
    private IObjectHandle? _privateKey;
    private bool _disposed;

    public DscSigningCertificate? SigningCertificate { get; private set; }
    public string LibraryPath { get; private set; } = string.Empty;
    public bool IsUnlocked => _session is not null && SigningCertificate is not null;

    public static string Probe(string? configuredLibrary = null)
    {
        var lines = new List<string>
        {
            "DSC PKCS#11 probe",
            $"WD PROXKey CSP: {DscPkcs11Locator.ProxKeyCspName}",
            $"WD PROXKey KSP: {DscPkcs11Locator.ProxKeyKspName}",
            "InnalT PKCS#11: InnaITPKCS11Driver.dll",
        };

        foreach (var path in DscPkcs11Locator.CandidateLibraries(configuredLibrary))
        {
            lines.Add($"{(File.Exists(path) ? "OK " : "—  ")}{path}");
        }

        try
        {
            var info = Describe(configuredLibrary);
            lines.Add($"Using: {info.LibraryPath}");
            lines.Add($"Slot: {info.SlotLabel} · {info.Manufacturer}");
            lines.Add(info.TokenPresent
                ? $"Token present: {info.TokenLabel}"
                : "Token not present. Plug in the USB DSC token.");
        }
        catch (Exception ex)
        {
            lines.Add($"PKCS#11: {ex.Message}");
        }

        return string.Join(Environment.NewLine, lines);
    }

    public static DscTokenInfo Describe(string? configuredLibrary = null)
    {
        var load = DscPkcs11Locator.FindLibrary(configuredLibrary)
            ?? throw new InvalidOperationException(
                "No DSC PKCS#11 library. Install InnalT Token Manager or WD PROXKey middleware.");

        var factories = new Pkcs11InteropFactories();
        using var library = factories.Pkcs11LibraryFactory.LoadPkcs11Library(
            factories,
            load.Path,
            load.AppType);
        var slot = FindTokenSlot(library)
            ?? throw new InvalidOperationException("No DSC token slot. Plug in the USB token.");
        var slotInfo = slot.GetSlotInfo();
        var token = slotInfo.SlotFlags.TokenPresent ? TryTokenInfo(slot) : null;
        return new DscTokenInfo
        {
            LibraryPath = load.Path,
            SlotLabel = CleanPkcs11(slotInfo.SlotDescription),
            Manufacturer = CleanPkcs11(slotInfo.ManufacturerId),
            TokenPresent = token is not null,
            TokenLabel = CleanPkcs11(token?.Label),
        };
    }

    public void Unlock(string pin, string? configuredLibrary = null)
    {
        if (string.IsNullOrWhiteSpace(pin))
        {
            throw new InvalidOperationException("Token PIN is required.");
        }

        lock (_gate)
        {
            CloseUnlocked();
            var load = DscPkcs11Locator.FindLibrary(configuredLibrary)
                ?? throw new InvalidOperationException(
                    "No DSC PKCS#11 library. Install InnalT Token Manager or WD PROXKey middleware.");
            LibraryPath = load.Path;
            var factories = new Pkcs11InteropFactories();
            _library = factories.Pkcs11LibraryFactory.LoadPkcs11Library(
                factories,
                load.Path,
                load.AppType);
            var slot = FindTokenSlot(_library)
                ?? throw new InvalidOperationException("No DSC token. Plug in the USB token and retry.");
            _session = OpenSession(slot);
            try
            {
                _session.Login(CKU.CKU_USER, pin);
            }
            catch (Pkcs11Exception ex) when (ex.RV == CKR.CKR_USER_ALREADY_LOGGED_IN)
            {
            }
            catch (Pkcs11Exception ex) when (ex.RV == CKR.CKR_PIN_INCORRECT || ex.RV == CKR.CKR_PIN_INVALID)
            {
                CloseUnlocked();
                throw new InvalidOperationException("Wrong token PIN.");
            }
            catch (Pkcs11Exception ex) when (ex.RV == CKR.CKR_PIN_LOCKED)
            {
                CloseUnlocked();
                throw new InvalidOperationException("Token PIN is locked.");
            }
            catch (Pkcs11Exception ex) when (ex.RV == CKR.CKR_DEVICE_ERROR)
            {
                CloseUnlocked();
                throw DeviceBusy();
            }

            var cert = FindBestSigningCertificate(_session);
            var key = FindPrivateKey(_session, cert.Id)
                ?? throw new InvalidOperationException("Token has a certificate but no matching private key.");
            SigningCertificate = cert;
            _privateKey = key;
        }
    }

    public byte[] Sign(byte[] message)
    {
        ArgumentNullException.ThrowIfNull(message);
        lock (_gate)
        {
            if (_session is null || _privateKey is null)
            {
                throw new InvalidOperationException("Unlock the DSC token PIN first.");
            }

            try
            {
                var mechanism = _session.Factories.MechanismFactory.Create(CKM.CKM_SHA256_RSA_PKCS);
                return _session.Sign(mechanism, _privateKey, message);
            }
            catch (Pkcs11Exception)
            {
                var digestInfo = BuildSha256DigestInfo(System.Security.Cryptography.SHA256.HashData(message));
                var mechanism = _session.Factories.MechanismFactory.Create(CKM.CKM_RSA_PKCS);
                return _session.Sign(mechanism, _privateKey, digestInfo);
            }
        }
    }

    public IReadOnlyList<X509Certificate2> BuildChain()
    {
        var leaf = SigningCertificate?.Certificate
            ?? throw new InvalidOperationException("Unlock the DSC token PIN first.");
        var extras = LoadTokenAuthorities();
        using var chain = new X509Chain();
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.VerificationFlags = X509VerificationFlags.AllowUnknownCertificateAuthority;
        foreach (var extra in extras)
        {
            chain.ChainPolicy.ExtraStore.Add(extra);
        }

        chain.Build(leaf);
        var result = new List<X509Certificate2>();
        foreach (var element in chain.ChainElements)
        {
            result.Add(new X509Certificate2(element.Certificate.RawData));
        }

        if (result.Count == 0)
        {
            result.Add(new X509Certificate2(leaf.RawData));
        }

        foreach (var extra in extras)
        {
            extra.Dispose();
        }

        return result;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        lock (_gate)
        {
            CloseUnlocked();
        }

        _disposed = true;
    }

    private void CloseUnlocked()
    {
        SigningCertificate = null;
        _privateKey = null;
        if (_session is not null)
        {
            try
            {
                _session.Logout();
            }
            catch
            {
            }

            _session.Dispose();
            _session = null;
        }

        _library?.Dispose();
        _library = null;
    }

    private static string CleanPkcs11(string? value) =>
        (value ?? string.Empty).Trim('\0', ' ', '\t', '\r', '\n');

    private static ISession OpenSession(ISlot slot)
    {
        Pkcs11Exception? last = null;
        foreach (var type in new[] { SessionType.ReadWrite, SessionType.ReadOnly })
        {
            for (var attempt = 0; attempt < 2; attempt++)
            {
                try
                {
                    return slot.OpenSession(type);
                }
                catch (Pkcs11Exception ex) when (
                    ex.RV is CKR.CKR_DEVICE_ERROR or CKR.CKR_TOKEN_NOT_PRESENT or CKR.CKR_DEVICE_REMOVED)
                {
                    last = ex;
                    Thread.Sleep(400);
                }
            }
        }

        if (last is { RV: CKR.CKR_DEVICE_ERROR } || last is null)
        {
            throw DeviceBusy();
        }

        throw last;
    }

    private static InvalidOperationException DeviceBusy() =>
        new(
            "DSC token busy (CKR_DEVICE_ERROR). Close InnalT Token Manager, unplug and plug the USB token, then retry.");

    private static ISlot? FindTokenSlot(IPkcs11Library library)
    {
        var slots = library.GetSlotList(SlotsType.WithOrWithoutTokenPresent);
        return slots.FirstOrDefault(slot =>
        {
            try
            {
                return slot.GetSlotInfo().SlotFlags.TokenPresent;
            }
            catch
            {
                return false;
            }
        }) ?? slots.FirstOrDefault();
    }

    private static ITokenInfo? TryTokenInfo(ISlot slot)
    {
        try
        {
            return slot.GetTokenInfo();
        }
        catch
        {
            return null;
        }
    }

    private static DscSigningCertificate FindBestSigningCertificate(ISession session)
    {
        var factories = session.Factories;
        var search = new List<IObjectAttribute>
        {
            factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_CERTIFICATE),
            factories.ObjectAttributeFactory.Create(CKA.CKA_CERTIFICATE_TYPE, CKC.CKC_X_509),
            factories.ObjectAttributeFactory.Create(CKA.CKA_TOKEN, true),
        };

        var handles = session.FindAllObjects(search);
        var certs = new List<DscSigningCertificate>();
        foreach (var handle in handles)
        {
            var attrs = session.GetAttributeValue(handle, [CKA.CKA_VALUE, CKA.CKA_ID, CKA.CKA_LABEL]);
            var raw = attrs[0].GetValueAsByteArray();
            if (raw is null || raw.Length == 0)
            {
                continue;
            }

            var cert = new X509Certificate2(raw);
            if (DateTime.UtcNow < cert.NotBefore.ToUniversalTime()
                || DateTime.UtcNow > cert.NotAfter.ToUniversalTime())
            {
                continue;
            }

            certs.Add(new DscSigningCertificate
            {
                Certificate = cert,
                Id = attrs[1].GetValueAsByteArray() ?? [],
                Label = attrs[2].GetValueAsString() ?? "",
            });
        }

        if (certs.Count == 0)
        {
            throw new InvalidOperationException("No valid X.509 certificate on this token.");
        }

        return certs
            .OrderByDescending(item => HasNonRepudiation(item.Certificate))
            .ThenByDescending(item => HasDigitalSignature(item.Certificate))
            .ThenByDescending(item => item.Certificate.NotAfter)
            .First();
    }

    private static IObjectHandle? FindPrivateKey(ISession session, byte[] id)
    {
        var factories = session.Factories;
        var search = new List<IObjectAttribute>
        {
            factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_PRIVATE_KEY),
            factories.ObjectAttributeFactory.Create(CKA.CKA_SIGN, true),
        };
        if (id.Length > 0)
        {
            search.Add(factories.ObjectAttributeFactory.Create(CKA.CKA_ID, id));
        }

        var matches = session.FindAllObjects(search);
        if (matches.Count > 0)
        {
            return matches[0];
        }

        var fallback = new List<IObjectAttribute>
        {
            factories.ObjectAttributeFactory.Create(CKA.CKA_CLASS, CKO.CKO_PRIVATE_KEY),
        };
        return session.FindAllObjects(fallback).FirstOrDefault();
    }

    private static bool HasNonRepudiation(X509Certificate2 cert) =>
        cert.Extensions.OfType<X509KeyUsageExtension>()
            .Any(ext => ext.KeyUsages.HasFlag(X509KeyUsageFlags.NonRepudiation));

    private static bool HasDigitalSignature(X509Certificate2 cert) =>
        cert.Extensions.OfType<X509KeyUsageExtension>()
            .Any(ext => ext.KeyUsages.HasFlag(X509KeyUsageFlags.DigitalSignature));

    private static List<X509Certificate2> LoadTokenAuthorities()
    {
        var loaded = new List<X509Certificate2>();
        foreach (var directory in DscPkcs11Locator.AuthorityDirectories())
        {
            foreach (var file in Directory.EnumerateFiles(directory, "*.cer"))
            {
                try
                {
                    loaded.Add(new X509Certificate2(file));
                }
                catch
                {
                }
            }
        }

        return loaded;
    }

    private static byte[] BuildSha256DigestInfo(byte[] hash)
    {
        var prefix = Convert.FromHexString("3031300d060960864801650304020105000420");
        var result = new byte[prefix.Length + hash.Length];
        Buffer.BlockCopy(prefix, 0, result, 0, prefix.Length);
        Buffer.BlockCopy(hash, 0, result, prefix.Length, hash.Length);
        return result;
    }
}
