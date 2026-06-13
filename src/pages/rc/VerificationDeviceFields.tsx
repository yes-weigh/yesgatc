import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { focusMobileTextInput, getVerificationSerialInput } from '../../lib/focusMobileInput';
import { FileText, IndianRupee, Plus, Receipt, Scale, Trash2 } from 'lucide-react';
import { ProductSelect } from '../../components/ProductSelect';
import { ProductDetailsSpecs } from '../../components/ProductDetailsSpecs';
import { ManufacturingYearPicker } from '../../components/ManufacturingYearPicker';
import { UploadField } from '../admin/productFormUi';
import { useAppContext } from '../../context/AppContext';
import {
  DEFAULT_RC_FEES_STRUCTURE,
  defaultRvServiceFee,
  rcVerificationFeeQuote,
  rvGatewayFee,
  rvTdsFee,
} from '../../lib/rcProfileFields';
import { VerificationFeeBreakdown } from '../../components/VerificationFeeBreakdown';
import {
  mpeStringFromProduct,
  type DeviceRvDocumentsState,
  type DeviceVerificationImagesState,
  type VerificationDeviceRowValues,
} from '../../lib/siteCalibrationProfileFields';
import {
  emptyDeviceImageSlot,
  emptyDeviceVerificationImagesState,
  isVerificationImageRequired,
  VERIFICATION_IMAGE_CONFIG,
  verificationImageKindsForSession,
  verificationImageHint,
  type DeviceImageSlotState,
  type VerificationImageKind,
} from '../../lib/verificationDeviceImages';
import {
  emptyDeviceRvDocumentsState,
  RV_DOCUMENT_CONFIG,
  RV_DOCUMENT_KINDS,
  type RvDocumentKind,
} from '../../lib/verificationRvDeviceImages';
import type { JobType, Product, RcFeesStructure, VerificationLocation } from '../../types';

const VerificationImageColumnHead: React.FC<{
  kind: VerificationImageKind;
  verificationType?: JobType | '';
}> = ({ kind, verificationType = 'OV' }) => {
  const config = VERIFICATION_IMAGE_CONFIG[kind];
  const required = isVerificationImageRequired(kind, verificationType);
  return (
    <div
      className="verification-image-col-head"
      title={`${config.label}${required ? ' (required for submit)' : ' (optional)'}`}
    >
      <span className="verification-image-col-head-label">
        {config.shortLabel}
        {required ? ' *' : ''}
      </span>
    </div>
  );
};

const DeviceVerificationUpload: React.FC<{
  kind: VerificationImageKind;
  verificationType?: JobType | '';
  image: DeviceImageSlotState;
  disabled: boolean;
  hideLabel?: boolean;
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}> = ({ kind, verificationType = 'OV', image, disabled, hideLabel = false, onSelect, onRemove }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const config = VERIFICATION_IMAGE_CONFIG[kind];
  const slot = image ?? emptyDeviceImageSlot();

  return (
    <UploadField
      label={config.label}
      hint={verificationImageHint(kind, verificationType)}
      file={slot.file}
      uploading={slot.uploading}
      progress={slot.progress}
      accept="image/jpeg,image/png,image/webp,image/gif"
      uploadLabel="Upload"
      formats="Max 15 MB"
      inputRef={inputRef}
      onSelect={onSelect}
      onRemove={onRemove}
      submitting={disabled}
      variant="image"
      compact
      iconActions
      hideLabel={hideLabel}
    />
  );
};

const RvDocumentColumnHead: React.FC<{ kind: RvDocumentKind }> = ({ kind }) => {
  const config = RV_DOCUMENT_CONFIG[kind];
  const Icon = kind === 'oldInvoice' ? Receipt : FileText;
  return (
    <div className="verification-image-col-head" title={config.label}>
      <Icon size={16} className="verification-rv-doc-head-icon" aria-hidden />
      <span className="verification-image-col-head-label">{config.shortLabel}</span>
    </div>
  );
};

