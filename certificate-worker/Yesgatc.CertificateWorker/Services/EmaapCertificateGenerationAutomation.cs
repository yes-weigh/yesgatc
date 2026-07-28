using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

/// <summary>
/// eMAAP Generate Certificates:
/// Generate Certificates → Certificate Generation → fill frm-gatc by field id (same Firestore resolve as DOCA).
/// After Submit Certificate Details: Instrument Certificate Upload then Generate Certificate + dismiss OK.
/// PDF download / mark certified is handled by AutomationService via Certificates Issued.
/// </summary>
public static class EmaapCertificateGenerationAutomation
{
    public const string GenerateCertificatesUrl = "https://emaap.gov.in/gatc/gatc/generate-certificates";

    public const string InstrumentTypeLabel =
        "Non-Automatic Weighing Instrument of Accuracy Class III 150kg";

    /// <summary>eMAAP option value for Class III 150kg (id=instrument_type).</summary>
    public const string InstrumentTypeValue = "6";

    /// <summary>
    /// eMAAP type_of_instrument: Counter / Platform / Weighbridge / Crane.
    /// Capacity rule: &gt;= 50 kg → Platform Scale, &lt; 50 kg → Counter Scale.
    /// </summary>
    public const string DefaultTypeOfInstrumentLabel = "Counter Scale";

    public const string PrincipalOfficerName = "Harish Ramankutty";

    public static async Task FillStarterFormAsync(
        IPage page,
        PartyContactDetails party,
        InstrumentDetails instrument,
        IReadOnlyList<string>? machinePhotoLocalPaths = null,
        string? standardWeightPhotoLocalPath = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(page);
        ArgumentNullException.ThrowIfNull(party);
        ArgumentNullException.ThrowIfNull(instrument);

        cancellationToken.ThrowIfCancellationRequested();
        await page.BringToFrontAsync();

        await OpenGenerateCertificatesListAsync(page, cancellationToken);
        await ClickCertificateGenerationButtonAsync(page, cancellationToken);
        await WaitForGenerateFormAsync(page, cancellationToken);

        await SelectInstrumentTypeAsync(page, cancellationToken);

        // Basic details (#belongs_to, #mobile, #address, #state_id, #district_id, #pincode)
        await FillByIdAsync(page, "#belongs_to", party.BelongToName);
        await FillByIdAsync(page, "#mobile", party.Mobile);
        await FillByIdAsync(page, "#address", party.Address);
        await SelectByIdLabelAsync(page, "#state_id", party.State, invokeOnchange: true);
        await page.WaitForTimeoutAsync(800);
        await SelectByIdLabelAsync(page, "#district_id", party.District);
        await FillByIdAsync(page, "#pincode", party.Pincode);

        await FillInstrumentDetailsBlockAsync(page, instrument, cancellationToken);
        await FillMetrologicalBlockAsync(page, instrument);
        await FillVerificationChecksBlockAsync(page, instrument);
        await FillEnvironmentalBlockAsync(page, instrument);
        await FillSealingBlockAsync(page, instrument);
        await FillVerificationDecisionBlockAsync(page, instrument);
        await FillChargesBlockAsync(page, instrument, machinePhotoLocalPaths);

        await ClickSubmitCertificateDetailsAsync(page, cancellationToken);
        await FillInstrumentCertificateUploadBlockAsync(
            page,
            instrument,
            standardWeightPhotoLocalPath,
            cancellationToken);
        await ClickGenerateCertificateAsync(page, cancellationToken);

        await page.BringToFrontAsync();
    }

