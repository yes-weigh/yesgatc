import React from 'react';

type VctOfficerMarkProps = {
  className?: string;
};

export const VctOfficerMark: React.FC<VctOfficerMarkProps> = ({ className = '' }) => (
  <img
    src="/vct/vct-officer.png"
    alt=""
    className={`vct-officer-mark${className ? ` ${className}` : ''}`}
    aria-hidden
  />
);
