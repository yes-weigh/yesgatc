import React from 'react';

interface FilterIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/** Canonical list-filter mark. Use this for every filter control — never Lucide `Filter`. */
export const FilterIcon: React.FC<FilterIconProps> = ({
  size = 20,
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
    <line x1="4" y1="6" x2="7.2" y2="6" />
    <circle cx="10.2" cy="6" r="2.35" />
    <line x1="13.2" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="12.2" y2="12" />
    <circle cx="15.2" cy="12" r="2.35" />
    <line x1="18.2" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="8.4" y2="18" />
    <circle cx="11.4" cy="18" r="2.35" />
    <line x1="14.4" y1="18" x2="20" y2="18" />
  </svg>
);
