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

        var isSelf = verificationSubject == "self"
            || (!string.IsNullOrWhiteSpace(customerId) && customerId == rcId);

        string name;
        string address;
        string pincode;
        string storedState;
        string storedDistrict;

        if (isSelf)
        {
            var rcFields = await _documents.GetFieldsAsync("users", rcUserId, idToken, cancellationToken);
            name = FirstNonEmpty(
                FirestoreFieldReader.ReadString(rcFields, "companyName"),
                FirestoreFieldReader.ReadString(rcFields, "username"),
                customerName);
            address = FirestoreFieldReader.ReadString(rcFields, "address");
            pincode = FirestoreFieldReader.ReadString(rcFields, "pincode");
            storedState = string.Empty;
            storedDistrict = string.Empty;
        }
        else
        {
            if (string.IsNullOrWhiteSpace(customerId))
            {
                throw new InvalidOperationException("Verification is missing customerId.");
            }

            var customerFields = await _documents.GetFieldsAsync("customers", customerId, idToken, cancellationToken);
            name = FirstNonEmpty(
                FirestoreFieldReader.ReadString(customerFields, "name"),
                customerName);
            address = FirestoreFieldReader.ReadString(customerFields, "address");
            pincode = FirestoreFieldReader.ReadString(customerFields, "pincode");
            storedState = FirestoreFieldReader.ReadString(customerFields, "state");
            storedDistrict = FirestoreFieldReader.ReadString(customerFields, "district");
        }

        // Never submit end-customer phone to DOCA — use the performing VCT or RC contact instead.
        var mobile = await ResolvePerformerMobileAsync(
            performedBy, vctId, rcId, rcUserId, idToken, cancellationToken);

        pincode = PincodeLookupService.NormalizePincode(pincode);
        if (!PincodeLookupService.IsValidPincode(pincode))
        {
            throw new InvalidOperationException(
                "A valid 6-digit postal code is required on the customer (or RC profile for self verification).");
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new InvalidOperationException("Customer / RC name is missing.");
        }

        if (string.IsNullOrWhiteSpace(address))
        {
            throw new InvalidOperationException("Address is missing on the customer / RC profile.");
        }

        var lookup = await _pincodeLookup.LookupAsync(pincode, cancellationToken);
        var state = lookup?.State ?? storedState;
        var district = lookup?.District ?? storedDistrict;

        if (string.IsNullOrWhiteSpace(state) || string.IsNullOrWhiteSpace(district))
        {
            throw new InvalidOperationException(
                $"Could not resolve state/district for pincode {pincode}. Check the pincode in the app.");
        }

        return new PartyContactDetails
        {
            BelongToName = name.Trim(),
            Address = address.Trim(),
            Pincode = pincode,
            State = state.Trim(),
            District = district.Trim(),
            Mobile = mobile,
            IsSelfVerification = isSelf,
        };
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
}
