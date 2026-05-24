import React, { useRef } from 'react';
import type { ProductFileMeta } from '../../lib/productApprovalUpload';
import type { VehicleDocKey } from '../../lib/vehicleProfileFields';
import { VEHICLE_DOC_KEYS, VEHICLE_DOC_LABELS } from '../../lib/vehicleProfileFields';
import { UploadField } from '../admin/productFormUi';

export type VehicleFormValues = {
  brand: string;
  model: string;
  year: string;
  regNumber: string;
  rcValidity: string;
  insuranceValidity: string;
  pollutionValidity: string;
  f2WeightValidity: string;
};

export const EMPTY_VEHICLE_FORM: VehicleFormValues = {
  brand: '',
  model: '',
  year: '',
  regNumber: '',
  rcValidity: '',
  insuranceValidity: '',
  pollutionValidity: '',
  f2WeightValidity: '',
};

export type VehicleDocUploadState = {
  file: ProductFileMeta | null;
  uploading: boolean;
  progress: number;
};

export const EMPTY_VEHICLE_DOC_STATE: VehicleDocUploadState = {
  file: null,
  uploading: false,
  progress: 0,
};

type VehicleFormFieldsProps = {
  mode: 'create' | 'edit';
  values: VehicleFormValues;
  onChange: (patch: Partial<VehicleFormValues>) => void;
  vehiclePhoto: VehicleDocUploadState;
  onVehiclePhotoSelect: (file: File) => void;
  onVehiclePhotoRemove: () => void;
  docStates: Record<VehicleDocKey, VehicleDocUploadState>;
  onDocSelect: (key: VehicleDocKey, file: File) => void;
  onDocRemove: (key: VehicleDocKey) => void;
  submitting: boolean;
};

export const VehicleFormFields: React.FC<VehicleFormFieldsProps> = ({
  mode,
  values,
  onChange,
  vehiclePhoto,
  onVehiclePhotoSelect,
  onVehiclePhotoRemove,
  docStates,
  onDocSelect,
  onDocRemove,
  submitting,
}) => {
  const photoRef = useRef<HTMLInputElement>(null);
  const rcRef = useRef<HTMLInputElement>(null);
  const insuranceRef = useRef<HTMLInputElement>(null);
  const pollutionRef = useRef<HTMLInputElement>(null);
  const f2Ref = useRef<HTMLInputElement>(null);

  const docRefs: Record<VehicleDocKey, React.RefObject<HTMLInputElement | null>> = {
    rcDoc: rcRef,
    insuranceDoc: insuranceRef,
    pollutionDoc: pollutionRef,
    f2WeightDoc: f2Ref,
  };

  const handleDocInput = (key: VehicleDocKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onDocSelect(key, file);
  };

  const handlePhotoInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onVehiclePhotoSelect(file);
  };

  return (
    <div className="product-form-flat vehicle-form-flat">
      <div className="product-form-flat-row vehicle-form-hero">
        <div className="vehicle-form-hero-photo">
          <UploadField
            label="Vehicle photo"
            hint="Optional"
            file={vehiclePhoto.file}
            uploading={vehiclePhoto.uploading}
            progress={vehiclePhoto.progress}
            accept="image/jpeg,image/png,image/webp,image/gif"
            uploadLabel="Upload"
            formats="Max 15 MB"
            inputRef={photoRef}
            onSelect={handlePhotoInput}
            onRemove={onVehiclePhotoRemove}
            submitting={submitting}
            variant="image"
            compact
            avatar
          />
        </div>

        <div className="vehicle-form-hero-fields">
          <div className="vehicle-form-grid vehicle-form-grid--identity">
            <div className="form-group mb-0">
              <label htmlFor="vehicle-brand">Vehicle brand *</label>
              <input
                id="vehicle-brand"
                type="text"
                className="input-field"
                placeholder="e.g. Tata"
                value={values.brand}
                onChange={e => onChange({ brand: e.target.value })}
                required
                autoFocus={mode === 'create'}
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="vehicle-model">Model *</label>
              <input
                id="vehicle-model"
                type="text"
                className="input-field"
                placeholder="e.g. Ace Gold"
                value={values.model}
                onChange={e => onChange({ model: e.target.value })}
                required
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="vehicle-year">Year *</label>
              <input
                id="vehicle-year"
                type="text"
                inputMode="numeric"
                className="input-field"
                placeholder="e.g. 2022"
                value={values.year}
                onChange={e => onChange({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                required
                maxLength={4}
              />
            </div>
            <div className="form-group mb-0">
              <label htmlFor="vehicle-reg">Reg number *</label>
              <input
                id="vehicle-reg"
                type="text"
                className="input-field"
                placeholder="e.g. MH12AB1234"
                value={values.regNumber}
                onChange={e => onChange({ regNumber: e.target.value.toUpperCase() })}
                required
              />
            </div>
          </div>
        </div>
      </div>

      <div className="product-form-flat-row vehicle-form-row-validity">
        <div className="vehicle-form-grid vehicle-form-grid--validity">
          <div className="form-group mb-0">
            <label htmlFor="vehicle-rc-validity">RC validity *</label>
            <input
              id="vehicle-rc-validity"
              type="date"
              className="input-field"
              value={values.rcValidity}
              onChange={e => onChange({ rcValidity: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="vehicle-insurance-validity">Insurance validity *</label>
            <input
              id="vehicle-insurance-validity"
              type="date"
              className="input-field"
              value={values.insuranceValidity}
              onChange={e => onChange({ insuranceValidity: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="vehicle-pollution-validity">Pollution validity *</label>
            <input
              id="vehicle-pollution-validity"
              type="date"
              className="input-field"
              value={values.pollutionValidity}
              onChange={e => onChange({ pollutionValidity: e.target.value })}
              required
            />
          </div>
          <div className="form-group mb-0">
            <label htmlFor="vehicle-f2-validity">F2 weight validity *</label>
            <input
              id="vehicle-f2-validity"
              type="date"
              className="input-field"
              value={values.f2WeightValidity}
              onChange={e => onChange({ f2WeightValidity: e.target.value })}
              required
            />
          </div>
        </div>
      </div>

      <div className="product-form-flat-row vehicle-form-row-docs">
        {VEHICLE_DOC_KEYS.map(key => {
          const meta = VEHICLE_DOC_LABELS[key];
          const state = docStates[key];
          return (
            <UploadField
              key={key}
              label={meta.label}
              hint={meta.hint}
              file={state.file}
              uploading={state.uploading}
              progress={state.progress}
              accept=".pdf,image/jpeg,image/png,image/webp,image/gif"
              uploadLabel="Choose file"
              formats="PDF or image · max 15 MB"
              inputRef={docRefs[key]}
              onSelect={handleDocInput(key)}
              onRemove={() => onDocRemove(key)}
              submitting={submitting}
              variant="document"
              compact
            />
          );
        })}
      </div>
    </div>
  );
};
