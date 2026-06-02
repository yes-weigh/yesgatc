import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, ChevronDown, Crosshair, MapPin, Phone, User, UserRound, X } from 'lucide-react';
import {
  isValidPincode,
  normalizePhone,
  normalizePincode,
} from '../lib/contactFields';
import { filterCustomersForLookup, formatPhoneDisplay } from '../lib/customerLookup';
import type { CustomerFormValues } from '../lib/customerProfileFields';
import { lookupPincode } from '../lib/pincodeLookup';
import type { Customer } from '../types';

type LookupMenuPosition = { top: number; left: number; width: number };

type PartyInformationFormProps = {
  title: string;
  values: CustomerFormValues;
  onChange: (patch: Partial<CustomerFormValues>) => void;
  disabled?: boolean;
  compact?: boolean;
  nameLabel?: string;
  districtLabel?: string;
  lookup?: {
    customers: Customer[];
    selectedCustomerId?: string;
    onSelectCustomer: (customer: Customer) => void;
  };
  /** Show GPS capture for new customers (no selected customer id). */
  locationCapture?: boolean;
};

function RequiredMark() {
  return (
    <span className="party-info-required" aria-hidden>
      *
    </span>
  );
}

function PartyLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="party-info-label">
      {children}
    </label>
  );
}

function FieldIcon({ children }: { children: React.ReactNode }) {
  return <span className="party-info-field-icon">{children}</span>;
}

