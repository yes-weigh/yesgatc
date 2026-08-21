import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, RefreshCw, Search, X } from 'lucide-react';
import { FilterIcon } from './FilterIcon';
import {
  VERIFICATION_DURATION_OPTIONS,
  type VerificationDurationFilter,
} from '../lib/verificationListDuration';
import type { VerificationStatusFilter, VerificationTypeFilter } from '../lib/verificationRequest';

export type { VerificationStatusFilter, VerificationTypeFilter } from '../lib/verificationRequest';
export type VerificationPaymentDueFilter = 'all' | 'due';

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

export interface VerificationTypeFilterOption {
  value: VerificationTypeFilter;
  label: string;
  count: number;
}

interface VerificationListFiltersProps {
  statusFilter: VerificationStatusFilter;
  onStatusFilterChange: (value: VerificationStatusFilter) => void;
  statusOptions: VerificationStatusFilterOption[];
  typeFilter?: VerificationTypeFilter;
  onTypeFilterChange?: (value: VerificationTypeFilter) => void;
  typeOptions?: VerificationTypeFilterOption[];
  durationFilter?: VerificationDurationFilter;
  onDurationFilterChange?: (value: VerificationDurationFilter) => void;
  rcFilter?: string;
  onRcFilterChange?: (value: string) => void;
  rcOptions?: VerificationRcFilterOption[];
  paymentDueFilter?: VerificationPaymentDueFilter;
  onPaymentDueFilterChange?: (value: VerificationPaymentDueFilter) => void;
  paymentDueCount?: number;
  paymentDueAllCount?: number;
  searchTerm?: string;
  onSearchTermChange?: (value: string) => void;
  searchPlaceholder?: string;
  onNewClick?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

function typeLabel(value: VerificationTypeFilter, options?: VerificationTypeFilterOption[]): string {
  if (value === 'all') return 'All';
  return options?.find(opt => opt.value === value)?.label || value;
}

export const VerificationListFilters: React.FC<VerificationListFiltersProps> = ({
  statusFilter,
  onStatusFilterChange,
  statusOptions,
  typeFilter = 'all',
  onTypeFilterChange,
  typeOptions,
  durationFilter = 'all',
  onDurationFilterChange,
  rcFilter,
  onRcFilterChange,
  rcOptions,
  paymentDueFilter = 'all',
  onPaymentDueFilterChange,
  paymentDueCount = 0,
  paymentDueAllCount = 0,
  searchTerm = '',
  onSearchTermChange,
  searchPlaceholder = 'Search verification…',
  onNewClick,
  onRefresh,
  refreshing = false,
}) => {
  const showRcFilter = Boolean(rcOptions?.length && rcOptions.length > 1 && onRcFilterChange);
  const showSearch = Boolean(onSearchTermChange);
  const showType = Boolean(typeOptions?.length && onTypeFilterChange);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState(statusFilter);
  const [draftType, setDraftType] = useState(typeFilter);
  const [draftDuration, setDraftDuration] = useState(durationFilter);
  const [draftRc, setDraftRc] = useState(rcFilter ?? 'all');
  const [draftPaymentDue, setDraftPaymentDue] = useState(paymentDueFilter);
  const filterRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ mobile: HTMLElement | null; desktop: HTMLElement | null }>({
    mobile: null,
    desktop: null,
  });

  const filterActive =
    statusFilter !== 'all' ||
    typeFilter !== 'all' ||
    durationFilter !== 'all' ||
    (rcFilter != null && rcFilter !== 'all') ||
    paymentDueFilter === 'due';

  useLayoutEffect(() => {
    setSlots({
      mobile: document.getElementById('verification-filter-slot-mobile'),
      desktop: document.getElementById('verification-filter-slot-desktop'),
    });
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    setDraftStatus(statusFilter);
    setDraftType(typeFilter);
    setDraftDuration(durationFilter);
    setDraftRc(rcFilter ?? 'all');
    setDraftPaymentDue(paymentDueFilter);
  }, [filterOpen, statusFilter, typeFilter, durationFilter, rcFilter, paymentDueFilter]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (filterRef.current?.contains(target as Node)) return;
      if (target instanceof HTMLElement && (target.tagName === 'OPTION' || target.closest('select'))) {
        return;
      }
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  const filterControl = (
    <div className="verification-app-filter" ref={filterRef}>
      <button
        type="button"
        className={`verification-app-filter__btn${filterOpen || filterActive ? ' verification-app-filter__btn--on' : ''}`}
        aria-label="Filter verifications"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen(open => !open)}
      >
        <FilterIcon size={18} />
      </button>
      {filterOpen ? (
        <div className="verification-app-filter__pop" role="dialog" aria-label="Verification filters">
          <div className="verification-app-filter__head">
            <p className="verification-app-filter__title">Filters</p>
            <button
              type="button"
              className="verification-app-filter__close"
              onClick={() => setFilterOpen(false)}
              aria-label="Close filters"
            >
              <X size={16} strokeWidth={2.2} aria-hidden />
            </button>
          </div>

          <div className="verification-app-filter__body">
            <label className="verification-app-filter__label" htmlFor="verification-filter-stage">
              Stages
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="verification-filter-stage"
                className="verification-app-filter__select"
                value={draftStatus}
                onChange={event => setDraftStatus(event.target.value as VerificationStatusFilter)}
              >
                {statusOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label.replace(/^All stages$/, 'All')} ({opt.count})
                  </option>
                ))}
              </select>
            </div>