    private static async Task ClickSubmitCertificateDetailsAsync(
        IPage page,
        CancellationToken cancellationToken)
    {
        var btn = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions
        {
            Name = "Submit Certificate Details",
        });
        if (await btn.CountAsync() == 0)
        {
            btn = page.Locator("button")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex(
                        "^\\s*Submit Certificate Details\\s*$",
                        RegexOptions.IgnoreCase),
                });
        }

        if (await btn.CountAsync() == 0)
        {
            throw new InvalidOperationException(
                "Could not find eMAAP 'Submit Certificate Details' button.");
        }

        await btn.First.ScrollIntoViewIfNeededAsync();
        await btn.First.ClickAsync(new LocatorClickOptions { Timeout = 15_000 });
        cancellationToken.ThrowIfCancellationRequested();

        // Allow post-submit navigation / toast to settle.
        try
        {
            await page.WaitForLoadStateAsync(LoadState.NetworkIdle, new PageWaitForLoadStateOptions
            {
                Timeout = 15_000,
            });
        }
        catch (PlaywrightException)
        {
            await page.WaitForTimeoutAsync(1_500);
        }
    }

    /// <summary>
    /// Post-submit Instrument Certificate Upload: br_upload (standard weights), br_remark, name_of_officer.
    /// </summary>
    private static async Task FillInstrumentCertificateUploadBlockAsync(
        IPage page,
        InstrumentDetails instrument,
        string? standardWeightPhotoLocalPath,
        CancellationToken cancellationToken)
    {
        var upload = page.Locator("#br_upload_file, input[name='br_upload']").First;
        await upload.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Attached,
            Timeout = 30_000,
        });
        await upload.ScrollIntoViewIfNeededAsync();
        cancellationToken.ThrowIfCancellationRequested();

        if (string.IsNullOrWhiteSpace(standardWeightPhotoLocalPath)
            || !File.Exists(standardWeightPhotoLocalPath))
        {
            throw new InvalidOperationException(
                "Standard weight image is required for eMAAP Instrument Certificate Upload.");
        }

        await upload.SetInputFilesAsync(standardWeightPhotoLocalPath);

        var remarks = string.IsNullOrWhiteSpace(instrument.Remarks) ? "Nill" : instrument.Remarks.Trim();
        await FillByIdAsync(page, "#br_remark", remarks);
        await FillByIdAsync(page, "#name_of_officer", PrincipalOfficerName);

        // Ensure principal officer field is visible / committed.
        var officer = page.Locator("#name_of_officer").First;
        if (await officer.CountAsync() > 0)
        {
            await officer.ScrollIntoViewIfNeededAsync();
            await officer.FillAsync(PrincipalOfficerName);
            await officer.EvaluateAsync(
                """
                el => {
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }
                """);
        }

        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task ClickGenerateCertificateAsync(
        IPage page,
        CancellationToken cancellationToken)
    {
        // Prefer the submit button in the Instrument Certificate Upload footer
        // (type=submit "Generate Certificate"), not sidebar "Generate Certificates".
        var btn = page.Locator("button[type='submit'], button")
            .Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex("^\\s*Generate Certificate\\s*$", RegexOptions.IgnoreCase),
            });

        if (await btn.CountAsync() == 0)
        {
            btn = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions
            {
                Name = "Generate Certificate",
                Exact = true,
            });
        }

        if (await btn.CountAsync() == 0)
        {
            throw new InvalidOperationException(
                "Could not find eMAAP 'Generate Certificate' button.");
        }

        await btn.First.ScrollIntoViewIfNeededAsync();
        await btn.First.ClickAsync(new LocatorClickOptions { Timeout = 15_000 });
        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            await page.WaitForLoadStateAsync(LoadState.NetworkIdle, new PageWaitForLoadStateOptions
            {
                Timeout = 30_000,
            });
        }
        catch (PlaywrightException)
        {
            await page.WaitForTimeoutAsync(2_000);
        }

        await EmaapCertificatesIssuedAutomation.DismissSuccessOkAsync(page, cancellationToken);
    }

    private static async Task FillInstrumentDetailsBlockAsync(
        IPage page,
        InstrumentDetails instrument,
        CancellationToken cancellationToken)
    {
        await page.Locator("#type_of_instrument").WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 45_000,
        });
        cancellationToken.ThrowIfCancellationRequested();

        await SelectByIdLabelAsync(
            page,
            "#type_of_instrument",
            ResolveTypeOfInstrument(instrument));
        await FillByIdAsync(page, "#manufacturer", instrument.Manufacturer);
        await FillByIdAsync(page, "#serial_number", instrument.SerialNumber);
        await SelectByIdLabelAsync(page, "#year_of_manufacture", instrument.YearOfManufacture);
        await FillByIdAsync(page, "#accuracy_class", instrument.AccuracyClass);
        await FillByIdAsync(page, "#maximum_capacity", instrument.MaximumCapacity);
        await FillByIdAsync(page, "#minimum_capacity", instrument.MinimumCapacity);
        await FillByIdAsync(page, "#verification_scale_interval", instrument.VerificationScaleInterval);
    }

    private static async Task FillMetrologicalBlockAsync(IPage page, InstrumentDetails instrument)
    {
        await FillByIdAsync(page, "#unit_of_measurement", instrument.UnitOfMeasurement);
        await FillByIdAsync(page, "#actual_scale_interval", instrument.ActualScaleInterval);
        await FillByIdAsync(page, "#no_of_verification_interval", instrument.NoOfVerificationIntervals);
        await FillByIdAsync(page, "#maximum_permissible_error", instrument.MaximumPermissibleError);
    }

    private static async Task FillVerificationChecksBlockAsync(IPage page, InstrumentDetails instrument)
    {
        var result = string.IsNullOrWhiteSpace(instrument.VerificationTestResult)
            ? "Pass"
            : instrument.VerificationTestResult;

        foreach (var id in new[]
                 {
                     "#visual_examination",
                     "#zero_setting",
                     "#eccentricity_test",
                     "#repeatability_test",
                     "#accuracy_test",
                     "#tare_device_test",
                     "#overall_verification_result",
                 })
        {
            await SelectByIdLabelAsync(page, id, result);
        }
    }

    private static async Task FillEnvironmentalBlockAsync(IPage page, InstrumentDetails instrument)
    {
        await FillByIdAsync(page, "#ambient_temperature", instrument.AmbientTemperature);
        await FillByIdAsync(page, "#relative_humidity", instrument.RelativeHumidity);
        await FillByIdAsync(page, "#supply_voltage", instrument.SupplyVoltage);
    }

    private static async Task FillSealingBlockAsync(IPage page, InstrumentDetails instrument)
    {
        await SelectByIdLabelAsync(page, "#verification_seal", instrument.VerificationSealAffixed);
        await FillByIdAsync(page, "#seal_identification_no", instrument.SealIdentificationNumber);
        await FillByIdAsync(page, "#software_identification", instrument.SoftwareIdentification);
    }

    private static async Task FillVerificationDecisionBlockAsync(IPage page, InstrumentDetails instrument)
    {
        await SelectByIdLabelAsync(page, "#OIML_recommendation", instrument.InstrumentConformsToOiml);
        await SelectByIdLabelAsync(page, "#verified_stamped", instrument.VerifiedAndStamped);
        var remarks = string.IsNullOrWhiteSpace(instrument.Remarks) ? "Nill" : instrument.Remarks;
        await FillByIdAsync(page, "#remarks", remarks);
    }

    private static async Task FillChargesBlockAsync(
        IPage page,
        InstrumentDetails instrument,
        IReadOnlyList<string>? machinePhotoLocalPaths)
    {
        var section = page.GetByText("Verification & Charges", new PageGetByTextOptions { Exact = false });
        if (await section.CountAsync() > 0)
        {
            await section.First.ScrollIntoViewIfNeededAsync();
        }

        // eMAAP required. OV (no MoneyReceiptNumber): receipt "0" + today's date. RV: invoice + dated.
        var isOv = string.IsNullOrWhiteSpace(instrument.MoneyReceiptNumber);
        var receiptNo = isOv ? "0" : instrument.MoneyReceiptNumber.Trim();
        await FillByIdAsync(page, "#money_receipt_no", receiptNo);

        var isoDate = isOv
            ? DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : FirstNonEmpty(
                ToHtmlDate(instrument.MoneyReceiptDated),
                DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        await FillByIdAsync(page, "#date", isoDate);

        var fee = FirstNonEmpty(instrument.VerificationFeeTotal, "0");
        await FillByIdAsync(page, "#verification_fee", fee);
        await FillByIdAsync(page, "#adj_charges", "0");

        var total = FirstNonEmpty(instrument.TotalDeposited, fee, "0");
        await page.Locator("#verification_fee").EvaluateAsync(
            """
            el => {
              if (typeof calculatetotal === 'function') {
                try { calculatetotal('verification_fee', 'adj_charges', 'total'); } catch (_) {}
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            """);

        // Readonly total — force value if site script did not.
        var totalEl = page.Locator("#total");
        if (await totalEl.CountAsync() > 0)
        {
            var current = (await totalEl.InputValueAsync()).Trim();
            if (string.IsNullOrWhiteSpace(current) || (current == "0" && total != "0"))
            {
                await totalEl.EvaluateAsync(
                    """
                    (el, value) => {
                      el.removeAttribute('readonly');
                      el.value = value;
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    """,
                    total);
            }
        }

        await FillByIdAsync(page, "#model_approval_no", instrument.ModelApprovalNo);

        // machine_photo (+ optional 2..5): stamping, scale, rear, weights, seal
        var photoSelectors = new[]
        {
            "#machine_photo_file, input[name='machine_photo']",
            "#machine_photo2_file, input[name='machine_photo2']",
            "#machine_photo3_file, input[name='machine_photo3']",
            "#machine_photo4_file, input[name='machine_photo4']",
            "#machine_photo5_file, input[name='machine_photo5']",
        };

        if (machinePhotoLocalPaths is { Count: > 0 })
        {
            for (var i = 0; i < photoSelectors.Length && i < machinePhotoLocalPaths.Count; i++)
            {
                var path = machinePhotoLocalPaths[i];
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    continue;
                }

                var photo = page.Locator(photoSelectors[i]).First;
                if (await photo.CountAsync() == 0)
                {
                    continue;
                }

                await photo.WaitForAsync(new LocatorWaitForOptions
                {
                    State = WaitForSelectorState.Attached,
                    Timeout = 10_000,
                });
                await photo.ScrollIntoViewIfNeededAsync();
                await photo.SetInputFilesAsync(path);
            }
        }

        // machine_photo_with_serial_no[]: value 1 = premises, value 2 = in situ
        var premises = page.Locator("#machine_photo_with_serial_no_0");
        var inSitu = page.Locator("#machine_photo_with_serial_no_1");
        if (await premises.CountAsync() > 0 && await inSitu.CountAsync() > 0)
        {
            var isPremises = string.Equals(
                instrument.VerificationLocation, "in_premises", StringComparison.OrdinalIgnoreCase);
            if (isPremises)
            {
                await premises.CheckAsync();
                await inSitu.UncheckAsync();
            }
            else
            {
                await inSitu.CheckAsync();
                await premises.UncheckAsync();
            }
        }
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var v in values)
        {
            if (!string.IsNullOrWhiteSpace(v))
            {
                return v.Trim();
            }
        }

        return string.Empty;
    }

    /// <summary>
    /// Max capacity &gt;= 50 kg → Platform Scale; &lt; 50 kg → Counter Scale.
    /// Weighbridge / Crane kept if product type already names them.
    /// </summary>
    internal static string ResolveTypeOfInstrument(InstrumentDetails instrument)
    {
        var rawType = instrument.TypeOfInstrument?.Trim() ?? string.Empty;
        if (rawType.Contains("weighbridge", StringComparison.OrdinalIgnoreCase)
            || rawType.Contains("weigh bridge", StringComparison.OrdinalIgnoreCase))
        {
            return "Weighbridge";
        }

        if (rawType.Contains("crane", StringComparison.OrdinalIgnoreCase))
        {
            return "Crane Scale";
        }

        if (TryParseCapacityKg(instrument.MaximumCapacity, out var kg))
        {
            return kg >= 50 ? "Platform Scale" : "Counter Scale";
        }

        return MapTypeOfInstrument(rawType);
    }

    internal static bool TryParseCapacityKg(string? maximumCapacity, out double kg)
    {
        kg = 0;
        if (string.IsNullOrWhiteSpace(maximumCapacity))
        {
            return false;
        }

        var match = Regex.Match(maximumCapacity, @"(\d+(?:[.,]\d+)?)");
        if (!match.Success)
        {
            return false;
        }

        var token = match.Groups[1].Value.Replace(',', '.');
        return double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out kg);
    }

    /// <summary>Fallback when capacity missing: DOCA "Electronic" → Counter Scale.</summary>
    internal static string MapTypeOfInstrument(string? docaOrEmaap)
    {
        if (string.IsNullOrWhiteSpace(docaOrEmaap)
            || docaOrEmaap.Equals("Electronic", StringComparison.OrdinalIgnoreCase))
        {
            return DefaultTypeOfInstrumentLabel;
        }

        var t = docaOrEmaap.Trim();
        if (t.Contains("counter", StringComparison.OrdinalIgnoreCase))
        {
            return "Counter Scale";
        }

        if (t.Contains("platform", StringComparison.OrdinalIgnoreCase))
        {
            return "Platform Scale";
        }

        if (t.Contains("weighbridge", StringComparison.OrdinalIgnoreCase)
            || t.Contains("weigh bridge", StringComparison.OrdinalIgnoreCase))
        {
            return "Weighbridge";
        }

        if (t.Contains("crane", StringComparison.OrdinalIgnoreCase))
        {
            return "Crane Scale";
        }

        return DefaultTypeOfInstrumentLabel;
    }

    /// <summary>DOCA dd-MM-yy / dd-MM-yyyy → HTML date yyyy-MM-dd.</summary>
    internal static string ToHtmlDate(string? docaDate)
    {
        if (string.IsNullOrWhiteSpace(docaDate))
        {
            return string.Empty;
        }

        var formats = new[] { "dd-MM-yy", "dd-MM-yyyy", "yyyy-MM-dd", "dd/MM/yyyy", "dd/MM/yy" };
        if (DateTime.TryParseExact(
                docaDate.Trim(),
                formats,
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var dt))
        {
            return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        if (DateTime.TryParse(docaDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out dt))
        {
            return dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }

        return string.Empty;
    }

    private static async Task FillByIdAsync(IPage page, string selector, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return;
        }

        var el = page.Locator(selector).First;
        await el.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 10_000,
        });
        await el.FillAsync(value);
        await el.EvaluateAsync(
            """
            el => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              const hook = (el.getAttribute('data-input') || '').toLowerCase();
              if (hook.includes('changebtvalue') && typeof changebtvalue === 'function') {
                try { changebtvalue(); } catch (_) {}
              }
              if (hook.includes('calculatetotal') && typeof calculatetotal === 'function') {
                try { calculatetotal('verification_fee', 'adj_charges', 'total'); } catch (_) {}
              }
            }
            """);
    }

    private static async Task SelectByIdLabelAsync(
        IPage page,
        string selector,
        string optionText,
        bool invokeOnchange = false)
    {
        if (string.IsNullOrWhiteSpace(optionText))
        {
            return;
        }

        var select = page.Locator(selector).First;
        await select.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 10_000,
        });

        var ok = await select.EvaluateAsync<bool>(
            """
            (el, want) => {
              const [label, invokeOnchange] = want;
              const w = (label || '').trim().toLowerCase();
              let matched = null;
              for (const o of el.options) {
                const t = (o.text || '').trim();
                if (!t || /^select/i.test(t)) continue;
                if (t.toLowerCase() === w || t.toLowerCase().includes(w) || w.includes(t.toLowerCase())) {
                  matched = o;
                  if (t.toLowerCase() === w) break;
                }
              }
              if (!matched) return false;
              el.value = matched.value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              if (invokeOnchange) {
                const attr = el.getAttribute('data-onchange') || '';
                if (attr.includes('loaddistricts') && typeof loaddistricts === 'function') {
                  try { loaddistricts(el); } catch (_) {}
                }
                if (attr.includes('shblocks') && typeof shblocks === 'function') {
                  try { shblocks(el); } catch (_) {}
                }
              }
              return true;
            }
            """,
            new object[] { optionText, invokeOnchange });

        if (!ok)
        {
            throw new InvalidOperationException(
                $"Could not select {selector} = '{optionText}' on eMAAP form.");
        }
    }

    private static async Task OpenGenerateCertificatesListAsync(IPage page, CancellationToken cancellationToken)
    {
        if (!page.Url.Contains("generate-certificates", StringComparison.OrdinalIgnoreCase))
        {
            var nav = page.Locator("a, button, span, div")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("^\\s*Generate Certificates\\s*$", RegexOptions.IgnoreCase),
                });
            if (await nav.CountAsync() > 0)
            {
                try
                {
                    await nav.First.ClickAsync(new LocatorClickOptions { Timeout = 5_000 });
                    await page.WaitForLoadStateAsync(LoadState.DOMContentLoaded);
                }
                catch (PlaywrightException)
                {
                    await page.GotoAsync(GenerateCertificatesUrl, new PageGotoOptions
                    {
                        WaitUntil = WaitUntilState.DOMContentLoaded,
                        Timeout = 60_000,
                    });
                }
            }
            else
            {
                await page.GotoAsync(GenerateCertificatesUrl, new PageGotoOptions
                {
                    WaitUntil = WaitUntilState.DOMContentLoaded,
                    Timeout = 60_000,
                });
            }
        }

        await page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Certificate Generation" })
            .Or(page.GetByText("Certificate Generation", new PageGetByTextOptions { Exact = false }))
            .First
            .WaitForAsync(new LocatorWaitForOptions
            {
                State = WaitForSelectorState.Visible,
                Timeout = 30_000,
            });
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task ClickCertificateGenerationButtonAsync(IPage page, CancellationToken cancellationToken)
    {
        var btn = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Certificate Generation" });
        if (await btn.CountAsync() == 0)
        {
            btn = page.Locator("button, a")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("Certificate Generation", RegexOptions.IgnoreCase),
                });
        }

        if (await btn.CountAsync() == 0)
        {
            throw new InvalidOperationException("Could not find eMAAP 'Certificate Generation' button.");
        }

        await btn.First.ClickAsync(new LocatorClickOptions { Timeout = 15_000 });
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task WaitForGenerateFormAsync(IPage page, CancellationToken cancellationToken)
    {
        await page.Locator("#instrument_type").WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 30_000,
        });
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task SelectInstrumentTypeAsync(IPage page, CancellationToken cancellationToken)
    {
        var select = page.Locator("#instrument_type").First;
        await select.WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 20_000,
        });

        var current = await select.InputValueAsync();
        if (current == InstrumentTypeValue)
        {
            await SetSelectValueAsync(select, "", "Select", callShblocks: true);
            await page.WaitForTimeoutAsync(300);
        }

        await SetSelectValueAsync(select, "", "Select", callShblocks: true);
        await page.WaitForTimeoutAsync(1_000);
        cancellationToken.ThrowIfCancellationRequested();

        await SetSelectValueAsync(select, InstrumentTypeValue, InstrumentTypeLabel, callShblocks: true);
        await page.WaitForTimeoutAsync(500);

        await page.Locator("#belongs_to").WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 10_000,
        });
        cancellationToken.ThrowIfCancellationRequested();
    }

    private static async Task SetSelectValueAsync(
        ILocator select,
        string value,
        string label,
        bool callShblocks)
    {
        var ok = await select.EvaluateAsync<bool>(
            """
            (el, want) => {
              const [value, label, callShblocks] = want;
              let matched = null;
              for (const o of el.options) {
                const t = (o.text || '').trim();
                if (o.value === value || t.toLowerCase() === (label || '').toLowerCase()) {
                  matched = o;
                  break;
                }
              }
              if (!matched && value === '') {
                matched = el.options[0] || null;
              }
              if (!matched) return false;
              el.value = matched.value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              if (callShblocks && typeof shblocks === 'function') {
                try { shblocks(el); } catch (_) {}
              }
              return true;
            }
            """,
            new object[] { value, label, callShblocks });

        if (!ok)
        {
            throw new InvalidOperationException(
                $"Could not set select to '{label}' (value '{value}') on eMAAP form.");
        }
    }
}
