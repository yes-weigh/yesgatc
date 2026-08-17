import React from 'react';

type ElectronicWeighingScaleIconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

/** Table-top electronic weighing scale (platter + LCD). Not Lucide `Scale` (balance). */
export const ElectronicWeighingScaleIcon: React.FC<ElectronicWeighingScaleIconProps> = ({
  size = 16,
  strokeWidth = 2,
  className,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d="M4.5 8h15" />
    <path d="M6 8c0-2.2 2.5-3.8 6-3.8S18 5.8 18 8" />
    <path d="M12 8v2.4" />
    <rect x="6.2" y="10.4" width="11.6" height="9" rx="1.7" />
    <rect x="8.2" y="12.3" width="7.6" height="3" rx="0.5" fill="currentColor" fillOpacity="0.28" />
  </svg>
);
