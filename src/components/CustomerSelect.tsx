import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, UserRound } from 'lucide-react';
import { StorageImage } from './StorageImage';
import type { Customer } from '../types';

export type CustomerSelectValue = {
  customerId: string;
  customerName: string;
};

type CustomerSelectProps = {
  customers: Customer[];
  value: CustomerSelectValue;
  onChange: (value: CustomerSelectValue) => void;
  disabled?: boolean;
  inputId?: string;
  required?: boolean;
  placeholder?: string;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

function formatCustomerLabel(customer: Customer): string {
  const parts = [customer.name];
  if (customer.phone) parts.push(customer.phone);
  return parts.join(' · ');
}

const CustomerThumb: React.FC<{ customer: Customer | null; className?: string }> = ({
  customer,
  className = 'product-picker-selected-thumb',
}) => {
  const photoUrl = customer?.shopPhotoUrl || customer?.customerPhotoUrl;
  const photoPath = customer?.shopPhotoPath || customer?.customerPhotoPath;
  if (photoUrl || photoPath) {
    return (
      <StorageImage url={photoUrl} path={photoPath} alt="" className={className} />
    );
  }
  return (
    <span className={`${className} product-picker-selected-thumb--placeholder`}>
      <UserRound size={16} />
    </span>
  );
};

export const CustomerSelect: React.FC<CustomerSelectProps> = ({
  customers,
  value,
  onChange,
  disabled = false,
  inputId,
  required = false,
  placeholder = 'Select customer…',
}) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<MenuPosition | null>(null);

  const selected = useMemo(
    () => customers.find(c => c.id === value.customerId) ?? null,
    [customers, value.customerId],
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
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.product-picker-list--portal')) return;
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
  }, [open, updateMenuPosition, customers.length]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = customers.findIndex(c => c.id === value.customerId);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, customers, value.customerId]);

  const pickCustomer = (customer: Customer) => {
    onChange({ customerId: customer.id, customerName: customer.name });
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, Math.max(customers.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const pick = customers[activeIndex];
      if (pick) pickCustomer(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const menuPortal =
    open && menuStyle
      ? createPortal(
          customers.length > 0 ? (
            <ul
              id={listId}
              className="product-picker-list product-picker-list--portal"
              style={{
                top: menuStyle.top,
                left: menuStyle.left,
                width: menuStyle.width,
              }}
              role="listbox"
            >
              {customers.map((customer, index) => (
                <li key={customer.id} role="presentation">
                  <button
                    type="button"
                    className={`product-picker-option${index === activeIndex ? ' product-picker-option--active' : ''}`}
                    role="option"
                    aria-selected={customer.id === value.customerId}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => pickCustomer(customer)}
                  >
                    <CustomerThumb customer={customer} className="product-picker-option-thumb" />
                    <span className="product-picker-option-text">
                      <span className="product-picker-option-name">{customer.name}</span>
                      <span className="product-picker-option-meta text-muted text-sm">
                        {customer.phone || '—'}
                        {customer.address ? ` · ${customer.address}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="product-picker-empty product-picker-list--portal text-muted text-sm"
              style={{
                top: menuStyle.top,
                left: menuStyle.left,
                width: menuStyle.width,
              }}
            >
              No customers registered yet.
            </div>
          ),
          document.body,
        )
      : null;

  return (
    <div className="product-picker customer-select" ref={rootRef}>
      <button
        id={inputId}
        type="button"
        className={`product-picker-control product-select-trigger${open ? ' product-picker-control--open' : ''}`}
        onClick={() => !disabled && customers.length > 0 && setOpen(prev => !prev)}
        onKeyDown={handleKeyDown}
        disabled={disabled || customers.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={required || undefined}
      >
        <CustomerThumb customer={selected} />
        <span
          className={`product-select-label${selected ? '' : ' product-select-label--placeholder'}`}
        >
          {selected ? formatCustomerLabel(selected) : placeholder}
        </span>
        <ChevronDown size={16} className="product-picker-chevron" aria-hidden />
      </button>

      {menuPortal}

      {customers.length === 0 && (
        <p className="product-picker-hint text-muted text-sm m-0 mt-1">
          Add customers first, then return here to create a site calibration record.
        </p>
      )}
    </div>
  );
};