            {showType ? (
              <>
                <label className="verification-app-filter__label" htmlFor="verification-filter-type">
                  Type
                </label>
                <div className="verification-app-filter__select-wrap">
                  <select
                    id="verification-filter-type"
                    className="verification-app-filter__select"
                    value={draftType}
                    onChange={event => setDraftType(event.target.value as VerificationTypeFilter)}
                  >
                    {typeOptions!.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {typeLabel(opt.value, typeOptions)} ({opt.count})
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}

            {onDurationFilterChange ? (
              <>
                <label className="verification-app-filter__label" htmlFor="verification-filter-duration">
                  Duration
                </label>
                <div className="verification-app-filter__select-wrap">
                  <select
                    id="verification-filter-duration"
                    className="verification-app-filter__select"
                    value={draftDuration}
                    onChange={event =>
                      setDraftDuration(event.target.value as VerificationDurationFilter)
                    }
                  >
                    {VERIFICATION_DURATION_OPTIONS.map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}

            {showRcFilter ? (
              <>
                <label className="verification-app-filter__label" htmlFor="verification-filter-rc">
                  Regional centre
                </label>
                <div className="verification-app-filter__select-wrap">
                  <select
                    id="verification-filter-rc"
                    className="verification-app-filter__select"
                    value={draftRc}
                    onChange={event => setDraftRc(event.target.value)}
                  >
                    {rcOptions!.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.value === 'all' ? 'All RC' : opt.label} ({opt.count})
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}

            {onPaymentDueFilterChange ? (
              <>
                <label className="verification-app-filter__label" htmlFor="verification-filter-payment">
                  Payment
                </label>
                <div className="verification-app-filter__select-wrap">
                  <select
                    id="verification-filter-payment"
                    className="verification-app-filter__select"
                    value={draftPaymentDue}
                    onChange={event =>
                      setDraftPaymentDue(event.target.value as VerificationPaymentDueFilter)
                    }
                  >
                    <option value="all">All ({paymentDueAllCount})</option>
                    <option value="due">Payment due ({paymentDueCount})</option>
                  </select>
                </div>
              </>
            ) : null}
          </div>

          <div className="verification-app-filter__foot">
            <button
              type="button"
              className="verification-app-filter__clear"
              onClick={() => {
                setDraftStatus('all');
                setDraftType('all');
                setDraftDuration('all');
                setDraftRc('all');
                setDraftPaymentDue('all');
                onStatusFilterChange('all');
                onTypeFilterChange?.('all');
                onDurationFilterChange?.('all');
                onRcFilterChange?.('all');
                onPaymentDueFilterChange?.('all');
                setFilterOpen(false);
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="verification-app-filter__apply"
              onClick={() => {
                onStatusFilterChange(draftStatus);
                onTypeFilterChange?.(draftType);
                onDurationFilterChange?.(draftDuration);
                onRcFilterChange?.(draftRc);
                onPaymentDueFilterChange?.(draftPaymentDue);
                setFilterOpen(false);
              }}
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  const slot = slots.mobile ?? slots.desktop;

  return (
    <div className="verification-list-toolbar-ref">
      {slot ? createPortal(filterControl, slot) : null}

      <div className="verification-list-actions-row">
        {onNewClick && (
          <button
            type="button"
            className="verification-list-new-btn"
            onClick={onNewClick}
            aria-label="New verification job"
          >
            <span className="verification-list-new-btn-icon" aria-hidden>
              <Plus size={20} strokeWidth={2.5} />
            </span>
            <span className="verification-list-new-btn-text">
              <span className="verification-list-new-btn-title">New</span>
              <span className="verification-list-new-btn-sub">New verification job</span>
            </span>
          </button>
        )}

        {showSearch && (
          <div className="verification-list-search-ref search-wrap">
            <Search size={16} className="search-icon" aria-hidden />
            <input
              type="search"
              className="search-input"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={e => onSearchTermChange?.(e.target.value)}
              aria-label="Search verification jobs"
            />
          </div>
        )}

        {!slot ? filterControl : null}

        {onRefresh && (
          <button
            type="button"
            className="verification-list-refresh-btn btn-icon"
            onClick={onRefresh}
            title="Refresh list"
            aria-label="Refresh list"
            disabled={refreshing}
          >
            <RefreshCw size={18} className={refreshing ? 'spinner-inline' : undefined} />
          </button>
        )}
      </div>
    </div>
  );
};
