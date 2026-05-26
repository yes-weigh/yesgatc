import React, { useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ProductSelect } from '../../components/ProductSelect';
import { UploadField } from '../admin/productFormUi';
import { useAppContext } from '../../context/AppContext';
import {
  mpeStringFromProduct,
  type DeviceScaleImageState,
  type VerificationDeviceRowValues,
} from '../../lib/siteCalibrationProfileFields';
import type { Product } from '../../types';

const DeviceScaleUpload: React.FC<{
  image: DeviceScaleImageState;
  disabled: boolean;
  onSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  label?: string;
  hint?: string;
  formats?: string;
}> = ({ image, disabled, onSelect, onRemove, label = '', hint = '', formats = '' }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <UploadField
      label={label}
      hint={hint}
      file={image.file}
      uploading={image.uploading}
      progress={image.progress}
      accept="image/jpeg,image/png,image/webp,image/gif"
      uploadLabel="Upload"
      formats={formats}
      inputRef={inputRef}
      onSelect={onSelect}
      onRemove={onRemove}
      submitting={disabled}
      variant="image"
      compact
      iconActions
    />
  );
};

type VerificationDeviceFieldsProps = {
  devices: VerificationDeviceRowValues[];
  deviceImages: Record<string, DeviceScaleImageState>;
  onDeviceChange: (localId: string, patch: Partial<VerificationDeviceRowValues>) => void;
  onDeviceAdd: () => void;
  onDeviceRemove: (localId: string) => void;
  onScaleImageSelect: (localId: string, file: File) => void;
  onScaleImageRemove: (localId: string) => void;
  submitting: boolean;
  lockExistingDevices?: boolean;
};

function productLabel(products: Product[], row: VerificationDeviceRowValues): string {
  if (row.productName.trim()) return row.productName;
  const product = products.find(p => p.id === row.productId);
  return product?.name || '—';
}

