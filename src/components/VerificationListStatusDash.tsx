import { FileText, Send, Award, AlertTriangle, XCircle, RefreshCw } from 'lucide-react';
import type {
  VerificationStatusFilter,
  VerificationStatusFilterCounts,
  VerificationTypeFilter,
} from '../lib/verificationRequest';

type DashTone = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate' | 'orange';

const STATUS_TILES: {
  key: VerificationStatusFilter;
  label: string;
  tone: DashTone;
  countKey: keyof VerificationStatusFilterCounts;
  Icon: typeof Award;
}[] = [
  { key: 'certified', label: 'Cert', tone: 'emerald', countKey: 'certified', Icon: Award },
  { key: 'submitted', label: 'Sub', tone: 'sky', countKey: 'submitted', Icon: Send },
  { key: 'failed_submit', label: 'Fail', tone: 'amber', countKey: 'failed_submit', Icon: AlertTriangle },
  { key: 'rejected', label: 'Rej', tone: 'rose', countKey: 'rejected', Icon: XCircle },
  { key: 'draft', label: 'Draft', tone: 'slate', countKey: 'draft', Icon: FileText },
];

type VerificationListStatusDashProps = {
  counts: VerificationStatusFilterCounts;
  rvCount: number;
  statusFilter: VerificationStatusFilter;
  onStatusFilterChange: (value: VerificationStatusFilter) => void;
  typeFilter: VerificationTypeFilter;
  onTypeFilterChange: (value: VerificationTypeFilter) => void;
  loading?: boolean;
};

export function VerificationListStatusDash({
  counts,
  rvCount,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  loading = false,
}: VerificationListStatusDashProps) {
  const rvActive = typeFilter === 'RV';

  return (
    <section className="verification-status-dash" aria-label="Verification status">
      <div className="verification-status-dash__grid">
        {STATUS_TILES.map(tile => {
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
                <tile.Icon size={14} strokeWidth={2.25} />
              </span>
              <span className="verification-status-dash__label">{tile.label}</span>
              <span className="verification-status-dash__count">
                {loading ? '—' : count}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className={`verification-status-dash__tile verification-status-dash__tile--orange${
            rvActive ? ' is-active' : ''
          }`}
          onClick={() => onTypeFilterChange(rvActive ? 'all' : 'RV')}
          aria-pressed={rvActive}
          aria-label={`RV: ${rvCount}`}
        >
          <span className="verification-status-dash__icon" aria-hidden>
            <RefreshCw size={14} strokeWidth={2.25} />
          </span>
          <span className="verification-status-dash__label">RV</span>
          <span className="verification-status-dash__count">
            {loading ? '—' : rvCount}
          </span>
        </button>
      </div>
    </section>
  );
}