const RvDocumentUpload: React.FC<{
  kind: RvDocumentKind;
  document: DeviceImageSlotState;
  disabled: boolean;
  hideLabel?: boolean;
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}> = ({ kind, document, disabled, hideLabel = false, onSelect, onRemove }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const config = RV_DOCUMENT_CONFIG[kind];
  const slot = document ?? emptyDeviceImageSlot();

  return (
    <UploadField
      label={config.label}
      hint={config.hint}
      file={slot.file}
      uploading={slot.uploading}
      progress={slot.progress}
      accept="image/jpeg,image/png,image/webp,image/gif"
      uploadLabel="Upload"
      formats="Max 15 MB"
      inputRef={inputRef}
      onSelect={onSelect}
      onRemove={onRemove}
      submitting={disabled}
      variant="image"
      compact
      iconActions
      hideLabel={hideLabel}
    />
  );
};

type VerificationDeviceFieldsProps = {
  devices: VerificationDeviceRowValues[];
  deviceImages: Record<string, DeviceVerificationImagesState>;
  deviceRvImages?: Record<string, DeviceRvDocumentsState>;
  verificationType?: JobType | '';
  onDeviceChange: (localId: string, patch: Partial<VerificationDeviceRowValues>) => void;
  onDeviceAdd: () => void;
  onDeviceRemove: (localId: string) => void;
  onDeviceImageSelect: (localId: string, kind: VerificationImageKind, file: File) => void;
  onDeviceImageRemove: (localId: string, kind: VerificationImageKind) => void;
  onDeviceRvDocumentSelect?: (localId: string, kind: RvDocumentKind, file: File) => void;
  onDeviceRvDocumentRemove?: (localId: string, kind: RvDocumentKind) => void;
  submitting: boolean;
  /** New verification — multiple devices can be saved as separate table rows. */
  createMode?: boolean;
  /** Compact layout for the verification wizard (mobile-first). */
  compact?: boolean;
  /** When false, device details only — photos are captured on the photos sub-stage. */
  includeEvidence?: boolean;
  /** Hide add-device controls (wizard adds devices from the instruments step). */
  allowAddDevice?: boolean;
  /** Show only one device row/card (per-device wizard sub-stage). */
  visibleDeviceLocalId?: string;
  /** Tile layout — hide outer panel chrome; parent provides section title. */
  embedded?: boolean;
  /** Self verification — manual device entry only, no registered customer devices. */
  manualEntryOnly?: boolean;
  /** Increment to focus the first included device serial field (wizard navigation). */
  focusSerialRequest?: number;
  readOnly?: boolean;
  laboratorySealIdentification?: string;
  verificationLocation?: VerificationLocation | '';
  verificationSubject?: 'self' | 'customer';
  feesStructure?: RcFeesStructure;
};

function selectedProduct(products: Product[], row: VerificationDeviceRowValues): Product | null {
  return products.find(p => p.id === row.productId) ?? null;
}

