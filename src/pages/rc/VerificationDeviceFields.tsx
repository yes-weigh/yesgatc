import React, { useEffect, useMemo, useRef } from 'react';
import { FileText, IndianRupee, Plus, Receipt, Trash2 } from 'lucide-react';
import { ProductSelect } from '../../components/ProductSelect';
import { ProductDetailsSpecs } from '../../components/ProductDetailsSpecs';
import { ManufacturingYearPicker } from '../../components/ManufacturingYearPicker';
import { UploadField } from '../admin/productFormUi';
import { useAppContext } from '../../context/AppContext';
import {
  DEFAULT_RC_FEES_STRUCTURE,
  formatRcFeeAmount,
  rcVerificationFeeQuote,
  sumRcVerificationFees,
} from '../../lib/rcProfileFields';
import {
  mpeStringFromProduct,
  verificationLocationLabel,
  type DeviceRvDocumentsState,
  type DeviceVerificationImagesState,
  type VerificationDeviceRowValues,
} from '../../lib/siteCalibrationProfileFields';
import {
  emptyDeviceImageSlot,
  emptyDeviceVerificationImagesState,
  isVerificationImageRequired,
  VERIFICATION_IMAGE_CONFIG,
  VERIFICATION_IMAGE_KINDS,
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
      <img src={config.placeholderSrc} alt="" className="verification-image-col-head-icon" />
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
      placeholderSrc={config.placeholderSrc}
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
  /** Self verification — manual device entry only, no registered customer devices. */
  manualEntryOnly?: boolean;
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
  manualEntryOnly = false,
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
  const useSelfFees = verificationSubject === 'self';
  const fees = feesStructure ?? DEFAULT_RC_FEES_STRUCTURE;

  const includedDevices = useMemo(
    () => devices.filter(device => device.included),
    [devices],
  );

  const deviceFeeLines = useMemo(() => {
    if (!isRv) return [];
    return includedDevices.map((row, index) => {
      const product = selectedProduct(products, row);
      const quote = rcVerificationFeeQuote(fees, verificationLocation, product, verificationSubject);
      return {
        localId: row.localId,
        label: row.productName.trim() || row.serialNumber.trim() || `Device ${index + 1}`,
        serialNumber: row.serialNumber.trim(),
        ...quote,
      };
    });
  }, [fees, includedDevices, isRv, products, verificationLocation, verificationSubject]);

  const totalFees = useMemo(
    () => sumRcVerificationFees(deviceFeeLines),
    [deviceFeeLines],
  );

  const showFeesSummary = isRv && includedDevices.length > 0;
  const showFeeColumn = isRv && (Boolean(verificationLocation) || useSelfFees);
  const canCalculateFees = Boolean(verificationLocation) || useSelfFees;

  const sealLabelForRow = (row: VerificationDeviceRowValues) =>
    readOnly
      ? row.sealIdentificationNumber
      : laboratorySealIdentification || row.sealIdentificationNumber;

  const includedCount = devices.filter(d => d.included).length;
  const allIncluded = devices.length > 0 && includedCount === devices.length;
  const someIncluded = includedCount > 0 && !allIncluded;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someIncluded;
    }
  }, [someIncluded, allIncluded, devices.length]);

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
    });
  };

  if (devices.length === 0) {
    return (
      <div className="verification-devices-empty">
        <p className="text-muted text-sm mb-3">
          {manualEntryOnly
            ? 'Add a device to verify.'
            : 'This customer has no registered devices yet.'}
        </p>
        {!readOnly && (
          <button
            type="button"
            className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"
            onClick={onDeviceAdd}
            disabled={locked}
          >
            <Plus size={15} /> Add device
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="verification-devices-panel">
      <div className="verification-devices-head">
        <div>
          <p className="site-calibration-details-heading mb-0">Devices to verify</p>
          {isRv && (
            <p className="verification-rv-hint text-muted text-xs mt-1 mb-0">
              Re-verification requires year of manufacturing and old certificate &amp; invoice for each device.
            </p>
          )}
          {createMode && (
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
          {!readOnly && laboratorySealIdentification && (
            <p className="text-muted text-xs mt-1 mb-0">
              Seal ID is prefilled from Laboratory ({laboratorySealIdentification}).
            </p>
          )}
        </div>
      </div>

      {createMode && devices.length > 1 && (
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
                {createMode && devices.length > 1 ? (
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
              <th>MPE</th>
              <th>Seal ID</th>
              {isRv && <th className="verification-devices-col-mfg-year">Mfg year</th>}
              {VERIFICATION_IMAGE_KINDS.map(kind => (
                <th key={kind} className="verification-devices-col-image">
                  <VerificationImageColumnHead kind={kind} verificationType={verificationType} />
                </th>
              ))}
              {isRv && RV_DOCUMENT_KINDS.map(kind => (
                <th key={kind} className="verification-devices-col-image">
                  <RvDocumentColumnHead kind={kind} />
                </th>
              ))}
              {showFeeColumn && (
                <th className="verification-devices-col-fee">
                  <span className="verification-image-col-head">
                    <IndianRupee size={15} aria-hidden />
                    <span className="verification-image-col-head-label">Fee</span>
                  </span>
                </th>
              )}
              <th className="verification-devices-col-actions" />
            </tr>
          </thead>
          <tbody>
            {devices.map((row, index) => {
              const images = deviceImages[row.localId] ?? emptyDeviceVerificationImagesState();
              const rvDocuments = deviceRvImages[row.localId] ?? emptyDeviceRvDocumentsState();
              const product = selectedProduct(products, row);
              const feeQuote = isRv
                ? rcVerificationFeeQuote(fees, verificationLocation, product, verificationSubject)
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
                      />
                      {product && (
                        <ProductDetailsSpecs
                          product={product}
                          embedded
                          className="verification-device-product-details"
                        />
                      )}
                    </div>
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input-field input-field--table"
                      placeholder="Serial number"
                      value={row.serialNumber}
                      onChange={e => onDeviceChange(row.localId, { serialNumber: e.target.value })}
                      disabled={locked || !row.included}
                    />
                  </td>
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
                  {VERIFICATION_IMAGE_KINDS.map(kind => (
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
                  {isRv && RV_DOCUMENT_KINDS.map(kind => (
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
                        <span className="verification-device-fee">{formatRcFeeAmount(feeQuote.amount)}</span>
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

      <div className="verification-devices-mobile">
        {devices.map((row, index) => {
          const images = deviceImages[row.localId] ?? emptyDeviceVerificationImagesState();
          const rvDocuments = deviceRvImages[row.localId] ?? emptyDeviceRvDocumentsState();
          const product = selectedProduct(products, row);
          const feeQuote = isRv
            ? rcVerificationFeeQuote(fees, verificationLocation, product, verificationSubject)
            : null;

          return (
            <div
              key={row.localId}
              className={`verification-device-card${row.included ? '' : ' verification-device-card--skipped'}`}
            >
              <div className="verification-device-card-head">
                <label className="verification-device-check">
                  <input
                    type="checkbox"
                    checked={row.included}
                    onChange={e => onDeviceChange(row.localId, { included: e.target.checked })}
                    disabled={locked}
                  />
                  <span>Device {index + 1}</span>
                </label>
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
              </div>

              <div className="verification-device-card-body">
                <div className="form-group mb-0">
                  <label htmlFor={`verification-mobile-product-${row.localId}`}>Product</label>
                  <ProductSelect
                    products={products}
                    inputId={`verification-mobile-product-${row.localId}`}
                    value={{ productId: row.productId, productName: row.productName }}
                    onChange={next => handleProductChange(row.localId, next)}
                    disabled={locked || !row.included}
                  />
                  {product && (
                    <ProductDetailsSpecs
                      product={product}
                      embedded
                      className="verification-device-product-details"
                    />
                  )}
                </div>

                <div className="form-group mb-0">
                  <label htmlFor={`verification-mobile-serial-${row.localId}`}>Serial number</label>
                  <input
                    id={`verification-mobile-serial-${row.localId}`}
                    type="text"
                    className="input-field"
                    value={row.serialNumber}
                    onChange={e => onDeviceChange(row.localId, { serialNumber: e.target.value })}
                    disabled={locked || !row.included}
                  />
                </div>

                <div className="form-group mb-0">
                  <label htmlFor={`verification-mobile-mpe-${row.localId}`}>MPE</label>
                  <input
                    id={`verification-mobile-mpe-${row.localId}`}
                    type="number"
                    step="any"
                    className="input-field"
                    value={row.maximumPermissibleError}
                    onChange={e => onDeviceChange(row.localId, { maximumPermissibleError: e.target.value })}
                    disabled={locked || !row.included}
                  />
                </div>

                <div className="form-group mb-0">
                  <label htmlFor={`verification-mobile-seal-${row.localId}`}>Seal identification number</label>
                  <input
                    id={`verification-mobile-seal-${row.localId}`}
                    type="text"
                    className="input-field input-readonly"
                    value={sealLabelForRow(row)}
                    readOnly
                    tabIndex={-1}
                    title={readOnly ? 'Seal identification at submission' : 'Managed on Laboratory page'}
                  />
                  {!readOnly && (
                    <p className="text-muted text-xs mt-1 mb-0">Update on the Laboratory page.</p>
                  )}
                </div>

                {isRv && row.included && verificationLocation && (
                  <div className="verification-device-fee-inline">
                    <span className="text-muted text-xs">Verification fee</span>
                    <strong className="verification-device-fee">
                      {feeQuote?.amount != null
                        ? formatRcFeeAmount(feeQuote.amount)
                        : feeQuote?.incompleteReason ?? '—'}
                    </strong>
                    {feeQuote?.tierLabel && feeQuote.tierLabel !== '—' && (
                      <span className="text-muted text-xs">
                        {feeQuote.tierLabel} · {verificationLocationLabel(verificationLocation)}
                      </span>
                    )}
                  </div>
                )}

                {isRv && (
                  <div className="verification-rv-device-section">
                    <p className="form-group-label mb-2">Re-verification details</p>
                    <div className="form-group mb-0">
                      <label>Year of manufacturing *</label>
                      <ManufacturingYearPicker
                        value={row.manufacturingYear}
                        onChange={year => onDeviceChange(row.localId, { manufacturingYear: year })}
                        disabled={locked || !row.included}
                        readOnly={readOnly}
                      />
                    </div>
                    <div className="form-group mb-0 verification-device-card-upload">
                      <p className="form-group-label mb-2">Previous documents</p>
                      <div className="verification-mobile-photo-list">
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
                    </div>
                  </div>
                )}

                <div className="form-group mb-0 verification-device-card-upload">
                  <p className="form-group-label mb-2">Verification photos</p>
                  <div className="verification-mobile-photo-list">
                    {VERIFICATION_IMAGE_KINDS.map(kind => (
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
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showFeesSummary && (
        <div className="verification-fees-summary">
          <div className="verification-fees-summary-head">
            <div className="flex items-center gap-2">
              <IndianRupee size={16} aria-hidden />
              <p className="verification-fees-summary-title mb-0">Verification fees</p>
            </div>
            {canCalculateFees ? (
              <span className="verification-fees-summary-location">
                {useSelfFees ? 'Self' : verificationLocationLabel(verificationLocation)}
              </span>
            ) : (
              <span className="text-muted text-xs">Select In situ or In the premises to calculate fees</span>
            )}
          </div>

          {canCalculateFees && (
            <>
              <div className="table-scroll-wrap">
                <table className="data-table verification-fees-table">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Max capacity</th>
                      <th>Fee tier</th>
                      <th className="text-right">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviceFeeLines.map(line => (
                      <tr key={line.localId}>
                        <td className="font-medium">{line.label}</td>
                        <td>{line.capacityDisplay}</td>
                        <td>{line.tierLabel}</td>
                        <td className="text-right">
                          {line.amount != null ? (
                            <span className="verification-device-fee">{formatRcFeeAmount(line.amount)}</span>
                          ) : (
                            <span className="text-muted text-xs">{line.incompleteReason ?? '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="verification-fees-total">
                <span>Total fees</span>
                <strong>{formatRcFeeAmount(totalFees)}</strong>
              </div>
            </>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="verification-devices-footer">
          <button
            type="button"
            className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"
            onClick={onDeviceAdd}
            disabled={locked}
          >
            <Plus size={15} /> Add device
          </button>
        </div>
      )}
    </div>
  );
};
