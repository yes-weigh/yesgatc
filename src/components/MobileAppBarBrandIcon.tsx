import React, { useId } from 'react';

interface MobileAppBarBrandIconProps {
  variant: 'shield' | 'page';
  children?: React.ReactNode;
}

export const MobileAppBarBrandIcon: React.FC<MobileAppBarBrandIconProps> = ({
  variant,
  children,
}) => {
  const gradientId = useId();

  if (variant === 'shield') {
    return (
      <span className="mobile-app-bar-shield" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="48%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#e879f9" />
            </linearGradient>
          </defs>
          <path
            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
            stroke={`url(#${gradientId})`}
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m9 12 2 2 4-4"
            stroke="#2dd4bf"
            strokeWidth="2.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className="mobile-app-bar-page-icon" aria-hidden>
      {children}
    </span>
  );
};