export const VerificationDeviceFields: React.FC<VerificationDeviceFieldsProps> = ({
  devices,
  deviceImages,
  deviceRvImages = {},
  verificationType = 'OV',
  onDeviceChange,
  onDeviceAdd,
  onDeviceRemove,
  onDeviceImageSelect,
  onDeviceImageRemove,
  onDeviceRvDocumentSelect,
  onDeviceRvDocumentRemove,
  submitting,
  createMode = false,
  compact = false,
  includeEvidence = true,
  allowAddDevice = true,
  visibleDeviceLocalId,
  embedded = false,
  manualEntryOnly = false,
  focusSerialRequest = 0,
  readOnly = false,
  laboratorySealIdentification = '',
  verificationLocation = '',
  verificationSubject = 'customer',
  feesStructure,
}) => {
  const { products } = useAppContext();
  const selectAllRef = useRef<HTMLInputElement>(null);
  const locked = submitting || readOnly;
  const isRv = verificationType === 'RV';
  const fees = feesStructure ?? DEFAULT_RC_FEES_STRUCTURE;
  const visibleDevices = visibleDeviceLocalId
    ? devices.filter(row => row.localId === visibleDeviceLocalId)
    : devices;
  const singleDeviceMode = Boolean(visibleDeviceLocalId);

  const buildServiceFeeProps = (row: VerificationDeviceRowValues) => ({
    value: row.serviceFee,
    readOnly: locked || !row.included,
    onChange: locked || !row.included
      ? undefined
      : (value: string) => onDeviceChange(row.localId, { serviceFee: value }),
    inputId: `verification-service-fee-${row.localId}`,
    ariaLabel: 'Service fee',
  });

  const buildAdditionalFeeProps = (row: VerificationDeviceRowValues) => ({
    value: row.additionalFee,
    readOnly: locked || !row.included,
    onChange: locked || !row.included
      ? undefined
      : (value: string) => onDeviceChange(row.localId, { additionalFee: value }),
    inputId: `verification-additional-fee-${row.localId}`,
    ariaLabel: 'Additional fee',
  });

  const showFeeColumn = isRv;

  const sealLabelForRow = (row: VerificationDeviceRowValues) =>
    readOnly
      ? row.sealIdentificationNumber
      : laboratorySealIdentification || row.sealIdentificationNumber;

  const includedCount = visibleDevices.filter(d => d.included).length;
  const allIncluded = visibleDevices.length > 0 && includedCount === visibleDevices.length;
  const someIncluded = includedCount > 0 && !allIncluded;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someIncluded;
    }
  }, [someIncluded, allIncluded, visibleDevices.length]);

  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const visibleDeviceLocalIdRef = useRef(visibleDeviceLocalId);
  visibleDeviceLocalIdRef.current = visibleDeviceLocalId;
  const lastHandledSerialFocusRef = useRef(0);

  useLayoutEffect(() => {
    if (!focusSerialRequest || locked) return;
    if (lastHandledSerialFocusRef.current === focusSerialRequest) return;
    lastHandledSerialFocusRef.current = focusSerialRequest;

    const tryFocus = () => {
      const rows = devicesRef.current;
      const visibleId = visibleDeviceLocalIdRef.current;
      const targetRow = visibleId
        ? rows.find(d => d.localId === visibleId)
        : rows.find(d => d.included) ?? rows[0];
      if (!targetRow) return;
      const input = getVerificationSerialInput(targetRow.localId);
      if (input) focusMobileTextInput(input);
    };

    tryFocus();
    const retrySoonId = window.setTimeout(tryFocus, 120);
    const retryLateId = window.setTimeout(tryFocus, 280);
    return () => {
      window.clearTimeout(retrySoonId);
      window.clearTimeout(retryLateId);
    };
  }, [focusSerialRequest, locked]);

  const setAllIncluded = (included: boolean) => {
    for (const device of devices) {
      onDeviceChange(device.localId, { included });
    }
  };

  const handleFileInput = (
    localId: string,
    kind: VerificationImageKind,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onDeviceImageSelect(localId, kind, file);
  };

  const handleRvDocumentInput = (
    localId: string,
    kind: RvDocumentKind,
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onDeviceRvDocumentSelect?.(localId, kind, file);
  };

  const handleProductChange = (localId: string, next: { productId: string; productName: string }) => {
    const product = products.find(p => p.id === next.productId) ?? null;
    onDeviceChange(localId, {
      productId: next.productId,
      productName: next.productName,
      maximumPermissibleError: mpeStringFromProduct(product),
      ...(isRv ? { serviceFee: defaultRvServiceFee(product) } : {}),
    });
  };

  if (visibleDevices.length === 0) {
    return (
      <div className={`verification-devices-empty${compact ? ' verification-devices-empty--compact' : ''}`}>
        <p className="text-muted text-sm mb-0">
          {manualEntryOnly
            ? allowAddDevice
              ? 'Add a device to verify.'
              : 'No instrument yet — capture photos on the previous step first.'
            : allowAddDevice
              ? 'This customer has no registered devices yet.'
              : 'No instrument loaded — capture photos on the previous sub-step first.'}
        </p>
        {!readOnly && allowAddDevice && (
          <button
            type="button"
            className={`verification-devices-add-btn${compact ? ' verification-devices-add-btn--compact' : ' btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5'}`}
            onClick={onDeviceAdd}
            disabled={locked}
          >
            <Plus size={15} aria-hidden /> Add device
          </button>
        )}
      </div>
    );
  }

  const panelClassName = [
    'verification-devices-panel',
    compact ? 'verification-devices-panel--compact' : '',
    embedded ? 'verification-devices-panel--embedded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={panelClassName}>
      {!embedded && (
      <header className="verification-devices-panel-head">
        <span className="verification-devices-panel-head-icon" aria-hidden>
          <Scale size={18} />
        </span>
        <div className="verification-devices-panel-head-text">
          <h3 className="verification-devices-panel-title">
            {compact
              ? includeEvidence
                ? 'Devices & evidence'
                : singleDeviceMode
                  ? 'Instrument details'
                  : 'Instrument details'
              : 'Devices to verify'}
          </h3>
          {compact && createMode && includedCount > 0 && !singleDeviceMode && (
            <p className="verification-devices-panel-meta mb-0">
              {includedCount} selected · {includedCount} draft row{includedCount !== 1 ? 's' : ''}
            </p>
          )}
          {!compact && isRv && (
            <p className="verification-rv-hint text-muted text-xs mt-1 mb-0">
              Re-verification requires year of manufacturing and old certificate for each device. Old invoice is optional.
            </p>
          )}
          {!compact && createMode && (
            <p className="verification-devices-batch-hint text-muted text-xs mt-1 mb-0">
              Tick the devices to include. Each selected device is saved as a draft row in the verification table.
              {includedCount > 0 && (
                <span className="verification-devices-batch-count">
                  {' '}
                  {includedCount} selected → {includedCount} table row{includedCount !== 1 ? 's' : ''}.
                </span>
              )}
            </p>
          )}
          {!compact && !readOnly && laboratorySealIdentification && (
            <p className="text-muted text-xs mt-1 mb-0">
              Seal ID is prefilled from Laboratory ({laboratorySealIdentification}).
            </p>
          )}
        </div>
        {compact && createMode && visibleDevices.length > 1 && !readOnly && !singleDeviceMode && (
          <div className="verification-devices-bulk-actions verification-devices-bulk-actions--compact">
            <button
              type="button"
              className="verification-devices-bulk-btn"
              onClick={() => setAllIncluded(true)}
              disabled={locked || allIncluded}
            >
              All
            </button>
            <button
              type="button"
              className="verification-devices-bulk-btn"
              onClick={() => setAllIncluded(false)}
              disabled={locked || includedCount === 0}
            >
              None
            </button>
          </div>
        )}
      </header>
      )}

      {!embedded && !compact && createMode && visibleDevices.length > 1 && !singleDeviceMode && (
        <div className="verification-devices-bulk-actions">
          <button
            type="button"
            className="btn btn-secondary text-xs py-1 px-2.5"
            onClick={() => setAllIncluded(true)}
            disabled={locked || allIncluded}
          >
            Select all
          </button>
          <button
            type="button"
            className="btn btn-secondary text-xs py-1 px-2.5"
            onClick={() => setAllIncluded(false)}
            disabled={locked || includedCount === 0}
          >
            Clear all
          </button>
        </div>
      )}

      <div className="verification-devices-desktop table-scroll-wrap">
        <table className={`data-table data-table--verification-devices${isRv ? ' data-table--verification-devices-rv' : ''}`}>
          <thead>
            <tr>
              <th className="verification-devices-col-check">
                {createMode && visibleDevices.length > 1 && !singleDeviceMode ? (
                  <label className="verification-device-check verification-device-check--header" title="Select all devices">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allIncluded}
                      onChange={e => setAllIncluded(e.target.checked)}
                      disabled={locked}
                      aria-label="Select all devices"
                    />
                    <span className="sr-only">Select all</span>
                  </label>
                ) : (
                  'Verify'
                )}
              </th>
              <th>Product</th>
              <th>Serial</th>
              {isRv && <th className="verification-devices-col-mfg-year">Mfg year</th>}
              <th>MPE</th>
              <th>Seal ID</th>
              {includeEvidence && verificationImageKindsForSession(verificationType).map(kind => (
                <th key={kind} className="verification-devices-col-image">
                  <VerificationImageColumnHead kind={kind} verificationType={verificationType} />
                </th>
              ))}
              {includeEvidence && isRv && RV_DOCUMENT_KINDS.map(kind => (
                <th key={kind} className="verification-devices-col-image">
                  <RvDocumentColumnHead kind={kind} />
                </th>
              ))}
              {showFeeColumn && (
                <th className="verification-devices-col-fee">
                  <span className="verification-image-col-head">
                    <IndianRupee size={15} aria-hidden />
                    <span className="verification-image-col-head-label">Fee (GST)</span>
                  </span>
                </th>
              )}
              <th className="verification-devices-col-actions" />
            </tr>
          </thead>
          <tbody>
            {visibleDevices.map((row, index) => {
              const images = deviceImages[row.localId] ?? emptyDeviceVerificationImagesState();
              const rvDocuments = deviceRvImages[row.localId] ?? emptyDeviceRvDocumentsState();
              const product = selectedProduct(products, row);
              const feeQuote = isRv
                ? rcVerificationFeeQuote(
                    fees,
                    verificationLocation,
                    product,
                    verificationSubject,
                    verificationType,
                  )
                : null;

              return (
                <tr key={row.localId} className={row.included ? '' : 'verification-device-row--skipped'}>
                  <td className="verification-devices-col-check">
                    <label className="verification-device-check">
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={e => onDeviceChange(row.localId, { included: e.target.checked })}
                        disabled={locked}
                      />
                    </label>
                  </td>
                  <td className="verification-devices-col-product">
                    <div className="verification-device-product-cell">
                      <ProductSelect
                        products={products}
                        inputId={`verification-product-${row.localId}`}
                        value={{ productId: row.productId, productName: row.productName }}
                        onChange={next => handleProductChange(row.localId, next)}
                        disabled={locked || !row.included}
                        showCapacitySpecs
                      />
                      {product && (
                        <ProductDetailsSpecs
                          product={product}
                          dense={compact}
                          embedded={compact}
                          className="verification-device-product-details"
                        />
                      )}
                    </div>
                  </td>
                  <td>
                    <input
                      id={`verification-serial-${row.localId}`}
                      type="text"
                      className="input-field input-field--table"
                      placeholder="Serial number"
                      value={row.serialNumber}
                      onChange={e => onDeviceChange(row.localId, { serialNumber: e.target.value })}
                      disabled={locked || !row.included}
                      autoComplete="off"
                      enterKeyHint="next"
                    />
                  </td>
                  {isRv && (
                    <td className="verification-devices-col-mfg-year">
                      <ManufacturingYearPicker
                        value={row.manufacturingYear}
                        onChange={year => onDeviceChange(row.localId, { manufacturingYear: year })}
                        disabled={locked || !row.included}
                        readOnly={readOnly}
                      />
                    </td>
                  )}
                  <td>
                    <input
                      type="number"
                      step="any"
                      className="input-field input-field--table"
                      placeholder="MPE"
                      value={row.maximumPermissibleError}
                      onChange={e => onDeviceChange(row.localId, { maximumPermissibleError: e.target.value })}
                      disabled={locked || !row.included}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input-field input-field--table input-readonly"
                      value={sealLabelForRow(row)}
                      readOnly
                      tabIndex={-1}
                      aria-label="Seal identification"
                      title={readOnly ? 'Seal identification at submission' : 'Managed on Laboratory page'}
                    />
                  </td>
                  {includeEvidence && verificationImageKindsForSession(verificationType).map(kind => (
                    <td key={kind} className="verification-devices-col-image">
                      <DeviceVerificationUpload
                        kind={kind}
                        verificationType={verificationType}
                        image={images[kind]}
                        disabled={locked || !row.included}
                        hideLabel
                        onSelect={e => handleFileInput(row.localId, kind, e)}
                        onRemove={() => onDeviceImageRemove(row.localId, kind)}
                      />
                    </td>
                  ))}
                  {includeEvidence && isRv && RV_DOCUMENT_KINDS.map(kind => (
                    <td key={kind} className="verification-devices-col-image">
                      <RvDocumentUpload
                        kind={kind}
                        document={rvDocuments[kind]}
                        disabled={locked || !row.included}
                        hideLabel
                        onSelect={e => handleRvDocumentInput(row.localId, kind, e)}
                        onRemove={() => onDeviceRvDocumentRemove?.(row.localId, kind)}
                      />
                    </td>
                  ))}
                  {showFeeColumn && (
                    <td className="verification-devices-col-fee">
                      {!row.included ? (
                        <span className="text-muted text-sm">—</span>
                      ) : feeQuote?.amount != null ? (
                        <VerificationFeeBreakdown
                          baseAmount={feeQuote.amount}
                          variant="cell"
                          tdsAmount={rvTdsFee(product)}
                          gatewayFeeAmount={rvGatewayFee(product)}
                          serviceFee={buildServiceFeeProps(row)}
                          additionalFee={buildAdditionalFeeProps(row)}
                        />
                      ) : (
                        <span className="text-muted text-xs">{feeQuote?.incompleteReason ?? '—'}</span>
                      )}
                    </td>
                  )}
                  <td className="verification-devices-col-actions text-right">
                    {row.isNewDevice && !readOnly && (
                      <button
                        type="button"
                        className="btn-icon text-red"
                        onClick={() => onDeviceRemove(row.localId)}
                        disabled={locked}
                        title="Remove device"
                        aria-label={`Remove device ${index + 1}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={`verification-devices-mobile${compact ? ' verification-devices-mobile--compact' : ''}`}>
        {visibleDevices.map((row, index) => {
          const images = deviceImages[row.localId] ?? emptyDeviceVerificationImagesState();
          const rvDocuments = deviceRvImages[row.localId] ?? emptyDeviceRvDocumentsState();
          const product = selectedProduct(products, row);
          const feeQuote = isRv
            ? rcVerificationFeeQuote(
                fees,
                verificationLocation,
                product,
                verificationSubject,
                verificationType,
              )
            : null;

          return (
            <div
              key={row.localId}
              className={`verification-device-card${compact ? ' verification-device-card--compact' : ''}${row.included ? '' : ' verification-device-card--skipped'}`}
            >
              <div className="verification-device-card-head">
                {singleDeviceMode ? (
                  <span className="verification-device-card-index">
                    {compact ? `#${index + 1}` : `Device ${index + 1}`}
                  </span>
                ) : (
                  <label className="verification-device-check">
                    <input
                      type="checkbox"
                      checked={row.included}
                      onChange={e => onDeviceChange(row.localId, { included: e.target.checked })}
                      disabled={locked}
                    />
                    <span>{compact ? `#${index + 1}` : `Device ${index + 1}`}</span>
                  </label>
                )}
                {row.isNewDevice && !readOnly && (
                  <button
                    type="button"
                    className="btn-icon text-red verification-device-card-remove"
                    onClick={() => onDeviceRemove(row.localId)}
                    disabled={locked}
                    title="Remove device"
                    aria-label={`Remove device ${index + 1}`}
                  >
                    <Trash2 size={compact ? 14 : 16} />
                  </button>
                )}
              </div>

              <div className="verification-device-card-body">
                <div className="verification-device-field verification-device-field--full">
                  <label
                    className="verification-device-label"
                    htmlFor={`verification-mobile-product-${row.localId}`}
                  >
                    Product <span className="verification-device-required">*</span>
                  </label>
                  <ProductSelect
                    products={products}
                    inputId={`verification-mobile-product-${row.localId}`}
                    value={{ productId: row.productId, productName: row.productName }}
                    onChange={next => handleProductChange(row.localId, next)}
                    disabled={locked || !row.included}
                    showCapacitySpecs
                  />
                </div>

                {compact ? (
                  <>
                    <div className="verification-device-field verification-device-field--full verification-device-field--serial-hero">
                      <label
                        className="verification-device-label verification-device-label--serial-hero"
                        htmlFor={`verification-mobile-serial-${row.localId}`}
                      >
                        Serial number <span className="verification-device-required">*</span>
                      </label>
                      <input
                        id={`verification-mobile-serial-${row.localId}`}
                        type="text"
                        inputMode="text"
                        className="input-field verification-device-input verification-device-input--serial-hero"
                        placeholder="Enter serial number"
                        value={row.serialNumber}
                        onChange={e => onDeviceChange(row.localId, { serialNumber: e.target.value })}
                        disabled={locked || !row.included}
                        autoComplete="off"
                        enterKeyHint="next"
                      />
                    </div>

                    <div
                      className={[
                        'verification-device-fields-grid',
                        'verification-device-fields-grid--under-serial',
                        isRv ? 'verification-device-fields-grid--mpe-year' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="verification-device-field verification-device-field--mpe">
                        <label
                          className="verification-device-label"
                          htmlFor={`verification-mobile-mpe-${row.localId}`}
                        >
                          MPE
                        </label>
                        <input
                          id={`verification-mobile-mpe-${row.localId}`}
                          type="number"
                          step="any"
                          className="input-field verification-device-input"
                          placeholder="MPE"
                          value={row.maximumPermissibleError}
                          onChange={e =>
                            onDeviceChange(row.localId, { maximumPermissibleError: e.target.value })
                          }
                          disabled={locked || !row.included}
                        />
                      </div>

                      {isRv && (
                        <div className="verification-device-field verification-device-field--mfg-year">
                          <label className="verification-device-label">
                            Mfg year <span className="verification-device-required">*</span>
                          </label>
                          <ManufacturingYearPicker
                            value={row.manufacturingYear}
                            onChange={year => onDeviceChange(row.localId, { manufacturingYear: year })}
                            disabled={locked || !row.included}
                            readOnly={readOnly}
                          />
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div
                    className={`verification-device-fields-grid${isRv ? ' verification-device-fields-grid--with-mfg' : ''}`}
                  >
                    <div className="verification-device-field">
                      <label
                        className="verification-device-label"
                        htmlFor={`verification-mobile-serial-${row.localId}`}
                      >
                        Serial <span className="verification-device-required">*</span>
                      </label>
                      <input
                        id={`verification-mobile-serial-${row.localId}`}
                        type="text"
                        inputMode="text"
                        className="input-field verification-device-input"
                        placeholder="Serial no."
                        value={row.serialNumber}
                        onChange={e => onDeviceChange(row.localId, { serialNumber: e.target.value })}
                        disabled={locked || !row.included}
                        autoComplete="off"
                        enterKeyHint="next"
                      />
                    </div>

                    {isRv && (
                      <div className="verification-device-field verification-device-field--mfg-year">
                        <label className="verification-device-label">
                          Year <span className="verification-device-required">*</span>
                        </label>
                        <ManufacturingYearPicker
                          value={row.manufacturingYear}
                          onChange={year => onDeviceChange(row.localId, { manufacturingYear: year })}
                          disabled={locked || !row.included}
                          readOnly={readOnly}
                        />
                      </div>
                    )}

                    <div
                      className={`verification-device-field${isRv ? ' verification-device-field--mpe-narrow' : ''}`}
                    >
                      <label
                        className="verification-device-label"
                        htmlFor={`verification-mobile-mpe-${row.localId}`}
                      >
                        MPE
                      </label>
                      <input
                        id={`verification-mobile-mpe-${row.localId}`}
                        type="number"
                        step="any"
                        className="input-field verification-device-input"
                        placeholder="MPE"
                        value={row.maximumPermissibleError}
                        onChange={e => onDeviceChange(row.localId, { maximumPermissibleError: e.target.value })}
                        disabled={locked || !row.included}
                      />
                    </div>
                  </div>
                )}

                <div className="verification-device-field verification-device-field--full">
                  <label
                    className="verification-device-label"
                    htmlFor={`verification-mobile-seal-${row.localId}`}
                  >
                    Seal ID
                  </label>
                  <input
                    id={`verification-mobile-seal-${row.localId}`}
                    type="text"
                    className="input-field verification-device-input input-readonly"
                    value={sealLabelForRow(row)}
                    readOnly
                    tabIndex={-1}
                    title={readOnly ? 'Seal identification at submission' : 'Managed on Laboratory page'}
                  />
                </div>

                {product && (
                  <ProductDetailsSpecs
                    product={product}
                    dense={compact}
                    embedded={compact}
                    className="verification-device-product-details"
                  />
                )}

                {isRv && row.included && (
                  <div className="verification-device-fee-tile">
                    {feeQuote?.amount != null ? (
                      <VerificationFeeBreakdown
                        baseAmount={feeQuote.amount}
                        variant="cell"
                        tdsAmount={rvTdsFee(product)}
                        gatewayFeeAmount={rvGatewayFee(product)}
                        serviceFee={buildServiceFeeProps(row)}
                        additionalFee={buildAdditionalFeeProps(row)}
                      />
                    ) : (
                      <span className="text-muted text-xs">{feeQuote?.incompleteReason ?? '—'}</span>
                    )}
                  </div>
                )}

                {isRv && includeEvidence && (
                  <section className="verification-device-section">
                    <h4 className="verification-device-section-title">Previous docs</h4>
                    <div className={`verification-mobile-photo-list${compact ? ' verification-mobile-photo-grid' : ''}`}>
                      {RV_DOCUMENT_KINDS.map(kind => (
                        <div key={kind} className="verification-mobile-photo-item">
                          <RvDocumentColumnHead kind={kind} />
                          <RvDocumentUpload
                            kind={kind}
                            document={rvDocuments[kind]}
                            disabled={locked || !row.included}
                            hideLabel
                            onSelect={e => handleRvDocumentInput(row.localId, kind, e)}
                            onRemove={() => onDeviceRvDocumentRemove?.(row.localId, kind)}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {includeEvidence && (
                  <section className="verification-device-section">
                    <h4 className="verification-device-section-title">Verification photos</h4>
                    <div className={`verification-mobile-photo-list${compact ? ' verification-mobile-photo-grid' : ''}`}>
                      {verificationImageKindsForSession(verificationType).map(kind => (
                        <div key={kind} className="verification-mobile-photo-item">
                          <VerificationImageColumnHead kind={kind} verificationType={verificationType} />
                          <DeviceVerificationUpload
                            kind={kind}
                            verificationType={verificationType}
                            image={images[kind]}
                            disabled={locked || !row.included}
                            hideLabel
                            onSelect={e => handleFileInput(row.localId, kind, e)}
                            onRemove={() => onDeviceImageRemove(row.localId, kind)}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!readOnly && allowAddDevice && (
        <div className="verification-devices-footer">
          <button
            type="button"
            className={`verification-devices-add-btn${compact ? ' verification-devices-add-btn--compact' : ' btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5'}`}
            onClick={onDeviceAdd}
            disabled={locked}
          >
            <Plus size={15} aria-hidden /> Add device
          </button>
        </div>
      )}
    </div>
  );
};
