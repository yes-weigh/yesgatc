import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { FilterIcon } from './FilterIcon';
import {
  DASHBOARD_PERIODS,
  toInputDate,
  type DashboardPeriod,
} from '../lib/dashboardPeriod';

interface DashboardPeriodFilterProps {
  period: DashboardPeriod;
  customFrom: string;
  customTo: string;
  onPeriodChange: (period: DashboardPeriod) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}

export const DashboardPeriodFilter: React.FC<DashboardPeriodFilterProps> = ({
  period,
  customFrom,
  customTo,
  onPeriodChange,
  onCustomFromChange,
  onCustomToChange,
}) => {
  const [open, setOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const active = period !== 'month';

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (filterRef.current?.contains(target as Node)) return;
      if (target instanceof HTMLElement && (target.tagName === 'OPTION' || target.closest('select'))) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selectPeriod = (next: DashboardPeriod) => {
    onPeriodChange(next);
    if (next !== 'custom' || customFrom || customTo) return;
    const today = toInputDate(new Date());
    onCustomFromChange(today);
    onCustomToChange(today);
  };

  return (
    <div className="wl-dash-period verification-app-filter" ref={filterRef}>
      <button
        type="button"
        className={`verification-app-filter__btn${open || active ? ' verification-app-filter__btn--on' : ''}`}
        aria-label="Filter date range"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <FilterIcon size={18} />
      </button>
      {open ? (
        <div className="verification-app-filter__pop" role="dialog" aria-label="Date range">
          <div className="verification-app-filter__head">
            <p className="verification-app-filter__title">Date range</p>
            <button
              type="button"
              className="verification-app-filter__close"
              onClick={() => setOpen(false)}
              aria-label="Close filters"
            >
              <X size={16} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
          <div className="verification-app-filter__body">
            <label className="verification-app-filter__label" htmlFor="wl-dash-period">
              Period
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="wl-dash-period"
                className="verification-app-filter__select"
                value={period}
                onChange={event => selectPeriod(event.target.value as DashboardPeriod)}
              >
                {DASHBOARD_PERIODS.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {period === 'custom' ? (
              <div className="wl-live__dates">
                <label className="wl-live__date">
                  <span>From</span>
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo || undefined}
                    onChange={event => onCustomFromChange(event.target.value)}
                  />
                </label>
                <label className="wl-live__date">
                  <span>To</span>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom || undefined}
                    onChange={event => onCustomToChange(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
