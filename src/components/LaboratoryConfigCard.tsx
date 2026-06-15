import React from 'react';
import { Scale } from 'lucide-react';
import type { LaboratoryFieldDef } from '../lib/rcLaboratoryFields';

type LaboratoryConfigCardProps = {
  subtitle: string;
  sealField: LaboratoryFieldDef;
  sealValue: string;
  children?: React.ReactNode;
};

export const LaboratoryConfigCard: React.FC<LaboratoryConfigCardProps> = ({
  subtitle,
  sealField,
  sealValue,
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
    </div>

    <div className="laboratory-config-card-seal">
      <span className="laboratory-config-seal-label">{sealField.label}</span>
      <p
        className={`laboratory-config-seal-value mb-0${sealField.mono ? ' font-mono' : ''}`}
        aria-label={`${sealField.label}: ${sealValue}`}
      >
        {sealValue}
      </p>
      <p className="laboratory-config-seal-hint mb-0">{sealField.hint}</p>
    </div>
  </section>
);
