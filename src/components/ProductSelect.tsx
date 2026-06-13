import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Image as ImageIcon } from 'lucide-react';
import { StorageImage } from './StorageImage';
import type { Product } from '../types';
import { formatProductCapacitySpecs } from '../lib/productCalculations';

export type ProductSelectValue = {
  productId: string;
  productName: string;
};

type ProductSelectProps = {
  products: Product[];
  value: ProductSelectValue;
  onChange: (value: ProductSelectValue) => void;
  disabled?: boolean;
  inputId?: string;
  required?: boolean;
  placeholder?: string;
  /** Show max capacity, e, and minimum in list + selected label. */
  showCapacitySpecs?: boolean;
};

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

function formatProductLabel(product: Product, showCapacitySpecs = false): string {
  const parts = [product.name];
  if (!showCapacitySpecs) {
    if (product.modelNo) parts.push(product.modelNo);
    if (product.modelid) parts.push(`(${product.modelid})`);
  } else {
    const specs = formatProductCapacitySpecs(product);
    if (specs) parts.push(specs);
  }
  return parts.join(' · ');
}

const ProductThumb: React.FC<{ product: Product | null; className?: string }> = ({
  product,
  className = 'product-picker-selected-thumb',
}) =>
  product?.productImageUrl || product?.productImagePath ? (
    <StorageImage
      url={product?.productImageUrl}
      path={product?.productImagePath}
      alt=""
      className={className}
    />
  ) : (
    <span className={`${className} product-picker-selected-thumb--placeholder`}>
      <ImageIcon size={16} />
    </span>
  );

export const ProductSelect: React.FC<ProductSelectProps> = ({
  products,
  value,
  onChange,
  disabled = false,
  inputId,
  required = false,
  placeholder = 'Select product…',
  showCapacitySpecs = false,
}) => {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<MenuPosition | null>(null);

  const selected = useMemo(
    () => products.find(p => p.id === value.productId) ?? null,
    [products, value.productId],
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
  }, [open, updateMenuPosition, products.length]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = products.findIndex(p => p.id === value.productId);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, products, value.productId]);

  const pickProduct = (product: Product) => {
    onChange({ productId: product.id, productName: product.name });
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
      setActiveIndex(i => Math.min(i + 1, Math.max(products.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const pick = products[activeIndex];
      if (pick) pickProduct(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const menuPortal =
    open && menuStyle
      ? createPortal(
          products.length > 0 ? (
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
              {products.map((product, index) => (
                <li key={product.id} role="presentation">
                  <button
                    type="button"
                    className={`product-picker-option${index === activeIndex ? ' product-picker-option--active' : ''}`}
                    role="option"
                    aria-selected={product.id === value.productId}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => pickProduct(product)}
                  >
                    <ProductThumb product={product} className="product-picker-option-thumb" />
                    <span className="product-picker-option-text">
                      <span className="product-picker-option-name">{product.name}</span>
                      {!showCapacitySpecs && (
                        <span className="product-picker-option-meta text-muted text-sm">
                          {product.modelid}
                          {product.modelNo ? ` · ${product.modelNo}` : ''}
                        </span>
                      )}
                      {showCapacitySpecs && (
                        <span className="product-picker-option-specs text-muted text-sm">
                          {formatProductCapacitySpecs(product)}
                        </span>
                      )}
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
              No products in catalogue yet.
            </div>
          ),
          document.body,
        )
      : null;

  return (
    <div className="product-picker product-select" ref={rootRef}>
      <button
        id={inputId}
        type="button"
        className={`product-picker-control product-select-trigger${open ? ' product-picker-control--open' : ''}`}
        onClick={() => !disabled && products.length > 0 && setOpen(prev => !prev)}
        onKeyDown={handleKeyDown}
        disabled={disabled || products.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={required || undefined}
      >
        <ProductThumb product={selected} />
        <span
          className={`product-select-label${selected ? '' : ' product-select-label--placeholder'}`}
          title={selected ? formatProductLabel(selected, showCapacitySpecs) : undefined}
        >
          {selected ? formatProductLabel(selected, showCapacitySpecs) : placeholder}
        </span>
        <ChevronDown size={16} className="product-picker-chevron" aria-hidden />
      </button>

      {menuPortal}

      {products.length === 0 && (
        <p className="product-picker-hint text-muted text-sm m-0 mt-1">
          No products in catalogue yet.
        </p>
      )}
    </div>
  );
};
