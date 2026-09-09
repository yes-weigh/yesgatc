import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import {
  filterGasAllottedChoices,
  gasAllottedEmptyLabel,
  serialInChoiceList,
} from '../lib/serialEntryPool';

const CHIP_PREVIEW = 16;

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

export function GasAllottedSerialSearch({
  id,
  className,
  choices,
  value,
  onChange,
  disabled,
  showChips = false,
  scopedToVerifier = false,
}: {
  id?: string;
  className?: string;
  choices: readonly string[];
  value: string;
  onChange: (serial: string) => void;
  disabled?: boolean;
  showChips?: boolean;
  scopedToVerifier?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<MenuPosition | null>(null);

  const empty = choices.length === 0;
  const selected = serialInChoiceList(value, choices)
    ? choices.find(item => item.trim().toUpperCase() === value.trim().toUpperCase()) ?? ''
    : '';
  const display = open ? query : selected;
  const placeholderText = empty
    ? gasAllottedEmptyLabel(scopedToVerifier)
    : open && selected && !query
      ? selected
      : 'Search allotted serial';
  const hits = useMemo(
    () => filterGasAllottedChoices(choices, open ? query : ''),
    [choices, open, query],
  );

  const updateMenuPosition = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuStyle({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.gas-serial-search-list')) return;
      setOpen(false);
      setQuery('');
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
  }, [open, updateMenuPosition, hits.length]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = hits.findIndex(item => item.trim().toUpperCase() === selected.toUpperCase());
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, hits, selected]);

  const pick = (serial: string) => {
    onChange(serial);
    setQuery('');
    setOpen(false);
  };

  const commitTyped = (raw: string) => {
    const typed = raw.trim();
    if (!typed) {
      onChange('');
      return;
    }
    const exact = choices.find(item => item.trim().toUpperCase() === typed.toUpperCase());
    if (exact) {
      pick(exact);
      return;
    }
    const filtered = filterGasAllottedChoices(choices, typed);
    if (filtered.length === 1) {
      pick(filtered[0]);
      return;
    }
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setQuery('');
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setQuery('');
        setOpen(true);
        return;
      }
      setActiveIndex(index => (hits.length ? (index + 1) % hits.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return;
      setActiveIndex(index => (hits.length ? (index - 1 + hits.length) % hits.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && hits[activeIndex]) {
        pick(hits[activeIndex]);
        return;
      }
      commitTyped(open ? query : display);
    }
  };

  const preview = hits.slice(0, CHIP_PREVIEW);
  const remaining = choices.length;

  return (
    <div className="gas-serial-search" ref={rootRef}>
      <div className={`gas-serial-search-control${open ? ' gas-serial-search-control--open' : ''}`}>
        <input
          ref={inputRef}
          id={id}
          type="search"
          className={className}
          value={display}
          disabled={disabled || empty}
          placeholder={placeholderText}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          enterKeyHint="search"
          onFocus={() => {
            if (disabled || empty) return;
            setQuery('');
            setOpen(true);
          }}
          onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
            if (selected && event.target.value.trim() === '') onChange('');
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (!rootRef.current) return;
              const next = document.activeElement;
              if (next && rootRef.current.contains(next)) return;
              if (open) commitTyped(query);
            }, 0);
          }}
          onKeyDown={handleKeyDown}
        />
        <ChevronDown size={16} className="gas-serial-search-chevron" aria-hidden />
      </div>

      {open && menuStyle && !empty
        ? createPortal(
            <ul
              id={listId}
              className="gas-serial-search-list product-picker-list product-picker-list--portal"
              style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width }}
              role="listbox"
            >
              {hits.length === 0 ? (
                <li className="gas-serial-search-empty">No unused allotted serial matches.</li>
              ) : (
                hits.map((serial, index) => {
                  const active = index === activeIndex;
                  const picked = serialInChoiceList(selected, [serial]);
                  return (
                    <li key={serial}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={picked}
                        className={`product-picker-option text-mono${active ? ' product-picker-option--active' : ''}`}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => pick(serial)}
                      >
                        {serial}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>,
            document.body,
          )
        : null}

      {showChips && !empty ? (
        <ul className="admin-setting-serial-seats ov-self-allotted-grid">
          {preview.map(serial => {
            const picked = serialInChoiceList(value, [serial]);
            return (
              <li key={serial}>
                <button
                  type="button"
                  className={`admin-setting-serial-seat text-mono${picked ? ' admin-setting-serial-seat--picked' : ''}`}
                  aria-pressed={picked}
                  disabled={disabled}
                  onClick={() => onChange(picked ? '' : serial)}
                >
                  {serial}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {showChips && remaining > CHIP_PREVIEW ? (
        <p className="ov-self-serial-hint ov-self-serial-hint--muted" role="status">
          <span className="ov-self-serial-hint--err">{remaining}</span> remaining — type to search.
        </p>
      ) : null}
    </div>
  );
}
