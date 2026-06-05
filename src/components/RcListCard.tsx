import React from 'react';
import { Pencil, Phone } from 'lucide-react';
import { StorageImage } from './StorageImage';

export type RcListBadgeTone =
  | 'approved'
  | 'pending'
  | 'active'
  | 'inactive'
  | 'auto'
  | 'manual'
  | 'ok'
  | 'due'
  | 'expired'
  | 'missing'
  | 'info';

type RcListPhotoProps = {
  url?: string;
  path?: string;
  placeholder: React.ReactNode;
  badge?: React.ReactNode;
};

export function RcListPhoto({ url, path, placeholder, badge }: RcListPhotoProps) {
  return (
    <span className="rc-list-card-photo">
      {url || path ? (
        <StorageImage url={url} path={path} alt="" className="rc-list-card-photo-img" />
      ) : (
        <span className="rc-list-card-photo-placeholder" aria-hidden>
          {placeholder}
        </span>
      )}
      {badge}
    </span>
  );
}

export function RcListEditHint() {
  return (
    <span className="rc-list-card-edit-hint" aria-hidden>
      <Pencil size={14} strokeWidth={2} />
    </span>
  );
}

export function RcListPhoneChip({ phone }: { phone: string }) {
  return (
    <span className="rc-list-meta-chip">
      <span className="rc-list-meta-chip-icon" aria-hidden>
        <Phone size={13} strokeWidth={2.25} />
      </span>
      <span className="rc-list-meta-chip-text text-mono">{phone}</span>
    </span>
  );
}

export function RcListMetaChip({
  icon,
  children,
  className = '',
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`rc-list-meta-chip${className ? ` ${className}` : ''}`}>
      <span className="rc-list-meta-chip-icon" aria-hidden>
        {icon}
      </span>
      <span className="rc-list-meta-chip-text">{children}</span>
    </span>
  );
}

export function RcListStatusBadge({
  tone,
  label,
  icon,
}: {
  tone: RcListBadgeTone;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <span className={`rc-list-status-badge rc-list-status-badge--${tone}`}>
      {icon}
      {label}
    </span>
  );
}

export function RcListCardToggle({
  className = '',
  title,
  ariaLabel,
  onClick,
  children,
}: {
  className?: string;
  title: string;
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rc-list-card-toggle${className ? ` ${className}` : ''}`}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

export function RcListCardActions({ children }: { children: React.ReactNode }) {
  return <div className="rc-list-card-actions">{children}</div>;
}
