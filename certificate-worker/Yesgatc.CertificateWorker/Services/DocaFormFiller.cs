using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using Yesgatc.CertificateWorker.Models;

namespace Yesgatc.CertificateWorker.Services;

public static class DocaFormFiller
{
    /// <summary>
    /// Top-of-page Instrument Type dropdown (required before party fields). Re-selects after each successful submission.
    /// </summary>
    public static async Task EnsurePageInstrumentTypeSelectedAsync(IPage page)
    {
        await WaitForPageInstrumentTypeControlAsync(page);

        if (await IsPageInstrumentTypeSelectedAsync(page))
        {
            return;
        }

        var nativeLabel = await TrySelectPageInstrumentTypeNativeAsync(page);
        if (nativeLabel is not null)
        {
            await page.WaitForTimeoutAsync(400);
            return;
        }

        var customLabel = await TrySelectPageInstrumentTypeCustomAsync(page);
        if (customLabel is not null)
        {
            await page.WaitForTimeoutAsync(400);
            return;
        }

        throw new InvalidOperationException(
            "Could not select Instrument Type on the DOCA form. Ensure the page is on IC verification and the dropdown is visible.");
    }

    public static async Task FillPartySectionAsync(IPage page, PartyContactDetails party)
    {
        await FillPlainFieldAsync(page, ["Belong To"], party.BelongToName);
        await FillPlainFieldAsync(page, ["Address"], party.Address);
        await FillSelect2FieldAsync(page, ["State"], party.State);
        await page.WaitForTimeoutAsync(500);
        await FillSelect2FieldAsync(page, ["districts", "District"], party.District);
        await FillPlainFieldAsync(page, ["Pincode"], party.Pincode);
        await FillPlainFieldAsync(page, ["Mobile No", "Mobile"], party.Mobile);
    }

    public static async Task FillInstrumentSectionAsync(IPage page, InstrumentDetails instrument)
    {
        await SelectNativeDropdownOptionAsync(page, ["Type of Instrument"], instrument.TypeOfInstrument);
        await FillPlainFieldAsync(
            page,
            ["Manufacturer / Model / Brand / Series Designation", "Manufacturer"],
            instrument.Manufacturer);
        await FillPlainFieldAsync(page, ["Year of Manufacture"], instrument.YearOfManufacture);
        await FillPlainFieldAsync(page, ["Accuracy Class"], instrument.AccuracyClass);
        await FillPlainFieldAsync(page, ["Maximum Capacity"], instrument.MaximumCapacity);
        await FillPlainFieldAsync(page, ["Minimum Capacity"], instrument.MinimumCapacity);
        await FillPlainFieldAsync(page, ["Verification Scale Interval"], instrument.VerificationScaleInterval);
        await FillExtendedSectionsAsync(page, instrument);
    }

    public static async Task FillExtendedSectionsAsync(IPage page, InstrumentDetails instrument)
    {
        await FillPlainFieldAsync(page, ["Unit of Measurement"], instrument.UnitOfMeasurement);
        await FillPlainFieldAsync(page, ["Actual Scale Interval"], instrument.ActualScaleInterval);
        await FillPlainFieldAsync(page, ["No. of Verification Intervals"], instrument.NoOfVerificationIntervals);
        await FillPlainFieldAsync(page, ["Maximum Permissible Error"], instrument.MaximumPermissibleError);
        await FillPlainFieldAsync(page, ["Ambient Temperature"], instrument.AmbientTemperature);
        await FillPlainFieldAsync(page, ["Relative Humidity"], instrument.RelativeHumidity);
        await FillPlainFieldAsync(page, ["Supply Voltage"], instrument.SupplyVoltage);

        var passFailFields =
            new[]
            {
                "Visual Examination",
                "Zero Setting",
                "Eccentricity Test",
                "Repeatability Test",
                "Accuracy / Weighing Performance Test",
                "Tare Device Test",
                "Overall Verification Result",
            };

        foreach (var field in passFailFields)
        {
            await SelectNativeDropdownOptionAsync(page, [field], instrument.VerificationTestResult);
        }

        await FillSealingAndDecisionSectionAsync(page, instrument);
    }

    public static async Task FillSealingAndDecisionSectionAsync(IPage page, InstrumentDetails instrument)
    {
        await SelectNativeDropdownOptionAsync(page, ["Verification Seal Affixed"], instrument.VerificationSealAffixed);
        await FillPlainFieldAsync(page, ["Seal Identification No"], instrument.SealIdentificationNumber);
        await FillPlainFieldAsync(
            page,
            ["Software Identification", "Checksum"],
            instrument.SoftwareIdentification);
        await SelectNativeDropdownOptionAsync(
            page,
            ["Instrument conforms to OIML", "LM (Gen) Rules"],
            instrument.InstrumentConformsToOiml);
        await SelectNativeDropdownOptionAsync(
            page,
            ["Verified and stamped for use in commercial transactions", "Verified and stamped"],
            instrument.VerifiedAndStamped);
        await FillPlainFieldAsync(page, ["Remarks"], instrument.Remarks);
        await FillVerificationChargesSectionAsync(page, instrument);
    }

    public static async Task FillVerificationChargesSectionAsync(IPage page, InstrumentDetails instrument)
    {
        await ScrollToLabelAsync(page, "Verification & Charges");

        await FillPlainFieldAsync(page, ["Money Receipt"], instrument.MoneyReceiptNumber, inputIndex: 0);
        await FillDateFieldAsync(page, ["Dated", "Money Receipt Dated"], instrument.MoneyReceiptDated);
        await FillPlainFieldAsync(page, ["Verification Fee"], instrument.VerificationFeeTotal);
        await FillPlainFieldAsync(page, ["Carriage", "Conveyance"], "0");
        await FillPlainFieldAsync(page, ["Total deposited"], instrument.TotalDeposited);
        await FillPlainFieldAsync(page, ["Model Approval"], instrument.ModelApprovalNo);

        var placeLabels = instrument.VerificationLocation == "in_premises"
            ? new[] { "In the premises of GATC", "premises of GATC" }
            : new[] { "In situ / at the place of user", "place of user", "In situ" };

        var otherLabels = instrument.VerificationLocation == "in_premises"
            ? new[] { "In situ / at the place of user", "place of user", "In situ" }
            : new[] { "In the premises of GATC", "premises of GATC" };

        await CheckCheckboxByLabelAsync(page, placeLabels);
        await UncheckCheckboxByLabelAsync(page, otherLabels);
    }

