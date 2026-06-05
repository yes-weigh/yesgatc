import React from 'react';
import { ArrowLeft } from 'lucide-react';

type VerificationViewBackBarProps = {
  onBack: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export const VerificationViewBackBar: React.FC<VerificationViewBackBarProps> = ({
  onBack,
  disabled = false,
  label = 'Back to list',
  className = '',
}) => (
  <div className={`verification-view-back-bar${className ? ` ${className}` : ''}`}>
    <button
      type="button"
      className="verification-view-back-btn"
      onClick={onBack}
      disabled={disabled}
      aria-label={label}
    >
      <span className="verification-view-back-btn-icon" aria-hidden>
        <ArrowLeft size={18} strokeWidth={2.25} />
      </span>
      <span className="verification-view-back-btn-label">{label}</span>
    </button>
  </div>
);
