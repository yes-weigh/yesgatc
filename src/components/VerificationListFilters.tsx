import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, LayoutGrid, Plus, RefreshCw, Search } from 'lucide-react';
import type { VerificationStatusFilter, VerificationTypeFilter } from '../lib/verificationRequest';

export type { VerificationStatusFilter, VerificationTypeFilter } from '../lib/verificationRequest';

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

interface FilterSelectOption {
  value: string;
  label: string;
  count: number;
}

type MenuPosition = { top: number; left: number; width: number };

interface FullWidthFilterSelectProps {
  id: string;
  label: string;
  value: string;
  options: FilterSelectOption[];
  onChange: (value: string) => void;
  variant?: 'primary' | 'secondary';
}

const FullWidthFilterSelect: React.FC<FullWidthFilterSelectProps> = ({
  id,
  label,
  value,
  options,
  onChange,
  variant = 'primary',
}) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<MenuPosition | null>(null);

  const selected = options.find(opt => opt.value === value) ?? options[0];

  const updateMenuPosition = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuStyle({
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.verification-stage-menu--portal')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener('scroll', updateMenuPosition, true);
    window.addEventListener('resize', updateMenuPosition);
    return () => {
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [open, updateMenuPosition, options.length]);

  useEffect(() => {
    if (!open) return;
    const index = options.findIndex(opt => opt.value === value);
    setActiveIndex(index >= 0 ? index : 0);
  }, [open, options, value]);

  const pickOption = (opt: FilterSelectOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex(prev => (prev + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex(prev => (prev - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const pick = options[activeIndex];
      if (pick) pickOption(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const menuPortal =
    open && menuStyle
      ? createPortal(
          <ul
            id={listId}
            className="verification-stage-menu verification-stage-menu--portal"
            style={{
              top: menuStyle.top,
              left: menuStyle.left,
              width: menuStyle.width,
            }}
            role="listbox"
            aria-label={label}
          >
            {options.map((opt, index) => (
              <li key={opt.value} role="presentation">
                <button
                  type="button"
                  className={`verification-stage-option${
                    index === activeIndex ? ' verification-stage-option--active' : ''
                  }${opt.value === value ? ' verification-stage-option--selected' : ''}`}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pickOption(opt)}
                >
                  <span className="verification-stage-option-label">{opt.label}</span>
                  <span className="verification-stage-option-count">{opt.count}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div
      className={`verification-stage-select verification-stage-select--${variant}`}
      ref={rootRef}
    >
      <button
        id={id}
        type="button"
        className={`verification-stage-bar${open ? ' verification-stage-bar--open' : ''}`}
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${selected?.label ?? value}`}
      >
        <LayoutGrid size={18} className="verification-stage-bar-icon" aria-hidden />
        <span className="verification-stage-bar-label">{selected?.label ?? value}</span>
        <ChevronDown size={18} className="verification-stage-bar-chevron" aria-hidden />
      </button>
      {menuPortal}
    </div>
  );
};

interface VerificationListFiltersProps {
  statusFilter: VerificationStatusFilter;
  onStatusFilterChange: (value: VerificationStatusFilter) => void;
  statusOptions: VerificationStatusFilterOption[];
  typeFilter?: VerificationTypeFilter;
  onTypeFilterChange?: (value: VerificationTypeFilter) => void;
  typeOptions?: VerificationTypeFilterOption[];
  rcFilter?: string;
  onRcFilterChange?: (value: string) => void;
  rcOptions?: VerificationRcFilterOption[];
  searchTerm?: string;
  onSearchTermChange?: (value: string) => void;
  searchPlaceholder?: string;
  onNewClick?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const VerificationListFilters: React.FC<VerificationListFiltersProps> = ({
  statusFilter,
  onStatusFilterChange,
  statusOptions,
  typeFilter = 'all',
  onTypeFilterChange,
  typeOptions,
  rcFilter,
  onRcFilterChange,
  rcOptions,
  searchTerm = '',
  onSearchTermChange,
  searchPlaceholder = 'Search verification…',
  onNewClick,
  onRefresh,
  refreshing = false,
}) => {
  const showRcFilter = Boolean(rcOptions?.length && rcOptions.length > 1 && onRcFilterChange);
  const showSearch = Boolean(onSearchTermChange);

  const rcSelectOptions: FilterSelectOption[] = (rcOptions ?? []).map(opt => ({
    value: opt.value,
    label: opt.value === 'all' ? 'All RC' : opt.label,
    count: opt.count,
  }));

  const showTypeBadges = Boolean(typeOptions?.length && onTypeFilterChange);

  const statusSelectOptions: FilterSelectOption[] = statusOptions.map(opt => ({
    value: opt.value,
    label: opt.label,
    count: opt.count,
  }));

  return (
    <div className="verification-list-toolbar-ref">
      <FullWidthFilterSelect
        id="verification-status-filter"
        label="Stage"
        value={statusFilter}
        options={statusSelectOptions}
        onChange={value => onStatusFilterChange(value as VerificationStatusFilter)}
        variant="primary"
      />

      {showRcFilter && (
        <FullWidthFilterSelect
          id="verification-rc-filter"
          label="RC centre"
          value={rcFilter ?? 'all'}
          options={rcSelectOptions}
          onChange={onRcFilterChange!}
          variant="secondary"
        />
      )}

      {showTypeBadges && (
        <div className="verification-type-badges" role="group" aria-label="Verification type">
          {typeOptions!.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={`verification-type-badge${
                typeFilter === opt.value ? ' verification-type-badge--active' : ''
              }`}
              aria-pressed={typeFilter === opt.value}
              onClick={() => onTypeFilterChange!(opt.value)}
            >
              {opt.label}
              <span className="badge-count">{opt.count}</span>
            </button>
          ))}
        </div>
      )}

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
