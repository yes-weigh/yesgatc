import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Image as ImageIcon } from 'lucide-react';
import { StorageImage } from './StorageImage';
import type { Product } from '../types';

export type ProductPickerValue = {
  productId: string;
  productName: string;
};

type ProductPickerProps = {
  products: Product[];
  value: ProductPickerValue;
  onChange: (value: ProductPickerValue) => void;
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

function filterProducts(products: Product[], query: string): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return products.slice(0, 12);
  return products
    .filter(p => {
      const haystack = [p.name, p.modelid, p.modelNo, p.manufacturerBrandSeries]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, 12);
}

export const ProductPicker: React.FC<ProductPickerProps> = ({
  products,
  value,
  onChange,
  disabled = false,
  inputId,
  required = false,
  placeholder = 'Search product name or model…',
}) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<MenuPosition | null>(null);

  const selected = useMemo(
    () => products.find(p => p.id === value.productId) ?? null,
    [products, value.productId],
  );

  const suggestions = useMemo(() => filterProducts(products, query), [products, query]);

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
  }, [open, updateMenuPosition, suggestions.length]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const displayValue = open ? query : (selected?.name || value.productName || '');

  const pickProduct = (product: Product) => {
    onChange({ productId: product.id, productName: product.name });
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setQuery(next);
    setOpen(true);
    if (!next.trim()) {
      onChange({ productId: '', productName: '' });
    }
  };

  const handleFocus = () => {
    setQuery(selected?.name || value.productName || '');
    setOpen(true);
  };

  const handleBlur = () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (rootRef.current?.contains(active)) return;
      if ((active as Element | null)?.closest?.('.product-picker-list--portal')) return;
      setOpen(false);
      setQuery('');
    }, 120);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, Math.max(suggestions.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = suggestions[activeIndex];
      if (pick) pickProduct(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  const menuPortal =
    open && menuStyle
      ? createPortal(
          suggestions.length > 0 ? (
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
              {suggestions.map((product, index) => (
                <li key={product.id} role="presentation">
                  <button
                    type="button"
                    className={`product-picker-option${index === activeIndex ? ' product-picker-option--active' : ''}`}
                    role="option"
                    aria-selected={product.id === value.productId}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => pickProduct(product)}
                  >
                    {product.productImageUrl || product.productImagePath ? (
                      <StorageImage
                        url={product.productImageUrl}
                        path={product.productImagePath}
                        alt=""
                        className="product-picker-option-thumb"
                      />
                    ) : (
                      <span className="product-picker-option-thumb product-picker-option-thumb--placeholder">
                        <ImageIcon size={16} />
                      </span>
                    )}
                    <span className="product-picker-option-text">
                      <span className="product-picker-option-name">{product.name}</span>
                      <span className="product-picker-option-meta text-muted text-sm">
                        {product.modelid}
                        {product.modelNo ? ` · ${product.modelNo}` : ''}
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
              No matching products.
            </div>
          ),
          document.body,
        )
      : null;

  return (
    <div className="product-picker" ref={rootRef}>
      <div className={`product-picker-control${open ? ' product-picker-control--open' : ''}`}>
        {selected?.productImageUrl || selected?.productImagePath ? (
          <StorageImage
            url={selected?.productImageUrl}
            path={selected?.productImagePath}
            alt=""
            className="product-picker-selected-thumb"
          />
        ) : (
          <span className="product-picker-selected-thumb product-picker-selected-thumb--placeholder">
            <ImageIcon size={16} />
          </span>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className="input-field product-picker-input"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || products.length === 0}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
        />
        <ChevronDown size={16} className="product-picker-chevron" aria-hidden />
      </div>

      {menuPortal}

      {products.length === 0 && (
        <p className="product-picker-hint text-muted text-sm m-0 mt-1">
          No products in catalogue yet.
        </p>
      )}
    </div>
  );
};
