import React from 'react';

export const DetailsSpecsCompactShell: React.FC<{
  thumb: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  ariaLabel: string;
}> = ({ thumb, children, className, ariaLabel }) => (
  <div
    className={`details-specs--compact${className ? ` ${className}` : ''}`}
    aria-label={ariaLabel}
  >
    <div className="details-specs-compact-inner">
      {thumb}
      <div className="details-specs-compact-body">{children}</div>
    </div>
  </div>
);

export const DetailsCompactThumb: React.FC<{
  children: React.ReactNode;
  placeholder?: boolean;
  title?: string;
}> = ({ children, placeholder = false, title }) => (
  <div
    className={`details-specs-compact-thumb${placeholder ? ' details-specs-compact-thumb--placeholder' : ''}`}
    title={title}
  >
    {children}
  </div>
);

export const DetailsCompactField: React.FC<{
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  spanFull?: boolean;
}> = ({ label, value, mono, spanFull }) => (
  <div className={`details-specs-compact-field${spanFull ? ' details-specs-compact-field--full' : ''}`}>
    <span className="details-specs-compact-field-label">{label}</span>
    <span className={`details-specs-compact-field-value${mono ? ' details-specs-compact-field-value--mono' : ''}`}>
      {value}
    </span>
  </div>
);
