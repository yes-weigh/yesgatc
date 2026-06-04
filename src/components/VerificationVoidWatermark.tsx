import React from 'react';

type VerificationVoidWatermarkProps = {
  /** Larger stamp on the certificate PDF panel. */
  variant?: 'certificate' | 'details';
  className?: string;
};

export const VerificationVoidWatermark: React.FC<VerificationVoidWatermarkProps> = ({
  variant = 'certificate',
  className = '',
}) => (
  <div
    className={`verification-void-watermark verification-void-watermark--${variant}${
      className ? ` ${className}` : ''
    }`}
    role="status"
    aria-label="Void certificate — no longer valid in YES LAB"
  >
    <span className="verification-void-watermark__text" aria-hidden>
      VOID
    </span>
  </div>
);