export const VerificationDeviceFields: React.FC<VerificationDeviceFieldsProps> = ({
  devices,
  deviceImages,
  onDeviceChange,
  onDeviceAdd,
  onDeviceRemove,
  onScaleImageSelect,
  onScaleImageRemove,
  submitting,
  lockExistingDevices = false,
}) => {
  const { products } = useAppContext();

  const handleFileInput = (localId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onScaleImageSelect(localId, file);
  };

  if (devices.length === 0) {
    return (
      <div className="verification-devices-empty">
        <p className="text-muted text-sm mb-3">This customer has no registered devices yet.</p>
        <button
          type="button"
          className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"
          onClick={onDeviceAdd}
          disabled={submitting}
        >
          <Plus size={15} /> Add device
        </button>
      </div>
    );
  }

  return (
    <div className="verification-devices-panel">
      <div className="verification-devices-head">
        <p className="site-calibration-details-heading mb-0">Devices to verify</p>
        <button
          type="button"
          className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"
          onClick={onDeviceAdd}
          disabled={submitting}
        >
          <Plus size={15} /> Add device
        </button>
      </div>

      <div className="verification-devices-desktop table-scroll-wrap">
        <table className="data-table data-table--verification-devices">
          <thead>
            <tr>
              <th className="verification-devices-col-check">Verify</th>
              <th>Product</th>
              <th>Serial</th>
              <th>MPE</th>
              <th>Seal ID</th>
              <th>Scale image</th>
              <th className="verification-devices-col-actions" />
            </tr>
          </thead>
          <tbody>
            {devices.map((row, index) => {
              const image = deviceImages[row.localId] ?? {
                file: null,
                uploading: false,
                progress: 0,
                pendingFile: null,
                removed: false,
              };
              const editableDevice = row.isNewDevice || !lockExistingDevices;

              return (
                <tr key={row.localId} className={row.included ? '' : 'verification-device-row--skipped'}>
                  <td className="verification-devices-col-check">
                    <label className="verification-device-check">
                      <input
                        type="checkbox"
                        checked={row.included}
                        onChange={e => onDeviceChange(row.localId, { included: e.target.checked })}
                        disabled={submitting}
                      />
                    </label>
                  </td>
                  <td className="verification-devices-col-product">
                    {row.isNewDevice ? (
                      <ProductSelect
                        products={products}
                        inputId={`verification-product-${row.localId}`}
                        value={{ productId: row.productId, productName: row.productName }}
                        onChange={next => {
                          const product = products.find(p => p.id === next.productId) ?? null;
                          onDeviceChange(row.localId, {
                            productId: next.productId,
                            productName: next.productName,
                            maximumPermissibleError: mpeStringFromProduct(product),
                          });
                        }}
                        disabled={submitting || !row.included}
                        required={row.included}
                      />
                    ) : (
                      <span className="verification-device-readonly">{productLabel(products, row)}</span>
                    )}
                  </td>
                  <td>
                    {editableDevice && row.isNewDevice ? (
                      <input
                        type="text"
                        className="input-field input-field--table"
                        placeholder="Serial number"
                        value={row.serialNumber}
                        onChange={e => onDeviceChange(row.localId, { serialNumber: e.target.value })}
                        disabled={submitting || !row.included}
                        required={row.included}
                      />
                    ) : (
                      <span className="verification-device-readonly text-mono">{row.serialNumber || '—'}</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      className="input-field input-field--table"
                      placeholder="MPE"
                      value={row.maximumPermissibleError}
                      onChange={e => onDeviceChange(row.localId, { maximumPermissibleError: e.target.value })}
                      disabled={submitting || !row.included}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input-field input-field--table"
                      placeholder="Seal ID"
                      value={row.sealIdentificationNumber}
                      onChange={e => onDeviceChange(row.localId, { sealIdentificationNumber: e.target.value })}
                      disabled={submitting || !row.included}
                      required={row.included}
                    />
                  </td>
                  <td className="verification-devices-col-image">
                    <DeviceScaleUpload
                      image={image}
                      disabled={submitting || !row.included}
                      onSelect={e => handleFileInput(row.localId, e)}
                      onRemove={() => onScaleImageRemove(row.localId)}
                    />
                  </td>
                  <td className="verification-devices-col-actions text-right">
                    {row.isNewDevice && (
                      <button
                        type="button"
                        className="btn-icon text-red"
                        onClick={() => onDeviceRemove(row.localId)}
                        disabled={submitting}
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
          const image = deviceImages[row.localId] ?? {
            file: null,
            uploading: false,
            progress: 0,
            pendingFile: null,
            removed: false,
          };

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
                    disabled={submitting}
                  />
                  <span>Device {index + 1}</span>
                </label>
                {row.isNewDevice && (
                  <button
                    type="button"
                    className="btn-icon text-red"
                    onClick={() => onDeviceRemove(row.localId)}
                    disabled={submitting}
                    title="Remove device"
                    aria-label={`Remove device ${index + 1}`}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div className="verification-device-card-body">
                <div className="form-group mb-0">
                  <label htmlFor={`verification-mobile-product-${row.localId}`}>Product *</label>
                  {row.isNewDevice ? (
                    <ProductSelect
                      products={products}
                      inputId={`verification-mobile-product-${row.localId}`}
                      value={{ productId: row.productId, productName: row.productName }}
                      onChange={next => {
                        const product = products.find(p => p.id === next.productId) ?? null;
                        onDeviceChange(row.localId, {
                          productId: next.productId,
                          productName: next.productName,
                          maximumPermissibleError: mpeStringFromProduct(product),
                        });
                      }}
                      disabled={submitting || !row.included}
                      required={row.included}
                    />
                  ) : (
                    <p className="verification-device-readonly mb-0">{productLabel(products, row)}</p>
                  )}
                </div>

                <div className="form-group mb-0">
                  <label htmlFor={`verification-mobile-serial-${row.localId}`}>Serial number *</label>
                  {row.isNewDevice ? (
                    <input
                      id={`verification-mobile-serial-${row.localId}`}
                      type="text"
                      className="input-field"
                      value={row.serialNumber}
                      onChange={e => onDeviceChange(row.localId, { serialNumber: e.target.value })}
                      disabled={submitting || !row.included}
                      required={row.included}
                    />
                  ) : (
                    <p className="verification-device-readonly text-mono mb-0">{row.serialNumber || '—'}</p>
                  )}
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
                    disabled={submitting || !row.included}
                  />
                </div>

                <div className="form-group mb-0">
                  <label htmlFor={`verification-mobile-seal-${row.localId}`}>Seal identification number *</label>
                  <input
                    id={`verification-mobile-seal-${row.localId}`}
                    type="text"
                    className="input-field"
                    value={row.sealIdentificationNumber}
                    onChange={e => onDeviceChange(row.localId, { sealIdentificationNumber: e.target.value })}
                    disabled={submitting || !row.included}
                    required={row.included}
                  />
                </div>

                <div className="form-group mb-0 verification-device-card-upload">
                  <DeviceScaleUpload
                    image={image}
                    disabled={submitting || !row.included}
                    onSelect={e => handleFileInput(row.localId, e)}
                    onRemove={() => onScaleImageRemove(row.localId)}
                    label="Scale image"
                    hint="Required"
                    formats="Max 15 MB"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
