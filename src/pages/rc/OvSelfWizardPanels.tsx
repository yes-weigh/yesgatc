import { Building2, Droplets, Image as ImageIcon, MapPin, Thermometer } from 'lucide-react';
import { ProductCatalogueList } from '../../components/ProductSelect';
import { SegmentToggle } from '../../components/SegmentToggle';
import { StorageImage } from '../../components/StorageImage';
import {
  VERIFICATION_LOCATION_OPTIONS,
  mpeStringFromProductSpec,
  type VerificationDeviceRowValues,
} from '../../lib/siteCalibrationProfileFields';
import {
  formatShopCapacityLine,
  getProductSpecifications,
  productHasMultipleSpecifications,
  resolveProductSpecification,
} from '../../lib/productSpecifications';
import { speakCapacityChoice } from '../../lib/speakText';
import type { Product, ProductSpecification, VerificationLocation } from '../../types';

export function OvSelfSerialMpeBar({
  serial,
  mpe,
  compact = false,
}: {
  serial: string;
  mpe: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`ov-self-serial-mpe-row ov-self-serial-mpe-bar${compact ? ' ov-self-serial-mpe-bar--compact' : ''}`}
    >
      <div className="ov-self-serial-card">
        <span className="ov-self-kicker">Serial</span>
        <strong className="ov-self-serial-value ov-self-serial-value--serial">
          {serial.trim() || '—'}
        </strong>
      </div>
      <div className="ov-self-serial-card ov-self-mpe-card">
        <span className="ov-self-kicker">MPE</span>
        <strong className="ov-self-serial-value ov-self-serial-value--mpe">
          {mpe.trim() || '—'}
        </strong>
      </div>
    </div>
  );
}

/** Selected capacity + serial/MPE — under product recap and above cancel/submit. */
export function OvSelfSpecSerialBlock({
  product,
  specificationId,
  serial,
  mpe,
  productName,
  compact = false,
}: {
  product?: Product | null;
  specificationId?: string;
  serial: string;
  mpe: string;
  productName?: string;
  compact?: boolean;
}) {
  const hasSpecChoice = Boolean(specificationId?.trim());
  const multi = product ? productHasMultipleSpecifications(product) : false;
  const unit = product?.unitOfMeasurement || 'kg';
  let specLabel = '';
  if (product && hasSpecChoice) {
    const match = getProductSpecifications(product).find(s => s.id === specificationId);
    if (match) specLabel = formatShopCapacityLine(match, unit);
  } else if (product && !multi) {
    specLabel = formatShopCapacityLine(resolveProductSpecification(product), unit);
  }
  const name = (productName || product?.name || '').trim();

  return (
    <div
      className={`ov-self-check-block${compact ? ' ov-self-check-block--compact' : ''}`}
      role="group"
      aria-label="Selected specification and serial"
    >
      {(specLabel || name || multi) && (
        <div className="ov-self-check-spec">
          {specLabel ? (
            <span className="ov-self-check-spec-pill">{specLabel}</span>
          ) : multi ? (
            <span className="ov-self-check-spec-wait">Select a capacity</span>
          ) : null}
          {name ? <span className="ov-self-check-spec-name">{name}</span> : null}
        </div>
      )}
      <div className="ov-self-check-serial-mpe">
        <div className="ov-self-check-serial">
          <span className="ov-self-kicker">Serial</span>
          <strong className="ov-self-serial-value ov-self-serial-value--serial">
            {serial.trim() || '—'}
          </strong>
        </div>
        <div className="ov-self-check-mpe">
          <span className="ov-self-kicker ov-self-kicker--mpe">MPE</span>
          <strong className="ov-self-serial-value ov-self-serial-value--mpe">
            {mpe.trim() || '—'}
          </strong>
        </div>
      </div>
    </div>
  );
}

