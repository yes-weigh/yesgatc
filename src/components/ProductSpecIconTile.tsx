import React from 'react';
import type { LucideIcon } from 'lucide-react';

export type ProductSpecIconTone =
  | 'sky'
  | 'violet'
  | 'amber'
  | 'emerald'
  | 'yellow'
  | 'cyan'
  | 'indigo'
  | 'teal'
  | 'pink'
  | 'orange'
  | 'lime'
  | 'rose'
  | 'blue';

export const ProductSpecIconTile: React.FC<{
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  tone: ProductSpecIconTone;
  mono?: boolean;
  spanFull?: boolean;
}> = ({ label, value, icon: Icon, tone, mono = false, spanFull = false }) => (
  <div
    className={[
      'details-spec-tile',
      `details-spec-tile--${tone}`,
      spanFull ? 'details-spec-tile--full' : '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    <span className="details-spec-tile-icon" aria-hidden>
      <Icon size={13} strokeWidth={2.1} />
    </span>
    <div className="details-spec-tile-body">
      <span className="details-spec-tile-label">{label}</span>
      <span
        className={[
          'details-spec-tile-value',
          mono ? 'details-spec-tile-value--mono' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </span>
    </div>
  </div>
);
