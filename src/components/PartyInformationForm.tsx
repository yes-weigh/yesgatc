import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  ChevronDown,
  Crosshair,
  Hash,
  Mail,
  Map,
  MapPin,
  Phone,
  RefreshCw,
  User,
  UserRound,
  X,
} from 'lucide-react';
import {
  buildTelUrl,
  buildWhatsAppContactUrl,
  isValidPincode,
  normalizePhone,
  normalizePincode,
} from '../lib/contactFields';
import { filterCustomersForLookup, formatPhoneDisplay } from '../lib/customerLookup';
import { customerFormMapsUrl, type CustomerFormValues } from '../lib/customerProfileFields';
import { lookupPincode } from '../lib/pincodeLookup';
import type { Customer } from '../types';

type LookupMenuPosition = { top: number; left: number; width: number };

type PartyRowTone = 'emerald' | 'sky' | 'violet' | 'cyan';

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
  /** Show GPS capture on the party step. */
  locationCapture?: boolean;
  /** Optional email row (customer profile only). */
  showEmail?: boolean;
  /** When false, PIN is optional (customer page save still allows empty PIN). */
  pincodeRequired?: boolean;
  footer?: React.ReactNode;
  /** Square shop photo slot — identity fields render beside it (customer form). */
  heroPhoto?: React.ReactNode;
  hideHeader?: boolean;
  /** View-only display — no inputs (customer profile view mode). */
  readOnly?: boolean;
};