function OvSelfSpecChoiceList({
  product,
  selectedSpecificationId,
  disabled,
  onSelect,
}: {
  product: Product;
  selectedSpecificationId?: string;
  disabled?: boolean;
  onSelect: (spec: ProductSpecification) => void;
}) {
  const specs = getProductSpecifications(product);
  const unit = product.unitOfMeasurement || 'kg';
  if (specs.length <= 1) return null;
  const hasImage = Boolean(product.productImageUrl || product.productImagePath);
  const approvalNo = product.modelApprovalNo?.trim() || '';
  const modelNo = product.modelNo?.trim() || product.modelid?.trim() || '';

  return (
    <div className="ov-self-spec-choice" role="listbox" aria-label="Select capacity">
      <div className="ov-self-spec-choice-head">
        <span className="ov-self-spec-choice-preview" aria-hidden={!hasImage}>
          {hasImage ? (
            <StorageImage
              url={product.productImageUrl}
              path={product.productImagePath}
              alt=""
              className="ov-self-spec-choice-img"
              persistentCache
            />
          ) : (
            <span className="ov-self-spec-choice-img ov-self-spec-choice-img--placeholder">
              <ImageIcon size={28} />
            </span>
          )}
        </span>
        <div className="ov-self-spec-choice-head-text">
          <p className="ov-self-spec-choice-title mb-0">Select specification</p>
          <p className="ov-self-spec-choice-product mb-0">{product.name}</p>
          {approvalNo ? (
            <p className="ov-self-spec-choice-approval mb-0">{approvalNo}</p>
          ) : null}
          {modelNo ? (
            <p className="ov-self-spec-choice-model mb-0">Model number : {modelNo}</p>
          ) : null}
        </div>
      </div>
      <ul className="ov-self-spec-choice-list">
        {specs.map(spec => {
          const selected = selectedSpecificationId === spec.id;
          const label = formatShopCapacityLine(spec, unit);
          return (
            <li key={spec.id}>
              <button
                type="button"
                className={`ov-self-spec-choice-option${selected ? ' ov-self-spec-choice-option--selected' : ''}`}
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onPointerDown={() => {
                  if (disabled) return;
                  speakCapacityChoice(label);
                }}
                onClick={() => onSelect(spec)}
              >
                <span className="ov-self-spec-choice-badge">
                  {Number.isFinite(spec.maximumCapacity) ? spec.maximumCapacity : '—'}
                </span>
                <span className="ov-self-spec-choice-text">
                  <span className="ov-self-spec-choice-label">{label}</span>
                  {Number.isFinite(spec.maximumPermissibleError) ? (
                    <span className="ov-self-spec-choice-meta">MPE {spec.maximumPermissibleError}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="ov-self-spec-choice-hint mb-0">Tap a capacity — change anytime before Photos.</p>
    </div>
  );
}

export function OvSelfProductPanel({
  row,
  products,
  sealId,
  disabled,
  onProductChange,
}: {
  row: VerificationDeviceRowValues;
  products: Product[];
  sealId: string;
  disabled: boolean;
  onProductChange: (patch: Partial<VerificationDeviceRowValues>) => void;
}) {
  const seal = sealId.trim() || row.sealIdentificationNumber.trim();
  const selected = products.find(product => product.id === row.productId) ?? null;
  const multiSpec = selected ? productHasMultipleSpecifications(selected) : false;

  const handlePick = (next: {
    productId: string;
    productName: string;
    productSpecificationId?: string;
  }) => {
    const product = products.find(p => p.id === next.productId) ?? null;
    const multi = product ? productHasMultipleSpecifications(product) : false;
    // Multi-spec: pick product only — user chooses capacity below (no auto-select).
    if (multi) {
      onProductChange({
        productId: next.productId,
        productName: next.productName,
        productSpecificationId: '',
        maximumPermissibleError: '',
        sealIdentificationNumber: seal,
      });
      return;
    }
    onProductChange({
      productId: next.productId,
      productName: next.productName,
      productSpecificationId: next.productSpecificationId || '',
      maximumPermissibleError: mpeStringFromProductSpec(
        product,
        next.productSpecificationId,
      ),
      sealIdentificationNumber: seal,
    });
  };

  const handleSpecSelect = (spec: ProductSpecification) => {
    onProductChange({
      productSpecificationId: spec.id,
      maximumPermissibleError:
        spec.maximumPermissibleError !== undefined &&
        spec.maximumPermissibleError !== null &&
        Number.isFinite(spec.maximumPermissibleError)
          ? String(spec.maximumPermissibleError)
          : '',
    });
  };

  return (
    <div className="ov-self-panel ov-self-panel--product">
      <div className="ov-self-product-block">
        <ProductCatalogueList
          products={products}
          value={{
            productId: row.productId,
            productName: row.productName,
            productSpecificationId: row.productSpecificationId,
          }}
          onChange={handlePick}
          disabled={disabled}
          showCapacitySpecs
          variant="shop"
          deferMultiSpec
        />
      </div>

      {selected && multiSpec ? (
        <OvSelfSpecChoiceList
          product={selected}
          selectedSpecificationId={row.productSpecificationId}
          disabled={disabled}
          onSelect={handleSpecSelect}
        />
      ) : null}

      {selected ? (
        <OvSelfSpecSerialBlock
          product={selected}
          specificationId={row.productSpecificationId}
          serial={row.serialNumber}
          mpe={row.maximumPermissibleError}
          productName={row.productName}
        />
      ) : (
        <p className="ov-self-selected-hint ov-self-selected-hint--wait mb-0">
          Select a product to fill MPE.
        </p>
      )}

      {!seal ? (
        <p className="ov-self-selected-hint ov-self-selected-hint--wait mb-0" role="status">
          Laboratory seal ID missing — set seal in Laboratory before continuing.
        </p>
      ) : null}
    </div>
  );
}

export function OvSelfEnvFields({
  temperature,
  humidity,
  onTemperatureChange,
  onHumidityChange,
  weatherLoading,
  weatherError,
  locked,
  idPrefix = 'ov-self',
}: {
  temperature: string;
  humidity: string;
  onTemperatureChange: (value: string) => void;
  onHumidityChange: (value: string) => void;
  weatherLoading: boolean;
  weatherError: string;
  locked: boolean;
  idPrefix?: string;
}) {
  return (
    <section className="verification-env-panel" aria-labelledby={`${idPrefix}-env-title`}>
      <header className="verification-env-panel-head">
        <div className="verification-env-panel-head-text">
          <h3 id={`${idPrefix}-env-title`} className="verification-env-panel-title">
            RC conditions
          </h3>
          <p className="verification-env-panel-subtitle">
            Temperature and humidity at the RC — edit if needed
          </p>
        </div>
      </header>
      <div className="verification-env-panel-body">
        <div className="verification-env-metrics">
          <div className="verification-env-metric verification-env-metric--temp">
            <div className="verification-env-metric-icon" aria-hidden>
              <Thermometer strokeWidth={2} />
            </div>
            <div className="verification-env-metric-field">
              <label htmlFor={`${idPrefix}-temp`}>Temperature (°C)</label>
              <input
                id={`${idPrefix}-temp`}
                type="text"
                inputMode="decimal"
                className="verification-env-metric-input"
                placeholder={weatherLoading ? '…' : '28.5'}
                value={temperature}
                onChange={e => onTemperatureChange(e.target.value)}
                disabled={locked || weatherLoading}
              />
            </div>
            <span className="verification-env-metric-unit">°C</span>
          </div>
          <div className="verification-env-metric verification-env-metric--humidity">
            <div className="verification-env-metric-icon" aria-hidden>
              <Droplets strokeWidth={2} />
            </div>
            <div className="verification-env-metric-field">
              <label htmlFor={`${idPrefix}-humidity`}>Humidity (%)</label>
              <input
                id={`${idPrefix}-humidity`}
                type="text"
                inputMode="decimal"
                className="verification-env-metric-input"
                placeholder={weatherLoading ? '…' : '65'}
                value={humidity}
                onChange={e => onHumidityChange(e.target.value)}
                disabled={locked || weatherLoading}
              />
            </div>
            <span className="verification-env-metric-unit">%</span>
          </div>
        </div>
      </div>
      {weatherError ? (
        <p className="verification-env-panel-error text-orange text-xs mb-0" role="alert">
          {weatherError}
        </p>
      ) : null}
    </section>
  );
}

export function OvSelfSitePanel({
  rcName,
  location,
  onLocationChange,
  temperature,
  humidity,
  onTemperatureChange,
  onHumidityChange,
  weatherLoading,
  weatherError,
  locked,
}: {
  rcName: string;
  location: VerificationLocation | '';
  onLocationChange: (value: VerificationLocation) => void;
  temperature: string;
  humidity: string;
  onTemperatureChange: (value: string) => void;
  onHumidityChange: (value: string) => void;
  weatherLoading: boolean;
  weatherError: string;
  locked: boolean;
}) {
  const locationValue: VerificationLocation =
    location === 'in_premises' ? 'in_premises' : 'in_situ';

  return (
    <div className="ov-self-panel ov-self-panel--site">
      <div className="ov-self-rc-card">
        <span className="ov-self-rc-icon" aria-hidden>
          <Building2 size={16} strokeWidth={2.2} />
        </span>
        <div className="ov-self-rc-copy">
          <span className="ov-self-kicker">Customer</span>
          <strong>{rcName || 'RC centre'}</strong>
          <span className="ov-self-rc-sub">OV Self — this job belongs to the RC</span>
        </div>
      </div>

      <div className="ov-self-location-field">
        <span className="ov-self-kicker">
          <MapPin size={12} strokeWidth={2.4} aria-hidden /> Location
        </span>
        <SegmentToggle
          ariaLabel="Verification location"
          value={locationValue}
          options={VERIFICATION_LOCATION_OPTIONS.map(opt => ({
            value: opt.value,
            label: opt.label,
          }))}
          onChange={onLocationChange}
          disabled={locked}
        />
      </div>

      <OvSelfEnvFields
        temperature={temperature}
        humidity={humidity}
        onTemperatureChange={onTemperatureChange}
        onHumidityChange={onHumidityChange}
        weatherLoading={weatherLoading}
        weatherError={weatherError}
        locked={locked}
      />
    </div>
  );
}
