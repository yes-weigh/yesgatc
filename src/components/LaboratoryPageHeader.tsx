import React from 'react';
import { Save, Scale } from 'lucide-react';

type LaboratoryPageHeaderProps = {
  subtitle: string;
  formId?: string;
  showSave?: boolean;
  saving?: boolean;
  children?: React.ReactNode;
};

export const LaboratoryPageHeader: React.FC<LaboratoryPageHeaderProps> = ({
  subtitle,
  formId,
  showSave = false,
  saving = false,
  children,
}) => (
  <div className="rc-laboratory-header">
    <div className="rc-laboratory-header-main">
      <span className="rc-laboratory-header-icon" aria-hidden>
        <Scale size={22} strokeWidth={2} />
      </span>
      <div className="rc-laboratory-header-copy">
        <h2 className="rc-laboratory-header-title mb-0">Laboratory</h2>
        <p className="rc-laboratory-header-subtitle mb-0">{subtitle}</p>
        {children}
      </div>
    </div>

    {showSave && formId && (
      <button
        type="submit"
        form={formId}
        className="btn btn-primary rc-laboratory-save-btn"
        disabled={saving}
      >
        {saving ? <span className="spinner-inline" /> : <Save size={16} strokeWidth={2} />}
        Save
      </button>
    )}
  </div>
);
