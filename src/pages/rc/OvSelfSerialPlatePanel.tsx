import { useEffect, useMemo, useRef, useState } from 'react';
import { ManufacturingYearPicker } from '../../components/ManufacturingYearPicker';
import {
  VerificationPhotoUploadSection,
  VerificationPhotoUploadSlot,
  type GeoStampCoordinates,
  type StampWeather,
} from '../../components/VerificationPhotoUploadSlot';
import { type OvQuotaAllotment } from '../../lib/ovQuotaGate';
import { verifyPasSerialInBank } from '../../lib/pasSerialBank';
import { formatShopCapacityLine, getProductSpecifications, resolveProductSpecification } from '../../lib/productSpecifications';
import { readSerialPlate } from '../../lib/readSerialPlate';
import {
  applyOcrSerialToPool,
  gasAllottedChoices,
  serialEntryMode,
  serialInChoiceList,
} from '../../lib/serialEntryPool';
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
  allotments,
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
  allotments?: OvQuotaAllotment[];
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
  const mode = serialEntryMode(product);
  const isPas = mode === 'pas-type';
  const isGasSelect = mode === 'gas-select' && isOv;
  const [pasHint, setPasHint] = useState<{ tone: 'ok' | 'err' | 'muted'; text: string } | null>(null);
  const [ocrHint, setOcrHint] = useState<string | null>(null);

  const seats = useMemo(
    () =>
      isGasSelect
        ? gasAllottedChoices({
            remaining: allottedSerials,
            allotments,
            heldSerials,
            product,
          })
        : [],
    [isGasSelect, allottedSerials, allotments, heldSerials, product],
  );
  const selectedSeat =
    seats.find(serial => serial.trim().toUpperCase() === row.serialNumber.trim().toUpperCase()) ?? '';

  const selectedSpecLabel = useMemo(() => {
    if (!product) return '';
    const spec = row.productSpecificationId
      ? getProductSpecifications(product).find(s => s.id === row.productSpecificationId)
      : resolveProductSpecification(product);
    return spec ? formatShopCapacityLine(spec, product.unitOfMeasurement || 'kg') : '';
  }, [product, row.productSpecificationId]);

  useEffect(() => {
    if (disabled || isGasSelect) return;
    serialInputRef.current?.focus();
  }, [disabled, isGasSelect]);

  useEffect(() => {
    if (!isPas || !product) {
      setPasHint(null);
      return;
    }
    const serial = row.serialNumber.trim();
    if (!serial) {
      setPasHint({ tone: 'muted', text: 'Type the serial. Checked against this product’s PAS number bank.' });
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

  const runPasVerifyNow = () => {
    if (!isPas || !product) return;
    const serial = row.serialNumber.trim();
    if (!serial) return;
    void verifyPasSerialInBank(serial, product).then(error => {
      setPasHint(
        error
          ? { tone: 'err', text: error }
          : { tone: 'ok', text: 'Serial is in the PAS number bank.' },
      );
    });
  };

  const handlePlateSelect = (file: File) => {
    onPlateSelect(file);
    setOcrHint('Reading plate…');
    void readSerialPlate(file, isGasSelect ? seats : [])
      .then(read => {
        const filled = applyOcrSerialToPool({
          mode,
          ocrSerial: read.serialNumber,
          allottedMatch: read.allottedMatch,
          gasChoices: seats,
        });
        if (filled && !row.serialNumber.trim()) {
          onSerialChange(filled);
          setOcrHint(isGasSelect ? `Matched allotted serial ${filled}.` : 'Filled serial from plate photo (you can edit).');
          return;
        }
        if (filled && isGasSelect && !serialInChoiceList(row.serialNumber, seats)) {
          onSerialChange(filled);
          setOcrHint(`Matched allotted serial ${filled}.`);
          return;
        }
        setOcrHint(
          isGasSelect
            ? 'Plate photo saved. Select an allotted serial if it is not filled.'
            : 'Plate photo saved. Type the serial if it is not filled.',
        );
      })
      .catch(() => {
        setOcrHint(null);
      });
  };

  const recapHint = isPas
    ? 'Type the serial. Plate photo still required to continue.'
    : isGasSelect
      ? 'Select an allotted serial. Plate photo still required to continue.'
      : 'Type the existing serial. Plate photo still required to continue.';

  return (
    <div className="ov-self-serial-plate">
      <div className="ov-self-photos-recap">
        <span>
          <strong>{row.productName.trim() || product?.name || 'Product'}</strong>
          {selectedSpecLabel ? ` · ${selectedSpecLabel}` : ''}
          {isPas ? ' · PAS' : ' · GAS'}
        </span>
        <span className="text-muted text-sm">{recapHint}</span>
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
          onSelect={handlePlateSelect}
          onRemove={() => {
            setOcrHint(null);
            onPlateRemove();
          }}
        />
      </VerificationPhotoUploadSection>

      {ocrHint ? (
        <p className="ov-self-plate-status" role="status">
          {ocrHint}
        </p>
      ) : null}

      {isGasSelect ? (
        <div className="form-group mb-0 ov-self-serial-edit">
          <label htmlFor="ov-self-serial-select">Serial number *</label>
          <select
            id="ov-self-serial-select"
            className="input-field text-mono"
            value={selectedSeat}
            disabled={disabled}
            onChange={e => onSerialChange(e.target.value)}
          >
            <option value="">{seats.length ? 'Select allotted serial' : 'No allotted serials left'}</option>
            {seats.map(serial => (
              <option key={serial} value={serial}>
                {serial}
              </option>
            ))}
          </select>
          {seats.length === 0 ? (
            <p className="ov-self-serial-hint ov-self-serial-hint--err" role="status">
              No unused allotted serials for this product. Cannot invent a serial.
            </p>
          ) : (
            <ul className="admin-setting-serial-seats ov-self-allotted-grid">
              {seats.map(serial => {
                const picked = serialInChoiceList(row.serialNumber, [serial]);
                return (
                  <li key={serial}>
                    <button
                      type="button"
                      className={`admin-setting-serial-seat text-mono${picked ? ' admin-setting-serial-seat--picked' : ''}`}
                      aria-pressed={picked}
                      disabled={disabled}
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
      ) : (
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
            placeholder={isPas ? 'Type serial from the plate' : 'Type existing serial'}
            value={row.serialNumber}
            readOnly={disabled}
            onChange={e => onSerialChange(e.target.value)}
            onBlur={runPasVerifyNow}
          />
          {pasHint ? (
            <p className={`ov-self-serial-hint ov-self-serial-hint--${pasHint.tone}`} role="status">
              {pasHint.text}
            </p>
          ) : null}
        </div>
      )}

      {isRv && onYearChange ? (
        <div className="ov-self-serial-year">
          <span className="ov-self-serial-year-label">
            Year of manufacturing <span className="verification-device-required">*</span>
          </span>
          <ManufacturingYearPicker
            value={row.manufacturingYear}
            onChange={onYearChange}
            disabled={disabled}
          />
        </div>
      ) : null}

      {!hasPlate ? (
        <p className="ov-self-serial-hint ov-self-serial-hint--muted mb-0">
          Serial number plate photo is still required to continue.
        </p>
      ) : null}
    </div>
  );
}
