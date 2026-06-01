import React from 'react';
import { Filter } from 'lucide-react';
import type { VerificationRequestStatus } from '../types';

export type VerificationStatusFilter = VerificationRequestStatus | 'all';

export interface VerificationStatusFilterOption {
  value: VerificationStatusFilter;
  label: string;
  count: number;
}

export interface VerificationRcFilterOption {
  value: string;
  label: string;
  count: number;
}

interface VerificationListFiltersProps {
  statusFilter: VerificationStatusFilter;
  onStatusFilterChange: (value: VerificationStatusFilter) => void;
  statusOptions: VerificationStatusFilterOption[];
  rcFilter?: string;
  onRcFilterChange?: (value: string) => void;
  rcOptions?: VerificationRcFilterOption[];
}

export const VerificationListFilters: React.FC<VerificationListFiltersProps> = ({
  statusFilter,
  onStatusFilterChange,
  statusOptions,
  rcFilter,
  onRcFilterChange,
  rcOptions,
}) => {
  const showRcFilter = Boolean(rcOptions?.length && onRcFilterChange);

  return (
    <div className="verification-list-toolbar">
      <div className="verification-list-filter">
        <Filter size={16} className="text-muted" aria-hidden />
        <label className="verification-list-filter-label" htmlFor="verification-status-filter">
          Status
        </label>
        <select
          id="verification-status-filter"
          className="verification-list-filter-select"
          value={statusFilter}
          onChange={e => onStatusFilterChange(e.target.value as VerificationStatusFilter)}
          aria-label="Filter by verification status"
        >
          {statusOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label} ({opt.count})
            </option>
          ))}
        </select>
      </div>

      {showRcFilter && (
        <div className="verification-list-filter">
          <Filter size={16} className="text-muted" aria-hidden />
          <label className="verification-list-filter-label" htmlFor="verification-rc-filter">
            RC centre
          </label>
          <select
            id="verification-rc-filter"
            className="verification-list-filter-select verification-list-filter-select--wide"
            value={rcFilter ?? 'all'}
            onChange={e => onRcFilterChange?.(e.target.value)}
            aria-label="Filter by regional centre"
          >
            {rcOptions!.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.count})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
