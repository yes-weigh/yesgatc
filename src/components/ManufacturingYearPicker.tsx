import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, Check, ChevronDown, X } from 'lucide-react';
import { manufacturingYearOptions } from '../lib/verificationRvDeviceImages';

type ManufacturingYearPickerProps = {
  value: string;
  onChange: (year: string) => void;
  disabled?: boolean;
  id?: string;
  readOnly?: boolean;
};

type YearGroup = {
  label: string;
  years: number[];
};

function groupYearsByDecade(years: number[]): YearGroup[] {
  const buckets = new Map<number, number[]>();
  for (const year of years) {
    const decade = Math.floor(year / 10) * 10;
    const list = buckets.get(decade) ?? [];
    list.push(year);
    buckets.set(decade, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => b - a)
    .map(([decade, decadeYears]) => ({
      label: `${decade}s`,
      years: decadeYears.sort((a, b) => b - a),
    }));
}

export const ManufacturingYearPicker: React.FC<ManufacturingYearPickerProps> = ({
  value,
  onChange,
  disabled = false,
  id,
  readOnly = false,
}) => {
  const years = useMemo(() => manufacturingYearOptions(), []);
  const groups = useMemo(() => groupYearsByDecade(years), [years]);
  const fallbackId = useId();
  const pickerId = id ?? fallbackId;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  const selectedYear = value.trim();
  const hasSelection = Boolean(selectedYear);

  const updatePanelPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(288, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8));
    const estimatedHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < estimatedHeight && rect.top > estimatedHeight;

    setPanelStyle({
      position: 'fixed',
      top: openUp ? rect.top - 8 : rect.bottom + 6,
      left,
      width: panelWidth,
      transform: openUp ? 'translateY(-100%)' : undefined,
      visibility: 'visible',
      zIndex: 10050,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();
  }, [open, groups.length]);

  useEffect(() => {
    if (!open) return;

    const onScrollOrResize = () => updatePanelPosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);

    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selectYear = (year: number) => {
    onChange(String(year));
    setOpen(false);
  };

  const clearYear = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onChange('');
    setOpen(false);
  };

  if (readOnly) {
    return (
      <span className="mfg-year-readonly-badge">
        {hasSelection ? selectedYear : <span className="text-muted">Not set</span>}
      </span>
    );
  }

  const panel = open ? (
    <div
      ref={panelRef}
      className="mfg-year-picker-panel"
      style={panelStyle}
      role="listbox"
      aria-label="Year of manufacturing"
      aria-activedescendant={hasSelection ? `${pickerId}-year-${selectedYear}` : undefined}
    >
      <div className="mfg-year-picker-panel-head">
        <p className="mfg-year-picker-panel-title">Year of manufacturing</p>
        <p className="mfg-year-picker-panel-hint">Current year to last 15 years</p>
      </div>

      <div className="mfg-year-picker-groups">
        {groups.map(group => (
          <div key={group.label} className="mfg-year-picker-group">
            <p className="mfg-year-picker-decade">{group.label}</p>
            <div className="mfg-year-picker-grid">
              {group.years.map(year => {
                const isSelected = selectedYear === String(year);
                return (
                  <button
                    key={year}
                    id={`${pickerId}-year-${year}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`mfg-year-picker-option${isSelected ? ' mfg-year-picker-option--selected' : ''}`}
                    onClick={() => selectYear(year)}
                  >
                    <span>{year}</span>
                    {isSelected && <Check size={14} className="mfg-year-picker-option-check" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={`mfg-year-picker${open ? ' mfg-year-picker--open' : ''}`}>
      <button
        ref={triggerRef}
        id={pickerId}
        type="button"
        className={`mfg-year-picker-trigger${hasSelection ? ' mfg-year-picker-trigger--selected' : ''}`}
        onClick={event => {
          if (disabled) return;
          if ((event.target as HTMLElement).closest('.mfg-year-picker-clear')) return;
          setOpen(prev => !prev);
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={hasSelection ? `Year of manufacturing: ${selectedYear}` : 'Select year of manufacturing'}
      >
        <span className="mfg-year-picker-trigger-icon" aria-hidden>
          <Calendar size={15} />
        </span>
        <span className="mfg-year-picker-trigger-text">
          {hasSelection ? selectedYear : 'Select year'}
        </span>
        {hasSelection && !disabled && (
          <span
            className="mfg-year-picker-clear"
            role="presentation"
            onMouseDown={clearYear}
            onClick={clearYear}
            aria-hidden
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={15} className={`mfg-year-picker-chevron${open ? ' mfg-year-picker-chevron--open' : ''}`} aria-hidden />
      </button>

      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  );
};
