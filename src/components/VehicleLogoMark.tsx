import React from 'react';

type VehicleLogoMarkProps = {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'boxed' | 'plain';
  className?: string;
};

/** Front-facing car silhouette (reference UI). */
export function VehicleFrontIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M5.25 13.75V12a6.75 6.75 0 0 1 13.5 0v1.75c0 .97-.79 1.75-1.76 1.75H7.01c-.97 0-1.76-.78-1.76-1.75ZM8.6 9.15l1.65-2.95h3.5l1.65 2.95H8.6Z"
      />
      <rect x="7.35" y="14.1" width="2.1" height="1.05" rx="0.35" fill="currentColor" opacity="0.55" />
      <rect x="14.55" y="14.1" width="2.1" height="1.05" rx="0.35" fill="currentColor" opacity="0.55" />
      <rect x="10.65" y="13.55" width="2.7" height="0.85" rx="0.25" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

export const VehicleLogoMark: React.FC<VehicleLogoMarkProps> = ({
  size = 'md',
  variant = 'boxed',
  className = '',
}) => {
  if (variant === 'plain') {
    return (
      <span
        className={`vehicle-logo-plain vehicle-logo-plain--${size}${className ? ` ${className}` : ''}`}
        aria-hidden
      >
        <VehicleFrontIcon className="vehicle-logo-plain-icon" />
      </span>
    );
  }

  return (
    <span
      className={`vehicle-logo-mark vehicle-logo-mark--${size}${className ? ` ${className}` : ''}`}
      aria-hidden
    >
      <VehicleFrontIcon className="vehicle-logo-mark-icon" />
    </span>
  );
};