    public static async Task FillMachinePhotoSectionAsync(
        IPage page,
        InstrumentDetails instrument,
        string stampingImageLocalPath)
    {
        await ScrollToLabelAsync(page, "Machine Photo");

        if (string.IsNullOrWhiteSpace(stampingImageLocalPath) || !File.Exists(stampingImageLocalPath))
        {
            throw new InvalidOperationException(
                "Stamping plate image file is missing on disk for upload.");
        }

        await SetFileInputAsync(
            page,
            ["Machine Photo with Serial No", "Machine Photo"],
            stampingImageLocalPath);
        await FillPlainFieldAsync(page, ["Serial Number"], instrument.SerialNumber);
    }

    public static async Task FillIcUploadCertificateFormAsync(
        IPage page,
        string signedCertificatePdfPath,
        string instrumentPhotoPath,
        string remarks)
    {
        if (string.IsNullOrWhiteSpace(signedCertificatePdfPath) || !File.Exists(signedCertificatePdfPath))
        {
            throw new InvalidOperationException("Signed certificate PDF was not found for upload.");
        }

        if (string.IsNullOrWhiteSpace(instrumentPhotoPath) || !File.Exists(instrumentPhotoPath))
        {
            throw new InvalidOperationException("Instrument photo file was not found for upload.");
        }

        await WaitForIcUploadCertificatePageAsync(page);

        await SetIcUploadFilesAsync(page, signedCertificatePdfPath, instrumentPhotoPath);
        await FillPlainFieldAsync(page, ["Remarks"], remarks);
    }

    private static async Task SetIcUploadFilesAsync(
        IPage page,
        string signedCertificatePdfPath,
        string instrumentPhotoPath)
    {
        var pdfPath = Path.GetFullPath(signedCertificatePdfPath);
        var photoPath = Path.GetFullPath(instrumentPhotoPath);
        var indices = await ResolveIcUploadFileInputIndicesAsync(page);

        var fileInputs = page.Locator("input[type='file']:not([disabled])");
        var certificateInput = fileInputs.Nth(indices.CertificateIndex);
        var photoInput = fileInputs.Nth(indices.PhotoIndex);

        await certificateInput.ScrollIntoViewIfNeededAsync();
        await certificateInput.SetInputFilesAsync(pdfPath);
        await VerifyFileInputSelectionAsync(certificateInput, pdfPath, "Upload Generate Certificate");

        await photoInput.ScrollIntoViewIfNeededAsync();
        await photoInput.SetInputFilesAsync(photoPath);
        await VerifyFileInputSelectionAsync(photoInput, photoPath, "Instrument Photo");
    }

    private static async Task<(int CertificateIndex, int PhotoIndex)> ResolveIcUploadFileInputIndicesAsync(IPage page)
    {
        var indices = await page.EvaluateAsync<int[]?>(
            """
            () => {
              const inputs = [...document.querySelectorAll('input[type="file"]:not([disabled])')];
              let certificateIndex = -1;
              let photoIndex = -1;

              inputs.forEach((input, index) => {
                const group =
                  input.closest('.form-group') ||
                  input.closest('[class*="col-"]') ||
                  input.parentElement;
                const text = (group?.innerText || '').toLowerCase();

                if (text.includes('upload generate certificate') && certificateIndex < 0) {
                  certificateIndex = index;
                } else if (text.includes('instrument photo') && photoIndex < 0) {
                  photoIndex = index;
                }
              });

              return [certificateIndex, photoIndex];
            }
            """);

        if (indices is null || indices.Length < 2 || indices[0] < 0 || indices[1] < 0)
        {
            throw new InvalidOperationException(
                "Could not locate the Upload Generate Certificate and Instrument Photo file inputs on DOCA.");
        }

        if (indices[0] == indices[1])
        {
            throw new InvalidOperationException(
                "DOCA upload file inputs resolved to the same field for certificate and instrument photo.");
        }

        return (indices[0], indices[1]);
    }

    private static async Task VerifyFileInputSelectionAsync(
        ILocator input,
        string expectedPath,
        string fieldLabel)
    {
        var expectedName = Path.GetFileName(expectedPath);
        var selectedName = await input.EvaluateAsync<string>(
            "el => el.files && el.files.length > 0 ? el.files[0].name : ''");

        if (string.IsNullOrWhiteSpace(selectedName))
        {
            throw new InvalidOperationException(
                $"DOCA did not accept the selected file for {fieldLabel}: {expectedName}");
        }

        if (fieldLabel.Contains("Generate Certificate", StringComparison.OrdinalIgnoreCase)
            && !selectedName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Upload Generate Certificate must be a PDF, but DOCA selected: {selectedName}");
        }
    }

    public static async Task SubmitIcUploadCertificateAsync(IPage page)
    {
        var button = page.GetByRole(
            AriaRole.Button,
            new PageGetByRoleOptions { Name = "Upload Certificate" });
        if (await button.CountAsync() == 0)
        {
            button = page.Locator("button, input[type='submit'], a")
                .Filter(new LocatorFilterOptions
                {
                    HasTextRegex = new Regex("^\\s*Upload\\s+Certificate\\s*$", RegexOptions.IgnoreCase),
                });
        }

        if (await button.CountAsync() == 0)
        {
            throw new InvalidOperationException("Could not find the Upload Certificate submit button on DOCA.");
        }

        var submit = button.First;
        await submit.ScrollIntoViewIfNeededAsync();
        await submit.ClickAsync(new LocatorClickOptions { Timeout = 30_000 });
    }

    public static async Task WaitForIcUploadCertificateSuccessAsync(IPage page)
    {
        var deadline = DateTime.UtcNow.AddSeconds(120);

        while (DateTime.UtcNow < deadline)
        {
            var url = page.Url;
            if (url.Contains("view-ic-verification", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var success = page.Locator("body").Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex(
                    "uploaded successfully|certificate uploaded|successfully uploaded",
                    RegexOptions.IgnoreCase),
            });
            if (await success.CountAsync() > 0)
            {
                return;
            }

            await page.WaitForTimeoutAsync(1_000);
        }

        throw new InvalidOperationException(
            "DOCA did not confirm the certificate upload within 120 seconds.");
    }