function WhatsAppIcon() {
  return (
    <svg className="party-info-row-icon-mark" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

function PartyInfoRow({
  tone,
  icon,
  children,
  action,
  fieldRef,
}: {
  tone: PartyRowTone;
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  fieldRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div className={`party-info-row party-info-row--${tone}`}>
      <span className="party-info-row-icon" aria-hidden>
        {icon}
      </span>
      <div className="party-info-row-field" ref={fieldRef}>
        {children}
      </div>
      {action ? <div className="party-info-row-actions">{action}</div> : null}
    </div>
  );
}

function HeroWhatsAppIcon() {
  return (
    <svg className="customer-form-hero-contact-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
      />
    </svg>
  );
}

function HeroPhoneContactActions({ phone }: { phone: string }) {
  const telUrl = buildTelUrl(phone);
  const whatsAppUrl = buildWhatsAppContactUrl(phone);

  return (
    <div className="customer-form-hero-contact-actions">
      {telUrl ? (
        <a
          href={telUrl}
          className="customer-form-hero-contact-btn customer-form-hero-contact-btn--call"
        >
          <Phone size={13} strokeWidth={2.25} aria-hidden />
          Call
        </a>
      ) : (
        <span className="customer-form-hero-contact-btn customer-form-hero-contact-btn--disabled" aria-disabled>
          <Phone size={13} strokeWidth={2.25} aria-hidden />
          Call
        </span>
      )}
      {whatsAppUrl ? (
        <a
          href={whatsAppUrl}
          className="customer-form-hero-contact-btn customer-form-hero-contact-btn--whatsapp"
          target="_blank"
          rel="noopener noreferrer"
        >
          <HeroWhatsAppIcon />
          WhatsApp
        </a>
      ) : (
        <span className="customer-form-hero-contact-btn customer-form-hero-contact-btn--disabled" aria-disabled>
          <HeroWhatsAppIcon />
          WhatsApp
        </span>
      )}
    </div>
  );
}

function HeroMapAction({ mapsUrl }: { mapsUrl: string | null }) {
  if (mapsUrl) {
    return (
      <a
        href={mapsUrl}
        className="customer-form-hero-contact-btn customer-form-hero-contact-btn--map"
        target="_blank"
        rel="noopener noreferrer"
        title="Open in Google Maps"
      >
        <MapPin size={13} strokeWidth={2.25} aria-hidden />
        Map
      </a>
    );
  }

  return (
    <span
      className="customer-form-hero-contact-btn customer-form-hero-contact-btn--disabled"
      aria-disabled
      title="No GPS location set"
    >
      <MapPin size={13} strokeWidth={2.25} aria-hidden />
      Map
    </span>
  );
}

function CustomerHeroField({
  icon,
  label,
  htmlFor,
  children,
  action,
  className,
  fieldRef,
}: {
  icon: React.ReactNode;
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  fieldRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      className={`customer-form-hero-field${className ? ` ${className}` : ''}`}
      ref={fieldRef}
    >
      <span className="customer-form-hero-field-icon" aria-hidden>
        {icon}
      </span>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="sr-only">
          {label}
        </label>
      ) : (
        <span className="sr-only">{label}</span>
      )}
      <div className="customer-form-hero-field-body">{children}</div>
      {action ? <div className="customer-form-hero-field-actions">{action}</div> : null}
    </div>
  );
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
  showEmail = false,
  pincodeRequired = true,
  footer,
  heroPhoto,
  hideHeader = false,
  readOnly = false,
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
  const gpsDisplay = hasLocation
    ? `${values.latitude}, ${values.longitude}`
    : '';

  const identityInHero = Boolean(heroPhoto);
  const showSectionHeader = !hideHeader && !identityInHero;
  const showFieldChrome = identityInHero;
  const fieldsLocked = identityInHero && readOnly;
  const heroFieldChromeClass = showFieldChrome ? 'customer-form-hero-field--editable' : undefined;
  const heroInputClass = showFieldChrome
    ? 'customer-form-hero-input customer-form-hero-input--editable'
    : 'party-info-row-input';
  const heroReadonlyClass = showFieldChrome
    ? 'customer-form-hero-input customer-form-hero-input--editable customer-form-hero-input--readonly'
    : 'party-info-row-input party-info-row-input--readonly';

  const phoneInput = (
    <input
      id="party-info-phone"
      type="text"
      inputMode="numeric"
      className={heroInputClass}
      placeholder={compact ? '10-digit mobile' : 'Search or enter mobile'}
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
  );

  const nameInput = (
    <input
      id="party-info-name"
      type="text"
      className={
        identityInHero
          ? 'customer-form-hero-input customer-form-hero-input--name customer-form-hero-input--editable'
          : 'party-info-row-input'
      }
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
  );

  const emailInput = showEmail ? (
    <input
      id="party-info-email"
      type="email"
      className={heroInputClass}
      placeholder="Email (optional)"
      value={values.email}
      onChange={e => onChange({ email: e.target.value })}
      disabled={disabled}
      autoComplete="off"
    />
  ) : null;

  const lookupChevron = lookupEnabled ? (
    <span className="party-info-row-chevron" aria-hidden>
      <ChevronDown size={16} />
    </span>
  ) : null;

  const mapsUrl = fieldsLocked ? customerFormMapsUrl(values) : null;

  return (
    <section
      className={`party-information-form party-information-form--rows${
        compact ? ' party-information-form--compact' : ''
      }${identityInHero ? ' party-information-form--hero' : ''}${
        showFieldChrome ? ' party-information-form--editing' : ''
      }${fieldsLocked ? ' party-information-form--locked' : ''}`}
    >
      {showSectionHeader && (
        <header className="party-information-form-head">
          <span className="party-information-form-head-icon" aria-hidden>
            <UserRound size={18} />
          </span>
          <h3 className="party-information-form-title">{title}</h3>
        </header>
      )}

      {identityInHero && (
        <div className="customer-form-hero">
          <div className="customer-form-hero-photo">{heroPhoto}</div>
          <div className="customer-form-hero-identity">
            <div
              className={`customer-form-hero-field customer-form-hero-field--name${
                heroFieldChromeClass ? ` ${heroFieldChromeClass}` : ''
              }`}
              ref={nameWrapRef}
            >
              <label htmlFor="party-info-name" className="sr-only">
                {resolvedNameLabel}
              </label>
              {nameInput}
            </div>
            <div
              className={`customer-form-hero-field customer-form-hero-field--phone customer-form-hero-field--mono${
                heroFieldChromeClass ? ` ${heroFieldChromeClass}` : ''
              }`}
              ref={phoneWrapRef}
            >
              <span className="customer-form-hero-field-icon customer-form-hero-field-icon--phone" aria-hidden>
                <Phone size={14} strokeWidth={2.25} />
              </span>
              <label htmlFor="party-info-phone" className="sr-only">
                {mobileLabel}
              </label>
              {phoneInput}
              {!fieldsLocked && lookupChevron}
            </div>
            {showEmail && emailInput && (
              <div
                className={`customer-form-hero-field customer-form-hero-field--email customer-form-hero-field--mono${
                  heroFieldChromeClass ? ` ${heroFieldChromeClass}` : ''
                }`}
              >
                <span className="customer-form-hero-field-icon customer-form-hero-field-icon--email" aria-hidden>
                  <Mail size={14} strokeWidth={2.25} />
                </span>
                <label htmlFor="party-info-email" className="sr-only">
                  Email
                </label>
                {emailInput}
              </div>
            )}
            {footer}
          </div>
          {fieldsLocked && (
            <div className="customer-form-hero-contact-row">
              <HeroPhoneContactActions phone={values.phone} />
            </div>
          )}
        </div>
      )}

      <div className="party-information-form-rows">
        {!identityInHero && (
          <PartyInfoRow
            tone="emerald"
            icon={<WhatsAppIcon />}
            fieldRef={phoneWrapRef}
            action={lookupChevron}
          >
            <label htmlFor="party-info-phone" className="sr-only">
              {mobileLabel}
            </label>
            {phoneInput}
          </PartyInfoRow>
        )}

        {!identityInHero && (
          <PartyInfoRow
            tone="emerald"
            icon={<User strokeWidth={2} />}
            fieldRef={nameWrapRef}
            action={lookupChevron}
          >
            <label htmlFor="party-info-name" className="sr-only">
              {resolvedNameLabel}
            </label>
            {nameInput}
          </PartyInfoRow>
        )}

        {!identityInHero && showEmail && emailInput && (
          <PartyInfoRow tone="sky" icon={<Mail strokeWidth={2} />}>
            <label htmlFor="party-info-email" className="sr-only">
              Email
            </label>
            {emailInput}
          </PartyInfoRow>
        )}

        {identityInHero ? (
          <CustomerHeroField
            icon={<MapPin size={14} strokeWidth={2.25} />}
            label="Address"
            htmlFor="party-info-address"
            className={heroFieldChromeClass}
            action={fieldsLocked ? <HeroMapAction mapsUrl={mapsUrl} /> : undefined}
          >
            <input
              id="party-info-address"
              type="text"
              className={heroInputClass}
              placeholder="Street, locality"
              value={values.address}
              onChange={e => onChange({ address: e.target.value })}
              disabled={disabled}
              required
            />
          </CustomerHeroField>
        ) : (
          <PartyInfoRow tone="sky" icon={<MapPin strokeWidth={2} />}>
            <label htmlFor="party-info-address" className="sr-only">
              Address
            </label>
            <input
              id="party-info-address"
              type="text"
              className="party-info-row-input"
              placeholder="Street, locality"
              value={values.address}
              onChange={e => onChange({ address: e.target.value })}
              disabled={disabled}
              required
            />
          </PartyInfoRow>
        )}

        {identityInHero ? (
          <CustomerHeroField
            icon={
              !readOnly && pincodeLookupLoading ? (
                <span className="customer-form-hero-pin-spinner" aria-label="Looking up location" />
              ) : (
                <Hash size={14} strokeWidth={2.25} />
              )
            }
            label={pinLabel}
            htmlFor="party-info-pincode"
            className={['customer-form-hero-field--mono', heroFieldChromeClass].filter(Boolean).join(' ')}
          >
            <input
              id="party-info-pincode"
              type="text"
              inputMode="numeric"
              className={heroInputClass}
              placeholder="6-digit PIN"
              value={values.pincode}
              onChange={e => handlePincodeChange(e.target.value)}
              disabled={disabled}
              maxLength={6}
              required={pincodeRequired}
              aria-describedby={pincodeLookupError ? 'party-info-pincode-error' : undefined}
            />
          </CustomerHeroField>
        ) : (
          <PartyInfoRow
            tone="violet"
            icon={
              pincodeLookupLoading ? (
                <span className="party-info-pin-spinner" aria-label="Looking up location" />
              ) : (
                <MapPin strokeWidth={2} />
              )
            }
          >
            <label htmlFor="party-info-pincode" className="sr-only">
              {pinLabel}
            </label>
            <input
              id="party-info-pincode"
              type="text"
              inputMode="numeric"
              className="party-info-row-input"
              placeholder="6-digit PIN"
              value={values.pincode}
              onChange={e => handlePincodeChange(e.target.value)}
              disabled={disabled}
              maxLength={6}
              required={pincodeRequired}
              aria-describedby={pincodeLookupError ? 'party-info-pincode-error' : undefined}
            />
          </PartyInfoRow>
        )}
        {!pincodeLookupLoading && pincodeLookupError && (
          <p
            id="party-info-pincode-error"
            className="party-info-rows-error"
            role="alert"
          >
            {pincodeLookupError}
          </p>
        )}

        {identityInHero ? (
          <CustomerHeroField
            icon={<Building2 size={14} strokeWidth={2.25} />}
            label={districtLabel}
            htmlFor="party-info-district"
            className={heroFieldChromeClass}
          >
            <input
              id="party-info-district"
              type="text"
              className={heroReadonlyClass}
              value={values.district}
              readOnly
              tabIndex={-1}
              placeholder="Auto from PIN"
              aria-label={`${districtLabel} from postal code`}
            />
          </CustomerHeroField>
        ) : (
          <PartyInfoRow tone="violet" icon={<Building2 strokeWidth={2} />}>
            <label htmlFor="party-info-district" className="sr-only">
              {districtLabel}
            </label>
            <input
              id="party-info-district"
              type="text"
              className="party-info-row-input party-info-row-input--readonly"
              value={values.district}
              readOnly
              tabIndex={-1}
              placeholder="Auto from PIN"
              aria-label={`${districtLabel} from postal code`}
            />
          </PartyInfoRow>
        )}

        {identityInHero ? (
          <CustomerHeroField
            icon={<Map size={14} strokeWidth={2.25} />}
            label="State"
            htmlFor="party-info-state"
            className={heroFieldChromeClass}
          >
            <input
              id="party-info-state"
              type="text"
              className={heroReadonlyClass}
              value={values.state}
              readOnly
              tabIndex={-1}
              placeholder="Auto from PIN"
              aria-label="State from postal code"
            />
          </CustomerHeroField>
        ) : (
          <PartyInfoRow
            tone="violet"
            icon={<Map strokeWidth={2} />}
            action={
              <span className="party-info-row-chevron" aria-hidden>
                <ChevronDown size={16} />
              </span>
            }
          >
            <label htmlFor="party-info-state" className="sr-only">
              State
            </label>
            <input
              id="party-info-state"
              type="text"
              className="party-info-row-input party-info-row-input--readonly"
              value={values.state}
              readOnly
              tabIndex={-1}
              placeholder="Auto from PIN"
              aria-label="State from postal code"
            />
          </PartyInfoRow>
        )}

        {showLocationCapture &&
          (identityInHero ? (
            <>
              <CustomerHeroField
                icon={<Crosshair size={14} strokeWidth={2.25} />}
                label="GPS coordinates"
                className={['customer-form-hero-field--mono', heroFieldChromeClass]
                  .filter(Boolean)
                  .join(' ')}
                action={
                  fieldsLocked ? undefined : (
                    <>
                      <button
                        type="button"
                        className="customer-form-hero-action-btn"
                        onClick={handleDetectLocation}
                        disabled={locating || disabled}
                        title="Update GPS location"
                        aria-label="Update GPS location"
                      >
                        {locating ? (
                          <span className="customer-form-hero-pin-spinner" aria-label="Detecting location" />
                        ) : (
                          <RefreshCw size={14} strokeWidth={2.25} />
                        )}
                      </button>
                      {hasLocation && (
                        <button
                          type="button"
                          className="customer-form-hero-action-btn customer-form-hero-action-btn--muted"
                          onClick={handleClearLocation}
                          disabled={locating || disabled}
                          title="Clear location"
                          aria-label="Clear location"
                        >
                          <X size={14} strokeWidth={2.25} />
                        </button>
                      )}
                    </>
                  )
                }
              >
                <input
                  id="party-info-gps"
                  type="text"
                  className={heroInputClass}
                  value={hasLocation ? gpsDisplay : ''}
                  readOnly
                  tabIndex={-1}
                  placeholder={fieldsLocked ? 'No GPS captured' : 'Tap refresh to capture GPS'}
                  aria-label="GPS coordinates"
                  aria-live="polite"
                />
              </CustomerHeroField>
              {locationError && (
                <p className="party-info-rows-error" role="alert">
                  {locationError}
                </p>
              )}
            </>
          ) : (
            <>
              <PartyInfoRow
                tone="cyan"
                icon={<Crosshair strokeWidth={2} />}
                action={
                  <>
                    <button
                      type="button"
                      className="party-info-row-action-btn"
                      onClick={handleDetectLocation}
                      disabled={locating || disabled}
                      title="Update GPS location"
                      aria-label="Update GPS location"
                    >
                      {locating ? (
                        <span className="party-info-pin-spinner" aria-label="Detecting location" />
                      ) : (
                        <RefreshCw strokeWidth={2} />
                      )}
                    </button>
                    {hasLocation && (
                      <button
                        type="button"
                        className="party-info-row-action-btn party-info-row-action-btn--muted"
                        onClick={handleClearLocation}
                        disabled={locating || disabled}
                        title="Clear location"
                        aria-label="Clear location"
                      >
                        <X strokeWidth={2} />
                      </button>
                    )}
                  </>
                }
              >
                <span className="sr-only">GPS coordinates</span>
                {hasLocation ? (
                  <p className="party-info-row-value party-info-row-value--mono" aria-live="polite">
                    {gpsDisplay}
                  </p>
                ) : (
                  <p className="party-info-row-placeholder">Tap refresh to capture GPS</p>
                )}
              </PartyInfoRow>
              {locationError && (
                <p className="party-info-rows-error" role="alert">
                  {locationError}
                </p>
              )}
            </>
          ))}
      </div>

      {!identityInHero && footer}
      {lookupMenu}
    </section>
  );
};
