import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Filter, Search } from 'lucide-react';
import type { VerificationStatusFilter } from '../lib/verificationRequest';

export type { VerificationStatusFilter } from '../lib/verificationRequest';

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

interface FilterSelectOption {
  value: string;
  label: string;
  count: number;
}

interface GlassFilterSelectProps {
  id: string;
  label: string;
  value: string;
  options: FilterSelectOption[];
  onChange: (value: string) => void;
  wide?: boolean;
}

type MenuPosition = { top: number; left: number; width: number };

const GlassFilterSelect: React.FC<GlassFilterSelectProps> = ({
  id,
  label,
  value,
  options,
  onChange,
  wide = false,
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
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, wide ? 220 : 180),
    });
  }, [wide]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.glass-filter-menu--portal')) return;
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
            className="glass-filter-menu glass-filter-menu--portal"
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
                  className={`glass-filter-option${
                    index === activeIndex ? ' glass-filter-option--active' : ''
                  }${opt.value === value ? ' glass-filter-option--selected' : ''}`}
                  role="option"
                  aria-selected={opt.value === value}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pickOption(opt)}
                >
                  <span className="glass-filter-option-label">{opt.label}</span>
                  <span className="glass-filter-option-count">{opt.count}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div
      className={`glass-filter-select${wide ? ' glass-filter-select--wide' : ''}`}
      ref={rootRef}
    >
      <button
        id={id}
        type="button"
        className={`glass-filter-trigger${open ? ' glass-filter-trigger--open' : ''}`}
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${selected?.label ?? value}`}
      >
        <span className="glass-filter-trigger-value">
          {selected ? `${selected.label} (${selected.count})` : value}
        </span>
        <ChevronDown size={14} className="glass-filter-trigger-chevron" aria-hidden />
      </button>
      {menuPortal}
    </div>
  );
};

interface VerificationListFiltersProps {
  statusFilter: VerificationStatusFilter;
  onStatusFilterChange: (value: VerificationStatusFilter) => void;
  statusOptions: VerificationStatusFilterOption[];
  rcFilter?: string;
  onRcFilterChange?: (value: string) => void;
  rcOptions?: VerificationRcFilterOption[];
  searchTerm?: string;
  onSearchTermChange?: (value: string) => void;
  searchPlaceholder?: string;
}

export const VerificationListFilters: React.FC<VerificationListFiltersProps> = ({
  statusFilter,
  onStatusFilterChange,
  statusOptions,
  rcFilter,
  onRcFilterChange,
  rcOptions,
  searchTerm = '',
  onSearchTermChange,
  searchPlaceholder = 'Search customer, serial, certificate…',
}) => {
  const showRcFilter = Boolean(rcOptions?.length && onRcFilterChange);
  const showSearch = Boolean(onSearchTermChange);

  const rcSelectOptions: FilterSelectOption[] = (rcOptions ?? []).map(opt => ({
    value: opt.value,
    label: opt.value === 'all' ? 'All' : opt.label,
    count: opt.count,
  }));

  const statusSelectOptions: FilterSelectOption[] = statusOptions.map(opt => ({
    value: opt.value,
    label: opt.label,
    count: opt.count,
  }));

  return (
    <div className="verification-list-toolbar">
      {showSearch && (
        <div className="verification-list-search search-wrap">
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

      {showRcFilter && (
        <div className="verification-list-filter">
          <Filter size={16} className="text-muted" aria-hidden />
          <span className="verification-list-filter-label">RC centre</span>
          <GlassFilterSelect
            id="verification-rc-filter"
            label="RC centre"
            value={rcFilter ?? 'all'}
            options={rcSelectOptions}
            onChange={onRcFilterChange!}
            wide
          />
        </div>
      )}

      <div className="verification-list-filter">
        <Filter size={16} className="text-muted" aria-hidden />
        <span className="verification-list-filter-label">Status</span>
        <GlassFilterSelect
          id="verification-status-filter"
          label="Status"
          value={statusFilter}
          options={statusSelectOptions}
          onChange={value => onStatusFilterChange(value as VerificationStatusFilter)}
        />
      </div>
    </div>
  );
};