    private static async Task WaitForIcUploadCertificatePageAsync(IPage page)
    {
        if (page.Url.Contains("ic-upload-certificate", StringComparison.OrdinalIgnoreCase))
        {
            var heading = page.Locator("h1, h3.box-title, .box-title").Filter(new LocatorFilterOptions
            {
                HasTextRegex = new Regex("Instrument Certificate Upload", RegexOptions.IgnoreCase),
            });
            if (await heading.CountAsync() > 0)
            {
                await heading.First.WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });
                return;
            }
        }

        await page.WaitForURLAsync(
            url => url.Contains("ic-upload-certificate", StringComparison.OrdinalIgnoreCase),
            new PageWaitForURLOptions { Timeout = 60_000 });

        var title = page.GetByText("Instrument Certificate Upload", new PageGetByTextOptions { Exact = false });
        await title.First.WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });
    }

    public static async Task WaitForDocaSubmissionSuccessAsync(IPage page)
    {
        await SubmitGenerateCertificateAsync(page);

        var deadline = DateTime.UtcNow.AddSeconds(120);

        while (DateTime.UtcNow < deadline)
        {
            await ThrowIfDocaInternalServerErrorAsync(page);

            var successMessage = page.GetByText(
                "Instrument details saved successfully",
                new PageGetByTextOptions { Exact = false });
            if (await successMessage.CountAsync() > 0)
            {
                try
                {
                    await successMessage.First.WaitForAsync(new LocatorWaitForOptions { Timeout = 2_000 });
                    return;
                }
                catch (TimeoutException)
                {
                    // Keep polling until the success banner is stable.
                }
            }

            await page.WaitForTimeoutAsync(500);
        }

        await ThrowIfDocaInternalServerErrorAsync(page);
        throw new InvalidOperationException(
            "DOCA did not confirm IC verification submission within 120 seconds.");
    }

    private static async Task ThrowIfDocaInternalServerErrorAsync(IPage page)
    {
        var title = await page.TitleAsync();
        var body = await page.Locator("body").InnerTextAsync();

        var isServerError = title.Contains("500", StringComparison.OrdinalIgnoreCase)
            || body.Contains("Internal Server Error", StringComparison.OrdinalIgnoreCase)
            || (page.Url.Contains("gn-certificate-store", StringComparison.OrdinalIgnoreCase)
                && body.Contains("misconfiguration", StringComparison.OrdinalIgnoreCase));

        if (!isServerError)
        {
            return;
        }

        throw new InvalidOperationException(
            "DOCA returned a 500 Internal Server Error after Generate Certificate (gn-certificate-store). " +
            "This is often caused by a machine photo that is too large for DOCA's server. " +
            "The worker compresses photos before upload — retry this job. " +
            "If it happens again, replace the stamping image in the web app with a smaller JPEG (ideally under 350 KB).");
    }

    /// <summary>After a successful submission the form stays on the same page; scroll back to the top to fill the next job.</summary>
    public static async Task PrepareForNextJobAsync(IPage page)
    {
        await page.EvaluateAsync("window.scrollTo(0, 0)");
        await page.WaitForTimeoutAsync(600);
        await WaitForPageInstrumentTypeControlAsync(page);
    }

    private static async Task WaitForPageInstrumentTypeControlAsync(IPage page)
    {
        var instrumentLabel = page.GetByText("Instrument Type", new PageGetByTextOptions { Exact = false });
        await instrumentLabel.First.WaitForAsync(new LocatorWaitForOptions { Timeout = 30_000 });

        var select = await FindPageInstrumentTypeSelectAsync(page);
        if (select is not null)
        {
            await select.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 15_000 });
            return;
        }

        var select2 = await FindPageInstrumentTypeSelect2Async(page);
        if (select2 is not null)
        {
            await select2.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Visible, Timeout = 15_000 });
        }
    }

    private static async Task<bool> IsPageInstrumentTypeSelectedAsync(IPage page)
    {
        var select = await FindPageInstrumentTypeSelectAsync(page);
        if (select is not null)
        {
            var selectedOption = select.Locator("option:checked");
            if (await selectedOption.CountAsync() == 0)
            {
                return false;
            }

            var value = (await selectedOption.GetAttributeAsync("value") ?? string.Empty).Trim();
            var text = (await selectedOption.InnerTextAsync()).Trim();
            return !IsInstrumentTypePlaceholder(value, text);
        }

        var select2 = await FindPageInstrumentTypeSelect2Async(page);
        if (select2 is not null)
        {
            var text = (await select2.InnerTextAsync()).Trim();
            return !IsInstrumentTypePlaceholder(string.Empty, text);
        }

        return false;
    }

    private static async Task<string?> TrySelectPageInstrumentTypeNativeAsync(IPage page)
    {
        var select = await FindPageInstrumentTypeSelectAsync(page);
        if (select is null)
        {
            return null;
        }

        await select.ScrollIntoViewIfNeededAsync();
        var optionLocator = select.Locator("option");
        var optionCount = await optionLocator.CountAsync();

        for (var optionIndex = 0; optionIndex < optionCount; optionIndex++)
        {
            var option = optionLocator.Nth(optionIndex);
            var value = (await option.GetAttributeAsync("value") ?? string.Empty).Trim();
            var text = (await option.InnerTextAsync()).Trim();

            if (IsInstrumentTypePlaceholder(value, text))
            {
                continue;
            }

            if (!string.IsNullOrWhiteSpace(value))
            {
                await select.SelectOptionAsync(new SelectOptionValue { Value = value });
            }
            else
            {
                await select.SelectOptionAsync(new SelectOptionValue { Label = text });
            }

            return text;
        }

        return null;
    }

    private static async Task<string?> TrySelectPageInstrumentTypeCustomAsync(IPage page)
    {
        var trigger = await FindPageInstrumentTypeSelect2Async(page);
        if (trigger is null)
        {
            var fallback = page.GetByText("Select Instrument", new PageGetByTextOptions { Exact = false }).First;
            if (await fallback.CountAsync() == 0)
            {
                return null;
            }

            trigger = fallback;
        }

        await trigger.ScrollIntoViewIfNeededAsync();
        await trigger.ClickAsync();

        var option = page.Locator(
                ".select2-results__option, .dropdown-menu.show .dropdown-item, ul[role='listbox'] [role='option']")
            .Filter(new LocatorFilterOptions { HasNotText = "Select Instrument" })
            .First;

        await option.WaitForAsync(new LocatorWaitForOptions { Timeout = 10_000 });
        var selectedLabel = (await option.InnerTextAsync()).Trim();
        await option.ClickAsync();

        return string.IsNullOrWhiteSpace(selectedLabel) ? null : selectedLabel;
    }

    private static async Task<ILocator?> FindPageInstrumentTypeSelectAsync(IPage page)
    {
        foreach (var label in new[] { "Instrument Type" })
        {
            var selectors = new[]
            {
                $"xpath=//label[{LabelContainsXPath(label)}]/ancestor::div[contains(@class,'form-group')][1]//select[1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/following-sibling::select[1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/parent::*//select[1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/following::select[1]",
            };

            foreach (var selector in selectors)
            {
                var locator = page.Locator(selector);
                if (await locator.CountAsync() > 0)
                {
                    return locator.First;
                }
            }
        }

        return null;
    }

    private static async Task<ILocator?> FindPageInstrumentTypeSelect2Async(IPage page)
    {
        foreach (var label in new[] { "Instrument Type" })
        {
            var selectors = new[]
            {
                $"xpath=//label[{LabelContainsXPath(label)}]/ancestor::div[contains(@class,'form-group')][1]//span[contains(@class,'select2-selection')][1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/following::span[contains(@class,'select2-selection')][1]",
            };

            foreach (var selector in selectors)
            {
                var locator = page.Locator(selector);
                if (await locator.CountAsync() > 0)
                {
                    return locator.First;
                }
            }
        }

        return null;
    }

    private static bool IsInstrumentTypePlaceholder(string value, string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(value)
            && text.Contains("Select", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return text.Contains("Select Instrument", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task SubmitGenerateCertificateAsync(IPage page)
    {
        await ScrollToLabelAsync(page, "Generate Certificate");

        var button = page.GetByRole(
            AriaRole.Button,
            new PageGetByRoleOptions { Name = "Generate Certificate" });
        if (await button.CountAsync() == 0)
        {
            button = page.Locator("button, input[type='submit'], a")
                .Filter(new LocatorFilterOptions { HasText = "Generate Certificate" });
        }

        if (await button.CountAsync() == 0)
        {
            throw new InvalidOperationException("Could not find the Generate Certificate button on DOCA.");
        }

        var submit = button.First;
        await submit.ScrollIntoViewIfNeededAsync();
        await submit.ClickAsync(new LocatorClickOptions { Timeout = 15_000 });
    }

    private static async Task TryClearPlainFieldAsync(
        IPage page,
        string[] labels,
        int inputIndex = 0)
    {
        try
        {
            await ClearPlainFieldAsync(page, labels, inputIndex);
        }
        catch (InvalidOperationException)
        {
            // Field may already be empty or absent on this DOCA layout.
        }
    }

    private static async Task SetFileInputAsync(IPage page, string[] labels, string filePath)
    {
        var input = await FindFileInputByLabelsAsync(page, labels);
        await input.ScrollIntoViewIfNeededAsync();
        await input.SetInputFilesAsync(filePath);
    }

    private static async Task<ILocator> FindFileInputByLabelsAsync(IPage page, string[] labels)
    {
        foreach (var label in labels)
        {
            if (await TryFindFileInputInColumnLayoutAsync(page, label) is { } inColumn)
            {
                return inColumn;
            }

            var selectors = new[]
            {
                $"xpath=(//label[{LabelContainsXPath(label)}])[1]/following-sibling::input[@type='file'][1]",
                $"xpath=(//label[{LabelContainsXPath(label)}])[1]/parent::*//input[@type='file'][1]",
                $"xpath=(//label[{LabelContainsXPath(label)}])[1]/following::input[@type='file'][1]",
                $"xpath=(//*[{LabelContainsXPath(label)}]/ancestor::label[1]//input[@type='file'])[1]",
                $"xpath=(//*[{LabelContainsXPath(label)}]/ancestor::div[contains(@class,'form-group')][1]//input[@type='file'])[1]",
            };

            foreach (var selector in selectors)
            {
                var locator = page.Locator(selector);
                if (await locator.CountAsync() > 0)
                {
                    return locator.First;
                }
            }

            foreach (var token in new[] { "machine_photo", "machinephoto", "serial_photo", "photo" })
            {
                var byName = page.Locator($"input[type='file'][name*='{token}' i], input[type='file'][id*='{token}' i]");
                if (await byName.CountAsync() > 0)
                {
                    return byName.First;
                }
            }
        }

        var fallback = page.Locator("input[type='file']:not([disabled])");
        if (await fallback.CountAsync() > 0)
        {
            return fallback.Last;
        }

        throw new InvalidOperationException(
            $"Could not find DOCA file upload for: {string.Join(" / ", labels)}");
    }

    private static async Task<ILocator?> TryFindFileInputInColumnLayoutAsync(IPage page, string label)
    {
        var labelAnchors = page.Locator(
            $"xpath=//*[({LabelContainsXPath(label)}) and (self::label or self::div or self::span or self::p or self::strong)]");
        var anchorCount = await labelAnchors.CountAsync();
        for (var anchorIndex = 0; anchorIndex < anchorCount; anchorIndex++)
        {
            var anchor = labelAnchors.Nth(anchorIndex);
            var fieldColumn = anchor.Locator(
                "xpath=ancestor::div[contains(@class,'col-')][1]/following-sibling::div[contains(@class,'col-')][1] | " +
                "ancestor::td[1]/following-sibling::td[1]");
            if (await fieldColumn.CountAsync() == 0)
            {
                continue;
            }

            var fileInput = fieldColumn.First.Locator("input[type='file']");
            if (await fileInput.CountAsync() > 0)
            {
                return fileInput.First;
            }
        }

        return null;
    }

    private static async Task ScrollToLabelAsync(IPage page, string labelFragment)
    {
        var target = page.Locator($"xpath=//*[{LabelContainsXPath(labelFragment)}]");
        if (await target.CountAsync() > 0)
        {
            await target.First.ScrollIntoViewIfNeededAsync();
            await page.WaitForTimeoutAsync(200);
        }
    }

    private static async Task CheckCheckboxByLabelAsync(IPage page, string[] labelFragments)
    {
        var checkbox = await FindCheckboxByLabelsAsync(page, labelFragments);
        if (!await checkbox.IsCheckedAsync())
        {
            await checkbox.CheckAsync(new LocatorCheckOptions { Timeout = 10_000 });
        }
    }

    private static async Task UncheckCheckboxByLabelAsync(IPage page, string[] labelFragments)
    {
        try
        {
            var checkbox = await FindCheckboxByLabelsAsync(page, labelFragments);
            if (await checkbox.IsCheckedAsync())
            {
                await checkbox.UncheckAsync(new LocatorUncheckOptions { Timeout = 10_000 });
            }
        }
        catch (InvalidOperationException)
        {
            // Opposite option may not exist on every DOCA layout.
        }
    }

    private static async Task<ILocator> FindCheckboxByLabelsAsync(IPage page, string[] labelFragments)
    {
        foreach (var labelFragment in labelFragments)
        {
            var selectors = new[]
            {
                $"xpath=//label[{LabelContainsXPath(labelFragment)}]//input[@type='checkbox']",
                $"xpath=//label[{LabelContainsXPath(labelFragment)}]/preceding-sibling::input[@type='checkbox']",
                $"xpath=//label[{LabelContainsXPath(labelFragment)}]/following-sibling::input[@type='checkbox']",
                $"xpath=//*[{LabelContainsXPath(labelFragment)}]/ancestor::label[1]//input[@type='checkbox']",
                $"xpath=//*[{LabelContainsXPath(labelFragment)}]/ancestor::div[contains(@class,'form-check')][1]//input[@type='checkbox']",
            };

            foreach (var selector in selectors)
            {
                var checkbox = page.Locator(selector);
                if (await checkbox.CountAsync() > 0)
                {
                    return checkbox.First;
                }
            }
        }

        throw new InvalidOperationException(
            $"Could not find DOCA checkbox for: {string.Join(" / ", labelFragments)}");
    }

    private static async Task SelectNativeDropdownOptionAsync(IPage page, string[] labels, string optionText)
    {
        try
        {
            var select = await FindNativeSelectByLabelsAsync(page, labels);
            await select.SelectOptionAsync(
                new SelectOptionValue { Label = optionText },
                new LocatorSelectOptionOptions { Timeout = 10_000 });
        }
        catch (PlaywrightException)
        {
            try
            {
                var select = await FindNativeSelectByLabelsAsync(page, labels);
                await select.SelectOptionAsync(
                    new SelectOptionValue { Value = optionText },
                    new LocatorSelectOptionOptions { Timeout = 10_000 });
            }
            catch (PlaywrightException)
            {
                await FillSelect2FieldAsync(page, labels, optionText);
            }
        }
    }

    private static async Task<ILocator> FindNativeSelectByLabelsAsync(IPage page, string[] labels)
    {
        foreach (var label in labels)
        {
            var scopedSelectors = new[]
            {
                $"xpath=//label[{LabelContainsXPath(label)}]/ancestor::div[contains(@class,'form-group')][1]//select[1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/parent::*//select[1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/following-sibling::select[1]",
            };

            foreach (var selector in scopedSelectors)
            {
                var locator = page.Locator(selector);
                if (await locator.CountAsync() > 0)
                {
                    return locator.First;
                }
            }
        }

        throw new InvalidOperationException(
            $"Could not find DOCA dropdown for: {string.Join(" / ", labels)}");
    }

    private static string LabelContainsXPath(string label) =>
        $"contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '{label.ToLowerInvariant()}')";

    private static async Task FillPlainFieldAsync(
        IPage page,
        string[] labels,
        string value,
        int inputIndex = 0)
    {
        var input = await FindTextInputByLabelsAsync(page, labels, inputIndex);
        await input.ScrollIntoViewIfNeededAsync();
        await input.ClickAsync();
        await input.FillAsync(value);
    }

    /// <summary>
    /// DOCA money-receipt date fields use a calendar widget (often readonly). Plain FillAsync does not stick.
    /// </summary>
    private static async Task FillDateFieldAsync(IPage page, string[] labels, string value, int inputIndex = 0)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return;
        }

        if (!TryParseDocaDateString(value, out var targetDate))
        {
            throw new InvalidOperationException($"DOCA date value is not valid: \"{value}\".");
        }

        var input = await FindTextInputByLabelsAsync(page, labels, inputIndex);
        await input.ScrollIntoViewIfNeededAsync();

        var inputType = await input.GetAttributeAsync("type");
        if (string.Equals(inputType, "date", StringComparison.OrdinalIgnoreCase))
        {
            await input.FillAsync(targetDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            return;
        }

        if (await TrySetDateFieldViaScriptAsync(input, value, targetDate)
            && await IsDateFieldFilledAsync(input, targetDate))
        {
            return;
        }

        if (await TrySetDateFieldViaCalendarUiAsync(page, input, targetDate)
            && await IsDateFieldFilledAsync(input, targetDate))
        {
            return;
        }

        await input.ClickAsync();
        await input.PressAsync("Control+A");
        await input.PressAsync("Backspace");
        await input.FillAsync(value);
        await input.PressAsync("Tab");
        await page.WaitForTimeoutAsync(200);

        if (!await IsDateFieldFilledAsync(input, targetDate))
        {
            throw new InvalidOperationException(
                $"Could not set DOCA date field ({string.Join(" / ", labels)}) to \"{value}\".");
        }
    }

    private static bool TryParseDocaDateString(string value, out DateTime date)
    {
        var trimmed = value.Trim();
        var formats = new[]
        {
            "dd-MM-yy",
            "dd-MM-yyyy",
            "dd/MM/yy",
            "dd/MM/yyyy",
            "d-M-yyyy",
            "d/M/yyyy",
        };

        return DateTime.TryParseExact(
            trimmed,
            formats,
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out date);
    }

    private static async Task<bool> IsDateFieldFilledAsync(ILocator input, DateTime expected)
    {
        var actualText = (await input.InputValueAsync()).Trim();
        if (string.IsNullOrWhiteSpace(actualText))
        {
            actualText = (await input.GetAttributeAsync("value"))?.Trim() ?? string.Empty;
        }

        if (TryParseDocaDateString(actualText, out var actualDate))
        {
            return actualDate.Date == expected.Date;
        }

        return false;
    }

    private static async Task<bool> TrySetDateFieldViaScriptAsync(
        ILocator input,
        string displayValue,
        DateTime targetDate)
    {
        try
        {
            var method = await input.EvaluateAsync<string?>(
                """
                (el, args) => {
                  const display = args.display;
                  const y = args.y;
                  const m = args.m;
                  const d = args.d;
                  const target = new Date(y, m - 1, d);

                  const jQuery = window.jQuery || window.$;
                  if (jQuery && typeof jQuery.fn.datepicker === 'function') {
                    try {
                      jQuery(el).datepicker('setDate', target);
                      jQuery(el).datepicker('update', target);
                      jQuery(el).trigger('changeDate');
                      jQuery(el).trigger('change');
                      return 'bootstrap-datepicker';
                    } catch (_) {}
                  }

                  if (el._flatpickr) {
                    el._flatpickr.setDate(target, true);
                    return 'flatpickr';
                  }

                  const wasReadOnly = el.readOnly;
                  el.readOnly = false;
                  el.value = display;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                  if (wasReadOnly) {
                    el.readOnly = true;
                  }
                  return 'native';
                }
                """,
                new
                {
                    display = displayValue,
                    y = targetDate.Year,
                    m = targetDate.Month,
                    d = targetDate.Day,
                });

            return !string.IsNullOrWhiteSpace(method);
        }
        catch (PlaywrightException)
        {
            return false;
        }
    }

    private static async Task<bool> TrySetDateFieldViaCalendarUiAsync(
        IPage page,
        ILocator input,
        DateTime targetDate)
    {
        try
        {
            await input.ClickAsync(new LocatorClickOptions { Timeout = 10_000 });
            await page.WaitForTimeoutAsync(350);

            var picker = await FindVisibleDatepickerAsync(page, input);
            if (picker is null)
            {
                return false;
            }

            await NavigateDatepickerToMonthAsync(page, picker, targetDate);

            var dayText = targetDate.Day.ToString(CultureInfo.InvariantCulture);
            var dayCells = picker.Locator(
                "td.day:not(.disabled):not(.old):not(.new), " +
                "td[data-day]:not(.disabled):not(.old):not(.new)");
            var count = await dayCells.CountAsync();
            for (var index = 0; index < count; index++)
            {
                var cell = dayCells.Nth(index);
                var text = (await cell.InnerTextAsync()).Trim();
                if (string.Equals(text, dayText, StringComparison.Ordinal))
                {
                    await cell.ClickAsync();
                    await page.WaitForTimeoutAsync(250);
                    return true;
                }
            }

            var epochMs = new DateTimeOffset(
                targetDate.Year,
                targetDate.Month,
                targetDate.Day,
                0,
                0,
                0,
                TimeSpan.Zero).ToUnixTimeMilliseconds();
            var byDataDate = picker.Locator($"td.day[data-date='{epochMs}']");
            if (await byDataDate.CountAsync() > 0)
            {
                await byDataDate.First.ClickAsync();
                await page.WaitForTimeoutAsync(250);
                return true;
            }
        }
        catch (PlaywrightException)
        {
            return false;
        }

        return false;
    }

    private static async Task<ILocator?> FindVisibleDatepickerAsync(IPage page, ILocator input)
    {
        var pickers = page.Locator(
            ".datepicker.datepicker-dropdown:visible, " +
            "div.datepicker-dropdown:visible, " +
            ".bootstrap-datetimepicker-widget.dropdown-menu:visible, " +
            ".datepicker:visible");
        if (await pickers.CountAsync() > 0)
        {
            return pickers.First;
        }

        var calendarTrigger = input.Locator(
            "xpath=ancestor::div[contains(@class,'input-group')][1]//*[contains(@class,'glyphicon-calendar') or contains(@class,'fa-calendar') or contains(@class,'bi-calendar')][1]");
        if (await calendarTrigger.CountAsync() > 0)
        {
            await calendarTrigger.First.ClickAsync();
            await page.WaitForTimeoutAsync(350);
            if (await pickers.CountAsync() > 0)
            {
                return pickers.First;
            }
        }

        return null;
    }

    private static async Task NavigateDatepickerToMonthAsync(IPage page, ILocator picker, DateTime target)
    {
        for (var attempt = 0; attempt < 48; attempt++)
        {
            var visible = await TryReadDatepickerMonthAsync(picker);
            if (visible is { } month
                && month.Year == target.Year
                && month.Month == target.Month)
            {
                return;
            }

            if (visible is null)
            {
                await picker.Locator(".next, th.next").First.ClickAsync(new LocatorClickOptions { Timeout = 2_000 });
                await page.WaitForTimeoutAsync(150);
                continue;
            }

            var goForward = visible.Value.Year < target.Year
                || (visible.Value.Year == target.Year && visible.Value.Month < target.Month);
            var nav = goForward
                ? picker.Locator(".next, th.next")
                : picker.Locator(".prev, th.prev");
            if (await nav.CountAsync() == 0)
            {
                return;
            }

            await nav.First.ClickAsync(new LocatorClickOptions { Timeout = 2_000 });
            await page.WaitForTimeoutAsync(150);
        }
    }

    private static async Task<(int Year, int Month)?> TryReadDatepickerMonthAsync(ILocator picker)
    {
        var header = picker.Locator(".datepicker-switch, th.datepicker-switch");
        if (await header.CountAsync() == 0)
        {
            return null;
        }

        var text = (await header.First.InnerTextAsync()).Trim();
        if (DateTime.TryParseExact(
                text,
                "MMMM yyyy",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var parsed))
        {
            return (parsed.Year, parsed.Month);
        }

        if (DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed))
        {
            return (parsed.Year, parsed.Month);
        }

        return null;
    }

    private static async Task ClearPlainFieldAsync(
        IPage page,
        string[] labels,
        int inputIndex = 0)
    {
        var input = await FindTextInputByLabelsAsync(page, labels, inputIndex);
        await input.ScrollIntoViewIfNeededAsync();
        await input.ClickAsync();
        await input.FillAsync(string.Empty);
    }

    private static async Task FillSelect2FieldAsync(IPage page, string[] labels, string value)
    {
        if (await TryFillHiddenSelectAsync(page, labels, value))
        {
            await page.WaitForTimeoutAsync(300);
            return;
        }

        var combobox = await FindSelect2ComboboxByLabelsAsync(page, labels);
        await combobox.ClickAsync();
        await page.WaitForTimeoutAsync(200);

        var search = page.Locator(".select2-container--open input.select2-search__field");
        if (await search.CountAsync() > 0)
        {
            await search.FillAsync(value);
            await page.WaitForTimeoutAsync(400);
        }

        if (!await TryClickSelect2OptionAsync(page, value))
        {
            throw new InvalidOperationException(
                $"Could not select \"{value}\" in DOCA dropdown ({string.Join(" / ", labels)}).");
        }

        await page.WaitForTimeoutAsync(300);
    }

    private static async Task<bool> TryFillHiddenSelectAsync(IPage page, string[] labels, string value)
    {
        foreach (var label in labels)
        {
            foreach (var select in await FindSelectElementsByLabelsAsync(page, [label]))
            {
                try
                {
                    await select.SelectOptionAsync(
                        new SelectOptionValue { Label = value },
                        new LocatorSelectOptionOptions { Timeout = 5_000 });
                    return true;
                }
                catch (PlaywrightException)
                {
                    try
                    {
                        await select.SelectOptionAsync(
                            new SelectOptionValue { Value = value },
                            new LocatorSelectOptionOptions { Timeout = 5_000 });
                        return true;
                    }
                    catch (PlaywrightException)
                    {
                        // Try next select candidate.
                    }
                }
            }
        }

        return false;
    }

    private static async Task<IReadOnlyList<ILocator>> FindSelectElementsByLabelsAsync(IPage page, string[] labels)
    {
        var results = new List<ILocator>();

        foreach (var label in labels)
        {
            foreach (var key in SelectKeysForLabel(label))
            {
                var byId = page.Locator($"select#{key}, select[name='{key}']");
                if (await byId.CountAsync() > 0)
                {
                    results.Add(byId.First);
                }
            }

            var selectors = new[]
            {
                $"xpath=//label[{LabelContainsXPath(label)}]/ancestor::div[contains(@class,'form-group')][1]//select[1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/following-sibling::select[1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/parent::*//select[1]",
                $"xpath=//label[{LabelContainsXPath(label)}]/following::select[1]",
            };

            foreach (var selector in selectors)
            {
                var locator = page.Locator(selector);
                if (await locator.CountAsync() > 0)
                {
                    results.Add(locator.First);
                }
            }
        }

        return results;
    }

    private static IEnumerable<string> SelectKeysForLabel(string label)
    {
        var lower = label.ToLowerInvariant();
        if (lower.Contains("state"))
        {
            yield return "state";
        }

        if (lower.Contains("district"))
        {
            yield return "districts";
            yield return "district";
        }
    }

    private static async Task<ILocator> FindTextInputByLabelsAsync(
        IPage page,
        string[] labels,
        int inputIndex = 0)
    {
        foreach (var label in labels)
        {
            if (await TryFindFieldAfterLabelAsync(page, label, inputIndex) is { } afterLabel)
            {
                return afterLabel;
            }

            if (await TryFindFieldInColumnLayoutAsync(page, label, inputIndex) is { } inColumn)
            {
                return inColumn;
            }

            if (await TryFindFieldByNameOrIdAsync(page, label, inputIndex) is { } byName)
            {
                return byName;
            }

            var byPlaceholder = page.Locator($"input[placeholder*='{label}' i]:not(.select2-search__field)");
            if (await byPlaceholder.CountAsync() > inputIndex)
            {
                return byPlaceholder.Nth(inputIndex);
            }
        }

        throw new InvalidOperationException(
            $"Could not find DOCA text field for: {string.Join(" / ", labels)}");
    }

    private static async Task<ILocator?> TryFindFieldAfterLabelAsync(
        IPage page,
        string label,
        int inputIndex)
    {
        var selectors = new[]
        {
            $"xpath=(//label[{LabelContainsXPath(label)}])[1]/following-sibling::textarea[1]",
            $"xpath=(//label[{LabelContainsXPath(label)}])[1]/following-sibling::input[not(@type='checkbox') and not(@type='file') and not(@type='hidden') and not(@type='radio') and not(contains(@class,'select2-search'))][1]",
            $"xpath=(//label[{LabelContainsXPath(label)}])[1]/parent::*//textarea[1]",
            $"xpath=(//label[{LabelContainsXPath(label)}])[1]/parent::*//input[not(@type='checkbox') and not(@type='file') and not(@type='hidden') and not(@type='radio') and not(contains(@class,'select2-search'))][1]",
            $"xpath=(//label[{LabelContainsXPath(label)}])[1]/following::textarea[{inputIndex + 1}]",
            $"xpath=(//label[{LabelContainsXPath(label)}])[1]/following::input[not(@type='checkbox') and not(@type='file') and not(@type='hidden') and not(@type='radio') and not(contains(@class,'select2-search'))][{inputIndex + 1}]",
        };

        foreach (var selector in selectors)
        {
            var locator = page.Locator(selector);
            if (await locator.CountAsync() > 0)
            {
                return locator.First;
            }
        }

        return null;
    }

    private static async Task<ILocator?> TryFindFieldInColumnLayoutAsync(
        IPage page,
        string label,
        int inputIndex)
    {
        var labelAnchors = page.Locator(
            $"xpath=//*[({LabelContainsXPath(label)}) and (self::label or self::div or self::span or self::p or self::strong or self::td or self::th)]");
        var anchorCount = await labelAnchors.CountAsync();
        for (var anchorIndex = 0; anchorIndex < anchorCount; anchorIndex++)
        {
            var anchor = labelAnchors.Nth(anchorIndex);
            var fieldColumn = anchor.Locator(
                "xpath=ancestor::div[contains(@class,'col-')][1]/following-sibling::div[contains(@class,'col-')][1] | " +
                "ancestor::td[1]/following-sibling::td[1]");
            if (await fieldColumn.CountAsync() == 0)
            {
                continue;
            }

            var fields = fieldColumn.First.Locator(
                "textarea, input:not([type='checkbox']):not([type='file']):not([type='hidden']):not([type='radio']):not(.select2-search__field)");
            if (await fields.CountAsync() > inputIndex)
            {
                return fields.Nth(inputIndex);
            }
        }

        var rowAnchors = page.Locator(
            $"xpath=//*[({LabelContainsXPath(label)}) and (self::label or self::div or self::span or self::p or self::strong)]");
        var rowCount = await rowAnchors.CountAsync();
        for (var rowIndex = 0; rowIndex < rowCount; rowIndex++)
        {
            var anchor = rowAnchors.Nth(rowIndex);
            var nearestRow = anchor.Locator("xpath=ancestor::div[contains(@class,'row')][1]");
            if (await nearestRow.CountAsync() == 0)
            {
                continue;
            }

            var labelColumn = anchor.Locator("xpath=ancestor::div[contains(@class,'col-')][1]");
            if (await labelColumn.CountAsync() == 0)
            {
                continue;
            }

            var fields = labelColumn.First.Locator(
                "xpath=following-sibling::div[contains(@class,'col-')][1]//textarea | " +
                "following-sibling::div[contains(@class,'col-')][1]//input[not(@type='checkbox') and not(@type='file') and not(@type='hidden') and not(@type='radio') and not(contains(@class,'select2-search'))]");
            if (await fields.CountAsync() > inputIndex)
            {
                return fields.Nth(inputIndex);
            }
        }

        return null;
    }

    private static async Task<ILocator?> TryFindFieldByNameOrIdAsync(
        IPage page,
        string label,
        int inputIndex)
    {
        foreach (var token in NameTokensForLabel(label))
        {
            var selector =
                $"input[name*='{token}' i]:not([type='checkbox']):not([type='file']):not([type='hidden']), " +
                $"input[id*='{token}' i]:not([type='checkbox']):not([type='file']):not([type='hidden']), " +
                $"textarea[name*='{token}' i], textarea[id*='{token}' i]";
            var locator = page.Locator(selector);
            if (await locator.CountAsync() > inputIndex)
            {
                return locator.Nth(inputIndex);
            }
        }

        return null;
    }

    private static IEnumerable<string> NameTokensForLabel(string label)
    {
        var lower = label.ToLowerInvariant();
        if (lower.Contains("money receipt"))
        {
            yield return "money_receipt";
            yield return "moneyreceipt";
            yield return "receipt";
        }

        if (lower.Contains("dated"))
        {
            yield return "money_receipt_date";
            yield return "moneyreceiptdate";
            yield return "receipt_date";
            yield return "dated";
        }

        if (lower.Contains("verification fee"))
        {
            yield return "verification_fee";
            yield return "verificationfee";
        }

        if (lower.Contains("carriage") || lower.Contains("conveyance"))
        {
            yield return "carriage";
            yield return "conveyance";
        }

        if (lower.Contains("total deposited"))
        {
            yield return "total_deposited";
            yield return "totaldeposited";
            yield return "total_amount";
        }

        if (lower.Contains("model approval"))
        {
            yield return "model_approval";
            yield return "modelapproval";
        }

        if (lower.Contains("unit of measurement"))
        {
            yield return "unit_of_measurement";
            yield return "unitofmeasurement";
            yield return "uom";
        }

        if (lower.Contains("actual scale interval"))
        {
            yield return "actual_scale";
            yield return "scale_interval_d";
        }

        if (lower.Contains("remarks"))
        {
            yield return "remarks";
        }

        if (lower.Contains("seal identification"))
        {
            yield return "seal_identification";
            yield return "seal_id";
        }

        if (lower.Contains("belong to"))
        {
            yield return "belong_to";
            yield return "belongto";
        }

        if (lower.Contains("address"))
        {
            yield return "address";
        }

        if (lower.Contains("pincode"))
        {
            yield return "pincode";
            yield return "pin_code";
        }

        if (lower.Contains("mobile"))
        {
            yield return "mobile";
        }

        if (lower.Contains("manufacturer"))
        {
            yield return "manufacturer";
        }

        var normalized = Regex.Replace(lower, "[^a-z0-9]+", "_").Trim('_');
        if (!string.IsNullOrWhiteSpace(normalized)
            && normalized.Length >= 4
            && normalized is not ("address" or "mobile" or "remarks"))
        {
            yield return normalized;
        }
    }

    private static async Task<ILocator> FindSelect2ComboboxByLabelsAsync(IPage page, string[] labels)
    {
        foreach (var label in labels)
        {
            foreach (var key in SelectKeysForLabel(label))
            {
                var byAriaOwns = page.Locator($"span.select2-selection[aria-owns='select2-{key}-results']");
                if (await byAriaOwns.CountAsync() > 0)
                {
                    return byAriaOwns.First;
                }

                var byAriaLabelledBy = page.Locator($"span.select2-selection[aria-labelledby='select2-{key}-container']");
                if (await byAriaLabelledBy.CountAsync() > 0)
                {
                    return byAriaLabelledBy.First;
                }
            }

            foreach (var select in await FindSelectElementsByLabelsAsync(page, [label]))
            {
                var selectId = await select.GetAttributeAsync("id");
                var selectName = await select.GetAttributeAsync("name");
                foreach (var key in new[] { selectId, selectName }.Where(static k => !string.IsNullOrWhiteSpace(k)))
                {
                    var byAriaOwns = page.Locator($"span.select2-selection[aria-owns='select2-{key}-results']");
                    if (await byAriaOwns.CountAsync() > 0)
                    {
                        return byAriaOwns.First;
                    }

                    var byAriaLabelledBy = page.Locator($"span.select2-selection[aria-labelledby='select2-{key}-container']");
                    if (await byAriaLabelledBy.CountAsync() > 0)
                    {
                        return byAriaLabelledBy.First;
                    }
                }

                if (!string.IsNullOrWhiteSpace(selectId))
                {
                    var sibling = page.Locator(
                        $"xpath=//select[@id='{selectId}']/following-sibling::span[contains(@class,'select2-container')]//span[contains(@class,'select2-selection')]");
                    if (await sibling.CountAsync() > 0)
                    {
                        return sibling.First;
                    }
                }
            }
        }

        throw new InvalidOperationException(
            $"Could not find DOCA Select2 dropdown for: {string.Join(" / ", labels)}");
    }

    private static async Task<bool> TryClickSelect2OptionAsync(IPage page, string value)
    {
        var options = page.Locator(".select2-container--open .select2-results__option[role='option']");
        var count = await options.CountAsync();
        var normalizedValue = NormalizeMatchText(value);

        for (var index = 0; index < count; index++)
        {
            var option = options.Nth(index);
            var text = NormalizeMatchText(await option.InnerTextAsync());
            if (text.Contains(normalizedValue, StringComparison.OrdinalIgnoreCase)
                || normalizedValue.Contains(text, StringComparison.OrdinalIgnoreCase))
            {
                await option.ClickAsync();
                return true;
            }
        }

        var highlighted = page.Locator(".select2-container--open .select2-results__option--highlighted");
        if (await highlighted.CountAsync() > 0)
        {
            await highlighted.First.ClickAsync();
            return true;
        }

        return false;
    }

    private static string NormalizeMatchText(string value) =>
        Regex.Replace(value.Trim(), "\\s+", " ");
}
