import { useEffect, useMemo, useRef, useState } from 'react';
import { ManufacturingYearPicker } from '../../components/ManufacturingYearPicker';
import {
  VerificationPhotoUploadSection,
  VerificationPhotoUploadSlot,
  type GeoStampCoordinates,
  type StampWeather,
} from '../../components/VerificationPhotoUploadSlot';
import { ovSerialChoicesForRow } from '../../lib/ovQuotaGate';
import { productUsesPasSerials, verifyPasSerialInBank } from '../../lib/pasSerialBank';
import { formatShopCapacityLine, getProductSpecifications, resolveProductSpecification } from '../../lib/productSpecifications';
import {
  SERIAL_PLATE_IMAGE_KIND,
  VERIFICATION_IMAGE_CONFIG,
  emptyDeviceImageSlot,
  type DeviceVerificationImagesState,
} from '../../lib/verificationDeviceImages';
import type { VerificationDeviceRowValues } from '../../lib/siteCalibrationProfileFields';
import type { JobType, Product } from '../../types';

export function OvSelfSerialPlatePanel({
  row,
  product,
  images,
  verificationType,
  allottedSerials,
  heldSerials = [],
  disabled,
  geoStampCoords,
  geoStampWeather,
  onSerialChange,
  onYearChange,
  onPlateSelect,
  onPlateRemove,
}: {
  row: VerificationDeviceRowValues;
  product: Product | null;
  images: DeviceVerificationImagesState;
  verificationType: JobType | '';
  allottedSerials: string[];
  heldSerials?: string[];
  disabled?: boolean;
  geoStampCoords?: GeoStampCoordinates | null;
  geoStampWeather?: StampWeather | null;
  onSerialChange: (serial: string) => void;
  onYearChange?: (year: string) => void;
  onPlateSelect: (file: File) => void;
  onPlateRemove: () => void;
}) {
  const slot = images[SERIAL_PLATE_IMAGE_KIND] ?? emptyDeviceImageSlot();
  const hasPlate = Boolean(slot.pendingFile || (slot.file && !slot.removed));
  const serialInputRef = useRef<HTMLInputElement>(null);
  const isRv = verificationType === 'RV';
  const isOv = verificationType === 'OV';
  const isPas = productUsesPasSerials(product);
  const [pasHint, setPasHint] = useState<{ tone: 'ok' | 'err' | 'muted'; text: string } | null>(null);

  const seats = useMemo(
    () => ovSerialChoicesForRow(row.serialNumber, allottedSerials, heldSerials, []),
    [row.serialNumber, allottedSerials, heldSerials],
  );

  const selectedSpecLabel = useMemo(() => {
    if (!product) return '';
    const spec = row.productSpecificationId
      ? getProductSpecifications(product).find(s => s.id === row.productSpecificationId)
      : resolveProductSpecification(product);
    return spec ? formatShopCapacityLine(spec, product.unitOfMeasurement || 'kg') : '';
  }, [product, row.productSpecificationId]);

  useEffect(() => {
    if (!hasPlate || disabled) return;
    serialInputRef.current?.focus();
  }, [hasPlate, disabled]);

  useEffect(() => {
    if (!isPas || !product) {
      setPasHint(null);
      return;
    }
    const serial = row.serialNumber.trim();
    if (!serial) {
      setPasHint({ tone: 'muted', text: 'Type the serial. Checked against the PAS number bank.' });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void verifyPasSerialInBank(serial, product)
        .then(error => {
          if (cancelled) return;
          setPasHint(
            error
              ? { tone: 'err', text: error }
              : { tone: 'ok', text: 'Serial is in the PAS number bank.' },
          );
        })
        .catch(() => {
          if (cancelled) return;
          setPasHint({ tone: 'err', text: 'Could not check PAS number bank.' });
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isPas, product, row.serialNumber]);

  return (
    <div className="ov-self-serial-plate">
      <div className="ov-self-photos-recap">
        <span>
          <strong>{row.productName.trim() || product?.name || 'Product'}</strong>
          {selectedSpecLabel ? ` · ${selectedSpecLabel}` : ''}
          {isPas ? ' · PAS' : ''}
        </span>
        <span className="text-muted text-sm">
          {isPas ? 'Photo first, then type the serial' : 'Photo first, then type or pick the serial'}
        </span>
      </div>

      <VerificationPhotoUploadSection title="Serial number plate">
        <VerificationPhotoUploadSlot
          slotKey={SERIAL_PLATE_IMAGE_KIND}
          label={VERIFICATION_IMAGE_CONFIG[SERIAL_PLATE_IMAGE_KIND].label}
          required
          file={slot.file}
          uploading={slot.uploading}
          progress={slot.progress}
          disabled={disabled}
          geoStamp
          geoStampCoords={geoStampCoords}
          geoStampWeather={geoStampWeather}
          onSelect={onPlateSelect}
          onRemove={onPlateRemove}
        />
      </VerificationPhotoUploadSection>

      <div className="form-group mb-0 ov-self-serial-edit">
        <label htmlFor="ov-self-serial-input">Serial number *</label>
        <input
          id="ov-self-serial-input"
          ref={serialInputRef}
          type="text"
          className="input-field text-mono"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={hasPlate ? 'Type serial from the plate' : 'Add plate photo first'}
          value={row.serialNumber}
          readOnly={disabled || !hasPlate}
          onChange={e => onSerialChange(e.target.value)}
        />
        {pasHint ? (
          <p className={`ov-self-serial-hint ov-self-serial-hint--${pasHint.tone}`} role="status">
            {pasHint.text}
          </p>
        ) : null}
      </div>

      {isRv && onYearChange ? (
        <div className="ov-self-serial-year">
          <span className="ov-self-serial-year-label">
            Year of manufacturing <span className="verification-device-required">*</span>
          </span>
          <ManufacturingYearPicker
            value={row.manufacturingYear}
            onChange={onYearChange}
            disabled={disabled || !hasPlate}
          />
        </div>
      ) : null}

      {isOv && !isPas ? (
        <div className="ov-self-allotted">
          <p className="ov-self-allotted-title mb-0">Allotted serials</p>
          {seats.length === 0 ? (
            <p className="text-muted text-sm mb-0">No allotted serials left.</p>
          ) : (
            <ul className="admin-setting-serial-seats ov-self-allotted-grid">
              {seats.map(serial => {
                const picked = row.serialNumber.trim() === serial;
                return (
                  <li key={serial}>
                    <button
                      type="button"
                      className={`admin-setting-serial-seat text-mono${picked ? ' admin-setting-serial-seat--picked' : ''}`}
                      aria-pressed={picked}
                      disabled={disabled || !hasPlate}
                      onClick={() => onSerialChange(picked ? '' : serial)}
                    >
                      {serial}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
