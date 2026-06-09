import React from 'react';
import { Save, Scale } from 'lucide-react';
import type { LaboratoryFieldDef } from '../lib/rcLaboratoryFields';

type LaboratoryConfigCardProps = {
  subtitle: string;
  formId: string;
  sealField: LaboratoryFieldDef;
  sealValue: string;
  sealInputId: string;
  saving: boolean;
  showSave: boolean;
  onSealChange: (value: string) => void;
  children?: React.ReactNode;
};

export const LaboratoryConfigCard: React.FC<LaboratoryConfigCardProps> = ({
  subtitle,
  formId,
  sealField,
  sealValue,
  sealInputId,
  saving,
  showSave,
  onSealChange,
  children,
}) => (
  <section className="laboratory-config-card panel glass" aria-label="Laboratory configuration">
    <div className="laboratory-config-card-top">
      <div className="laboratory-config-card-brand">
        <span className="laboratory-config-card-icon" aria-hidden>
          <Scale size={24} strokeWidth={2} />
        </span>
        <div className="laboratory-config-card-copy">
          <h2 className="laboratory-config-card-title mb-0">Laboratory</h2>
          <p className="laboratory-config-card-subtitle mb-0">{subtitle}</p>
          {children}
        </div>
      </div>

      {showSave && (
        <button
          type="submit"
          form={formId}
          className="btn btn-primary laboratory-config-save-btn"
          disabled={saving}
        >
          {saving ? <span className="spinner-inline" /> : <Save size={16} strokeWidth={2} />}
          Save
        </button>
      )}
    </div>

    <div className="laboratory-config-card-seal">
      <label htmlFor={sealInputId} className="laboratory-config-seal-label">
        {sealField.label}
      </label>
      <input
        id={sealInputId}
        type="text"
        className={`input-field laboratory-config-seal-input${sealField.mono ? ' font-mono' : ''}`}
        value={sealValue}
        onChange={event => onSealChange(event.target.value)}
        placeholder={sealField.placeholder}
        disabled={saving}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="laboratory-config-seal-hint mb-0">{sealField.hint}.</p>
    </div>
  </section>
);
