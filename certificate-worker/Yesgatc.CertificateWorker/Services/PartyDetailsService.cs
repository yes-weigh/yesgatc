using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public sealed class PartyDetailsService
{
    private readonly FirestoreDocumentClient _documents;
    private readonly PincodeLookupService _pincodeLookup = new();

    public PartyDetailsService(FirebaseSettings settings)
    {
        _documents = new FirestoreDocumentClient(settings);
    }

    public async Task<PartyContactDetails> ResolveForJobAsync(
        SiteCalibrationRecord job,
        string rcUserId,
        string idToken,
        CancellationToken cancellationToken = default)
    {
        var calibrationFields = await _documents.GetFieldsAsync(
            "siteCalibrations", job.Id, idToken, cancellationToken);
        var customerId = FirestoreFieldReader.ReadString(calibrationFields, "customerId");
        var rcId = FirestoreFieldReader.ReadString(calibrationFields, "rcId");
        var verificationSubject = FirestoreFieldReader.ReadString(calibrationFields, "verificationSubject");
        var performedBy = FirestoreFieldReader.ReadString(calibrationFields, "performedBy");
        var vctId = FirestoreFieldReader.ReadString(calibrationFields, "vctId");
        var customerName = FirestoreFieldReader.ReadString(calibrationFields, "customerName", job.CustomerName);
        var fileCertificateAsRc = FirestoreFieldReader.ReadBool(calibrationFields, "fileCertificateAsRc");

        var isSelf = verificationSubject == "self"
            || (!string.IsNullOrWhiteSpace(customerId) && customerId == rcId);

        var mobile = await ResolvePerformerMobileAsync(
            performedBy, vctId, rcId, rcUserId, idToken, cancellationToken);

        PartyProfile profile;
        var filedUnderRc = false;

        if (isSelf)
        {
            profile = await LoadRcProfileAsync(rcUserId, customerName, idToken, cancellationToken);
        }
        else
        {
            profile = await LoadCustomerProfileAsync(customerId, customerName, idToken, cancellationToken);
            var customerPin = PincodeLookupService.NormalizePincode(profile.Pincode);
            var pinOutsideKerala = PincodeLookupService.IsValidPincode(customerPin)
                && !KeralaRegion.IsKeralaPincode(customerPin);
            if (fileCertificateAsRc || pinOutsideKerala)
            {
                var originalCustomerId = customerId;
                var originalCustomerName = profile.Name;
                profile = await LoadRcProfileAsync(rcUserId, customerName, idToken, cancellationToken);
                filedUnderRc = true;
                await TryStampRcFilingAsync(
                    job.Id,
                    rcUserId,
                    profile.Name,
                    originalCustomerId,
                    originalCustomerName,
                    idToken,
                    cancellationToken);
            }
        }

        var pincode = PincodeLookupService.NormalizePincode(profile.Pincode);
        if (!PincodeLookupService.IsValidPincode(pincode))
        {
            throw new InvalidOperationException(
                "A valid 6-digit postal code is required on the customer (or RC profile for self verification).");
        }

        if (string.IsNullOrWhiteSpace(profile.Name))
        {
            throw new InvalidOperationException("Customer / RC name is missing.");
        }

        if (string.IsNullOrWhiteSpace(profile.Address))
        {
            throw new InvalidOperationException("Address is missing on the customer / RC profile.");
        }

        var lookup = await _pincodeLookup.LookupAsync(pincode, cancellationToken);
        var state = FirstNonEmpty(profile.State, lookup?.State ?? string.Empty);
        var district = DocaDistrictAliases.NormalizeForDoca(
            FirstNonEmpty(profile.District, lookup?.District ?? string.Empty));

        if (isSelf || filedUnderRc || KeralaRegion.IsKeralaPincode(pincode))
        {
            if (!KeralaRegion.IsKeralaState(state))
            {
                state = KeralaRegion.StateName;
            }
        }

        if (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(district))
        {
            throw new InvalidOperationException(
                $"Could not resolve state/district for pincode {pincode}. Check the pincode in the app.");
        }

        return new PartyContactDetails
        {
            BelongToName = profile.Name.Trim(),
            Address = profile.Address.Trim(),
            Pincode = pincode,
            State = state.Trim(),
            District = district.Trim(),
            Mobile = mobile,
            IsSelfVerification = isSelf,
            FiledUnderRc = filedUnderRc,
        };
    }

    private async Task<PartyProfile> LoadRcProfileAsync(
        string rcUserId,
        string customerNameFallback,
        string idToken,
        CancellationToken cancellationToken)
    {
        var rcFields = await _documents.GetFieldsAsync("users", rcUserId, idToken, cancellationToken);
        return new PartyProfile(
            FirstNonEmpty(
                FirestoreFieldReader.ReadString(rcFields, "companyName"),
                FirestoreFieldReader.ReadString(rcFields, "username"),
                customerNameFallback),
            FirestoreFieldReader.ReadString(rcFields, "address"),
            FirestoreFieldReader.ReadString(rcFields, "pincode"),
            string.Empty,
            string.Empty);
    }

    private async Task<PartyProfile> LoadCustomerProfileAsync(
        string customerId,
        string customerNameFallback,
        string idToken,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(customerId))
        {
            throw new InvalidOperationException("Verification is missing customerId.");
        }

        var customerFields = await _documents.GetFieldsAsync("customers", customerId, idToken, cancellationToken);
        return new PartyProfile(
            FirstNonEmpty(
                FirestoreFieldReader.ReadString(customerFields, "name"),
                customerNameFallback),
            FirestoreFieldReader.ReadString(customerFields, "address"),
            FirestoreFieldReader.ReadString(customerFields, "pincode"),
            FirestoreFieldReader.ReadString(customerFields, "state"),
            FirestoreFieldReader.ReadString(customerFields, "district"));
    }

    private async Task TryStampRcFilingAsync(
        string jobId,
        string rcUserId,
        string rcCompanyName,
        string originalCustomerId,
        string originalCustomerName,
        string idToken,
        CancellationToken cancellationToken)
    {
        try
        {
            var fields = new Dictionary<string, object?>
            {
                ["fileCertificateAsRc"] = true,
                ["verificationSubject"] = "self",
                ["customerId"] = rcUserId,
                ["customerName"] = rcCompanyName.Trim(),
            };
            if (!string.IsNullOrWhiteSpace(originalCustomerId) && originalCustomerId != rcUserId)
            {
                fields["sourceCustomerId"] = originalCustomerId.Trim();
            }
            if (!string.IsNullOrWhiteSpace(originalCustomerName)
                && !string.Equals(originalCustomerName.Trim(), rcCompanyName.Trim(), StringComparison.Ordinal))
            {
                fields["sourceCustomerName"] = originalCustomerName.Trim();
            }

            await _documents.PatchFieldsAsync(
                "siteCalibrations",
                jobId,
                fields,
                idToken,
                cancellationToken);
        }
        catch (Exception)
        {
            // Best-effort. eMAAP still files under RC for this run.
        }
    }

    private async Task<string> ResolvePerformerMobileAsync(
        string performedBy,
        string vctId,
        string rcId,
        string rcUserId,
        string idToken,
        CancellationToken cancellationToken)
    {
        var useVctPhone = performedBy == "vct"
            || (!string.IsNullOrWhiteSpace(vctId) && performedBy != "rc");

        string performerUserId;
        string performerLabel;

        if (useVctPhone && !string.IsNullOrWhiteSpace(vctId))
        {
            performerUserId = vctId;
            performerLabel = "VCT";
        }
        else
        {
            performerUserId = FirstNonEmpty(rcId, rcUserId);
            performerLabel = "RC";
        }

        if (string.IsNullOrWhiteSpace(performerUserId))
        {
            throw new InvalidOperationException("Verification is missing rcId for performer contact lookup.");
        }

        var performerFields = await _documents.GetFieldsAsync(
            "users", performerUserId, idToken, cancellationToken);
        var mobile = NormalizeMobile(FirestoreFieldReader.ReadString(performerFields, "phone"));
        if (string.IsNullOrWhiteSpace(mobile))
        {
            throw new InvalidOperationException(
                $"{performerLabel} mobile number is missing or invalid (10 digits required on the performer profile).");
        }

        return mobile;
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

    private static string NormalizeMobile(string phone)
    {
        var digits = new string(phone.Where(char.IsDigit).Take(10).ToArray());
        return digits.Length == 10 ? digits : string.Empty;
    }

    private sealed record PartyProfile(
        string Name,
        string Address,
        string Pincode,
        string State,
        string District);
}