export const PartyInformationForm: React.FC<PartyInformationFormProps> = ({
  title,
  values,
  onChange,
  disabled = false,
  compact = false,
  nameLabel,
  districtLabel = 'District',
  lookup,
  locationCapture = false,
}) => {
  const listId = useId();
  const nameWrapRef = useRef<HTMLDivElement>(null);
  const phoneWrapRef = useRef<HTMLDivElement>(null);
  const [lookupOpen, setLookupOpen] = useState<'name' | 'phone' | null>(null);
  const [lookupQuery, setLookupQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<LookupMenuPosition | null>(null);
  const [pincodeLookupLoading, setPincodeLookupLoading] = useState(false);
  const [pincodeLookupError, setPincodeLookupError] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const lastPincodeLookupRef = useRef('');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const lookupEnabled = Boolean(lookup && !disabled);
  const suggestions = lookupEnabled
    ? filterCustomersForLookup(lookup!.customers, lookupQuery)
    : [];

  const updateMenuPosition = useCallback((anchor: 'name' | 'phone') => {
    const el = anchor === 'name' ? nameWrapRef.current : phoneWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuStyle({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (!lookupOpen) {
      setMenuStyle(null);
      return;
    }
    updateMenuPosition(lookupOpen);
    window.addEventListener('scroll', () => updateMenuPosition(lookupOpen), true);
    window.addEventListener('resize', () => updateMenuPosition(lookupOpen));
    return () => {
      window.removeEventListener('scroll', () => updateMenuPosition(lookupOpen), true);
      window.removeEventListener('resize', () => updateMenuPosition(lookupOpen));
    };
  }, [lookupOpen, updateMenuPosition, suggestions.length]);

  useEffect(() => {
    if (!lookupOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (nameWrapRef.current?.contains(target)) return;
      if (phoneWrapRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.party-info-lookup-menu--portal')) return;
      setLookupOpen(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [lookupOpen]);

  useEffect(() => {
    const pin = normalizePincode(values.pincode);
    if (!isValidPincode(pin)) {
      lastPincodeLookupRef.current = '';
      setPincodeLookupLoading(false);
      setPincodeLookupError('');
      return;
    }

    if (values.state.trim() && values.district.trim()) {
      lastPincodeLookupRef.current = pin;
      setPincodeLookupLoading(false);
      return;
    }

    if (lastPincodeLookupRef.current === pin) return;

    let cancelled = false;
    setPincodeLookupLoading(true);
    setPincodeLookupError('');

    lookupPincode(pin)
      .then(result => {
        if (cancelled) return;
        if (result) {
          lastPincodeLookupRef.current = pin;
          onChangeRef.current({ state: result.state, district: result.district });
          setPincodeLookupError('');
        } else {
          lastPincodeLookupRef.current = '';
          onChangeRef.current({ state: '', district: '' });
          setPincodeLookupError('No location found for this postal code.');
        }
      })
      .catch(() => {
        if (cancelled) return;
        lastPincodeLookupRef.current = '';
        onChangeRef.current({ state: '', district: '' });
        setPincodeLookupError('Could not look up postal code.');
      })
      .finally(() => {
        if (!cancelled) setPincodeLookupLoading(false);
      });

    return () => {
      cancelled = true;
      setPincodeLookupLoading(false);
    };
  }, [values.pincode, values.state, values.district]);

  const openLookup = (field: 'name' | 'phone', query: string) => {
    if (!lookupEnabled) return;
    setLookupOpen(field);
    setLookupQuery(query);
    setActiveIndex(0);
  };

  const pickCustomer = (customer: Customer) => {
    lookup?.onSelectCustomer(customer);
    setLookupOpen(null);
    setLookupQuery('');
  };

  const handlePincodeChange = (raw: string) => {
    const next = normalizePincode(raw);
    const prev = normalizePincode(values.pincode);
    const patch: Partial<CustomerFormValues> = { pincode: next };
    if (next !== prev) {
      patch.state = '';
      patch.district = '';
      lastPincodeLookupRef.current = '';
      setPincodeLookupError('');
    }
    onChange(patch);
  };

  const handleDetectLocation = () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported in this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        onChange({
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        });
        setLocating(false);
      },
      err => {
        setLocating(false);
        setLocationError(err.message || 'Could not detect location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const handleClearLocation = () => {
    setLocationError('');
    onChange({ latitude: '', longitude: '' });
  };

  const hasLocation = Boolean(values.latitude.trim() && values.longitude.trim());
  const showLocationCapture = locationCapture && !disabled;

  const lookupMenu =
    lookupOpen && menuStyle && lookupEnabled
      ? createPortal(
          suggestions.length > 0 ? (
            <ul
              id={listId}
              className="party-info-lookup-menu party-info-lookup-menu--portal"
              style={{
                top: menuStyle.top,
                left: menuStyle.left,
                width: menuStyle.width,
              }}
              role="listbox"
            >
              {suggestions.map((customer, index) => (
                <li key={customer.id} role="presentation">
                  <button
                    type="button"
                    className={`party-info-lookup-option${
                      index === activeIndex ? ' party-info-lookup-option--active' : ''
                    }${customer.id === lookup?.selectedCustomerId ? ' party-info-lookup-option--selected' : ''}`}
                    role="option"
                    aria-selected={customer.id === lookup?.selectedCustomerId}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => pickCustomer(customer)}
                  >
                    <span className="party-info-lookup-option-name">{customer.name}</span>
                    <span className="party-info-lookup-option-meta">
                      {formatPhoneDisplay(customer.phone)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="party-info-lookup-empty party-info-lookup-menu--portal text-muted text-sm"
              style={{
                top: menuStyle.top,
                left: menuStyle.left,
                width: menuStyle.width,
              }}
            >
              No matching customers. A new customer will be created when you save.
            </div>
          ),
          document.body,
        )
      : null;

  const handleLookupKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    _field: 'name' | 'phone',
  ) => {
    if (!lookupOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, Math.max(suggestions.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && suggestions[activeIndex]) {
      e.preventDefault();
      pickCustomer(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setLookupOpen(null);
    }
  };

  const resolvedNameLabel = nameLabel ?? (compact ? 'Name' : 'Customer Name');
  const mobileLabel = compact ? 'Mobile' : 'Mobile Number';
  const pinLabel = compact ? 'PIN' : 'PIN Code';

  return (
    <section className={`party-information-form${compact ? ' party-information-form--compact' : ''}`}>
      <header className="party-information-form-head">
        <span className="party-information-form-head-icon" aria-hidden>
          <UserRound size={18} />
        </span>
        <h3 className="party-information-form-title">{title}</h3>
      </header>

      <div className="party-information-form-grid">
        <div className="form-group mb-0 party-info-field" ref={nameWrapRef}>
          <PartyLabel htmlFor="party-info-name">
            {resolvedNameLabel} <RequiredMark />
          </PartyLabel>
          <div className="party-info-input-wrap">
            <input
              id="party-info-name"
              type="text"
              className="input-field party-info-input"
              placeholder={compact ? 'Name' : 'Search or enter name'}
              value={values.name}
              onChange={e => {
                const next = e.target.value;
                onChange({ name: next });
                openLookup('name', next);
              }}
              onFocus={() => openLookup('name', values.name)}
              onKeyDown={e => handleLookupKeyDown(e, 'name')}
              disabled={disabled}
              required
              autoComplete="off"
            />
            <FieldIcon>
              <User size={16} />
            </FieldIcon>
          </div>
        </div>

        <div className="form-group mb-0 party-info-field" ref={phoneWrapRef}>
          <PartyLabel htmlFor="party-info-phone">
            {mobileLabel} <RequiredMark />
          </PartyLabel>
          <div className="party-info-input-wrap">
            <input
              id="party-info-phone"
              type="text"
              inputMode="numeric"
              className="input-field party-info-input"
              placeholder={compact ? '10 digits' : 'Search or enter mobile'}
              value={values.phone}
              onChange={e => {
                const next = normalizePhone(e.target.value);
                onChange({ phone: next });
                openLookup('phone', next);
              }}
              onFocus={() => openLookup('phone', values.phone)}
              onKeyDown={e => handleLookupKeyDown(e, 'phone')}
              disabled={disabled}
              required
              maxLength={10}
              autoComplete="off"
            />
            <FieldIcon>
              <Phone size={16} />
            </FieldIcon>
          </div>
        </div>

        <div className="form-group mb-0 party-info-field party-info-field--full">
          <PartyLabel htmlFor="party-info-address">
            Address <RequiredMark />
          </PartyLabel>
          <div className="party-info-input-wrap">
            <input
              id="party-info-address"
              type="text"
              className="input-field party-info-input"
              placeholder="Street, locality"
              value={values.address}
              onChange={e => onChange({ address: e.target.value })}
              disabled={disabled}
              required
            />
          </div>
        </div>

        <div className="party-info-location-row">
          <div className="form-group mb-0 party-info-field">
            <PartyLabel htmlFor="party-info-pincode">
              {pinLabel} <RequiredMark />
            </PartyLabel>
            <div className="party-info-input-wrap">
              <input
                id="party-info-pincode"
                type="text"
                inputMode="numeric"
                className="input-field party-info-input"
                placeholder="6 digits"
                value={values.pincode}
                onChange={e => handlePincodeChange(e.target.value)}
                disabled={disabled}
                maxLength={6}
                required
                aria-describedby={pincodeLookupError ? 'party-info-pincode-error' : undefined}
              />
              <FieldIcon>
                {pincodeLookupLoading ? (
                  <span className="party-info-pin-spinner" aria-label="Looking up location" />
                ) : (
                  <MapPin size={16} />
                )}
              </FieldIcon>
            </div>
            {!pincodeLookupLoading && pincodeLookupError && (
              <p
                id="party-info-pincode-error"
                className="party-info-field-hint party-info-field-hint--error text-sm m-0 mt-1"
                role="alert"
              >
                {pincodeLookupError}
              </p>
            )}
          </div>

          <div className="form-group mb-0 party-info-field">
            <PartyLabel htmlFor="party-info-district">
              {districtLabel} <RequiredMark />
            </PartyLabel>
            <div className="party-info-input-wrap">
              <input
                id="party-info-district"
                type="text"
                className="input-field party-info-input input-readonly"
                value={values.district}
                readOnly
                tabIndex={-1}
                placeholder="Auto"
                aria-label={`${districtLabel} from postal code`}
              />
              <FieldIcon>
                <Building2 size={16} />
              </FieldIcon>
            </div>
          </div>

          <div className="form-group mb-0 party-info-field">
            <PartyLabel htmlFor="party-info-state">
              State <RequiredMark />
            </PartyLabel>
            <div className="party-info-input-wrap party-info-input-wrap--select">
              <input
                id="party-info-state"
                type="text"
                className="input-field party-info-input input-readonly"
                value={values.state}
                readOnly
                tabIndex={-1}
                placeholder="Auto"
                aria-label="State from postal code"
              />
              <FieldIcon>
                <ChevronDown size={16} />
              </FieldIcon>
            </div>
          </div>
        </div>

        {showLocationCapture && (
          <div className="party-info-field party-info-field--full party-info-location">
            <span className="party-info-label party-info-location-label">
              <MapPin size={14} aria-hidden /> GPS
              <span className="party-info-location-optional">Optional</span>
            </span>
            <div className="party-info-location-controls">
              <button
                type="button"
                className="party-info-location-btn"
                onClick={handleDetectLocation}
                disabled={locating}
              >
                {locating ? (
                  <span className="party-info-pin-spinner" aria-label="Detecting location" />
                ) : (
                  <Crosshair size={14} aria-hidden />
                )}
                Use my location
              </button>
              {hasLocation && (
                <button
                  type="button"
                  className="party-info-location-btn party-info-location-btn--clear"
                  onClick={handleClearLocation}
                  disabled={locating}
                  title="Clear location"
                  aria-label="Clear location"
                >
                  <X size={14} aria-hidden />
                </button>
              )}
              <div className="party-info-location-coords">
                <input
                  id="party-info-latitude"
                  type="text"
                  className="input-field party-info-input party-info-input--coords"
                  placeholder="Lat"
                  value={values.latitude}
                  readOnly
                  tabIndex={-1}
                  aria-label="Latitude"
                />
                <input
                  id="party-info-longitude"
                  type="text"
                  className="input-field party-info-input party-info-input--coords"
                  placeholder="Lng"
                  value={values.longitude}
                  readOnly
                  tabIndex={-1}
                  aria-label="Longitude"
                />
              </div>
            </div>
            {locationError && (
              <p className="party-info-field-hint party-info-field-hint--error text-sm m-0 mt-1" role="alert">
                {locationError}
              </p>
            )}
          </div>
        )}
      </div>

      {lookupMenu}
    </section>
  );
};
