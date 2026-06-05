import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';

type ListViewBackBarProps = {
  onBack: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export const ListViewBackBar: React.FC<ListViewBackBarProps> = ({
  onBack,
  disabled = false,
  label = 'Back to list',
  className = '',
}) => {
  const floatingBar = (
    <div
      className={`list-view-back-bar list-view-back-bar--floating${
        className ? ` ${className}` : ''
      }`}
    >
      <button
        type="button"
        className="list-view-back-btn"
        onClick={onBack}
        disabled={disabled}
        aria-label={label}
      >
        <span className="list-view-back-btn-icon" aria-hidden>
          <ArrowLeft size={18} strokeWidth={2.25} />
        </span>
        <span className="list-view-back-btn-label">{label}</span>
      </button>
    </div>
  );

  return (
    <>
      <div className="list-view-back-bar-spacer" aria-hidden="true" />
      {typeof document !== 'undefined'
        ? createPortal(floatingBar, document.body)
        : floatingBar}
    </>
  );
};

/** @deprecated Use ListViewBackBar */
export const VerificationViewBackBar = ListViewBackBar;
