import { FileText, Send, Award, AlertTriangle, XCircle } from 'lucide-react';
import {
  VERIFICATION_DURATION_OPTIONS,
  type VerificationDurationFilter,
} from '../lib/verificationListDuration';
import type { VerificationStatusFilter, VerificationStatusFilterCounts } from '../lib/verificationRequest';

type DashTone = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';

const TILES: {
  key: VerificationStatusFilter;
  label: string;
  tone: DashTone;
  countKey: keyof VerificationStatusFilterCounts;
  Icon: typeof Award;
}[] = [
  { key: 'certified', label: 'Certified', tone: 'emerald', countKey: 'certified', Icon: Award },
  { key: 'submitted', label: 'Submitted', tone: 'sky', countKey: 'submitted', Icon: Send },
  { key: 'failed_submit', label: 'Failed', tone: 'amber', countKey: 'failed_submit', Icon: AlertTriangle },
  { key: 'rejected', label: 'Rejected', tone: 'rose', countKey: 'rejected', Icon: XCircle },
  { key: 'draft', label: 'Draft', tone: 'slate', countKey: 'draft', Icon: FileText },
];

type VerificationListStatusDashProps = {
  counts: VerificationStatusFilterCounts;
  statusFilter: VerificationStatusFilter;
  onStatusFilterChange: (value: VerificationStatusFilter) => void;
  durationFilter: VerificationDurationFilter;
  onDurationFilterChange: (value: VerificationDurationFilter) => void;
  loading?: boolean;
};

export function VerificationListStatusDash({
  counts,
  statusFilter,
  onStatusFilterChange,
  durationFilter,
  onDurationFilterChange,
  loading = false,
}: VerificationListStatusDashProps) {
  return (
    <section className="verification-status-dash" aria-label="Verification status">
      <div className="verification-status-dash__head">
        <label className="verification-status-dash__period">
          <span className="sr-only">Period</span>
          <select
            className="verification-status-dash__period-select"
            value={durationFilter}
            onChange={e => onDurationFilterChange(e.target.value as VerificationDurationFilter)}
            aria-label="Dashboard period"
          >
            {VERIFICATION_DURATION_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>
                {opt.id === 'all' ? 'Lifetime' : opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="verification-status-dash__grid">
        {TILES.map(tile => {
          const active = statusFilter === tile.key;
          const count = counts[tile.countKey] ?? 0;
          return (
            <button
              key={tile.key}
              type="button"
              className={`verification-status-dash__tile verification-status-dash__tile--${tile.tone}${
                active ? ' is-active' : ''
              }`}
              onClick={() => onStatusFilterChange(active ? 'all' : tile.key)}
              aria-pressed={active}
              aria-label={`${tile.label}: ${count}`}
            >
              <span className="verification-status-dash__icon" aria-hidden>
                <tile.Icon size={16} strokeWidth={2.25} />
              </span>
              <span className="verification-status-dash__label">{tile.label}</span>
              <span className="verification-status-dash__count">
                {loading ? '—' : count}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
