import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Image as ImageIcon, X } from 'lucide-react';
import { StorageImage } from './StorageImage';
import { PasTag, ProductShopCardBody, ProductShopMedia } from './ProductShopMedia';
import type { Product } from '../types';
import { formatProductCapacitySpecs } from '../lib/productCalculations';
import {
  formatShopCapacityLine,
  formatSpecificationCapacitySpecs,
  getProductSpecifications,
  isProductActive,
  productHasMultipleSpecifications,
} from '../lib/productSpecifications';
import { speakCapacityChoice } from '../lib/speakText';

export type ProductSelectValue = {
  productId: string;
  productName: string;
  productSpecificationId?: string;
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
      persistentCache
    />
  ) : (
    <span className={`${className} product-picker-selected-thumb--placeholder`}>
      <ImageIcon size={className.includes('product-shop') ? 28 : 16} />
    </span>
  );

function ProductSpecPickerModal({
  product,
  onPick,
  onClose,
}: {
  product: Product;
  onPick: (specificationId: string) => void;
  onClose: () => void;
}) {
  const specs = getProductSpecifications(product);
  const unit = product.unitOfMeasurement || 'kg';
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="product-spec-picker-backdrop"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="product-spec-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-spec-picker-title"
      >
        <header className="product-spec-picker-head">
          <div className="product-spec-picker-head-text">
            <h2
              id="product-spec-picker-title"
              className="product-spec-picker-title"
              ref={titleRef}
              tabIndex={-1}
            >
              Select specification
            </h2>
            <p className="product-spec-picker-sub mb-0">{product.name}</p>
          </div>
          <button
            type="button"
            className="product-spec-picker-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <ul className="product-spec-picker-list" role="listbox" aria-label="Specifications">
          {specs.map(spec => {
            const label = formatSpecificationCapacitySpecs(spec, unit);
            const selected = selectedId === spec.id;
            return (
              <li key={spec.id}>
                <button
                  type="button"
                  className={`product-spec-picker-option${selected ? ' product-spec-picker-option--selected' : ''}`}
                  role="option"
                  aria-selected={selected}
                  onPointerDown={() => {
                    speakCapacityChoice(formatShopCapacityLine(spec, unit));
                  }}
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedId(spec.id);
                  }}
                >
                  <span className="product-spec-picker-badge">
                    {Number.isFinite(spec.maximumCapacity) ? spec.maximumCapacity : '—'}
                  </span>
                  <span className="product-spec-picker-option-text">
                    <span className="product-spec-picker-option-name">{label || 'Specification'}</span>
                    {Number.isFinite(spec.maximumPermissibleError) ? (
                      <span className="product-spec-picker-option-meta">
                        MPE {spec.maximumPermissibleError}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="product-spec-picker-hint mb-0">
          Tap a capacity (turns green). Change anytime, then Confirm.
        </p>
        <div className="product-spec-picker-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selectedId}
            onClick={() => {
              if (!selectedId) return;
              onPick(selectedId);
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function useProductPick(
  products: Product[],
  onChange: (value: ProductSelectValue) => void,
  options?: { deferMultiSpec?: boolean },
) {
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const pendingRef = useRef<Product | null>(null);
  pendingRef.current = pendingProduct;
  const deferMultiSpec = Boolean(options?.deferMultiSpec);

  const pickProduct = useCallback(
    (product: Product) => {
      if (productHasMultipleSpecifications(product)) {
        if (deferMultiSpec) {
          // Parent lists specs inline — do not auto-pick a capacity.
          onChange({
            productId: product.id,
            productName: product.name,
            productSpecificationId: '',
          });
          return;
        }
        setPendingProduct(product);
        return;
      }
      const specs = getProductSpecifications(product);
      onChange({
        productId: product.id,
        productName: product.name,
        productSpecificationId: specs[0]?.id || '',
      });
    },
    [onChange, deferMultiSpec],
  );

  const confirmSpec = useCallback(
    (specificationId: string) => {
      const product = pendingRef.current;
      if (!product) return;
      onChange({
        productId: product.id,
        productName: product.name,
        productSpecificationId: specificationId,
      });
      setPendingProduct(null);
    },
    [onChange],
  );

  const cancelSpec = useCallback(() => {
    pendingRef.current = null;
    setPendingProduct(null);
  }, []);

  const activeProducts = useMemo(
    () => products.filter(isProductActive),
    [products],
  );

  const specModal = pendingProduct ? (
    <ProductSpecPickerModal
      product={pendingProduct}
      onPick={confirmSpec}
      onClose={cancelSpec}
    />
  ) : null;

  return { activeProducts, pickProduct, specModal };
}

export const ProductCatalogueList: React.FC<{
  products: Product[];
  value: ProductSelectValue;
  onChange: (value: ProductSelectValue) => void;
  disabled?: boolean;
  showCapacitySpecs?: boolean;
  variant?: 'list' | 'shop';
  /** Multi-spec: emit product only; parent shows capacity list (no modal / no auto-select). */
  deferMultiSpec?: boolean;
  /** Shop cards: media strip. Off = name-only tiles. */
  showShopMedia?: boolean;
}> = ({
  products,
  value,
  onChange,
  disabled = false,
  showCapacitySpecs = true,
  variant = 'list',
  deferMultiSpec = false,
  showShopMedia = true,
}) => {
  const { activeProducts, pickProduct, specModal } = useProductPick(products, onChange, {
    deferMultiSpec,
  });

  if (activeProducts.length === 0) {
    return (
      <p className="product-catalogue-empty text-muted text-sm mb-0">
        No products in catalogue yet.
      </p>
    );
  }

  const shop = variant === 'shop';

  return (
    <>
      <ul
        className={`product-catalogue-list${shop ? ' product-catalogue-list--shop' : ''}${shop && !showShopMedia ? ' product-catalogue-list--shop-names' : ''}`}
        role="listbox"
      >
        {activeProducts.map(product => {
          const selected = product.id === value.productId;
          const specs = showCapacitySpecs
            ? formatProductCapacitySpecs(product)
            : [product.modelid, product.modelNo].filter(Boolean).join(' · ');
          return (
            <li key={product.id}>
              <button
                type="button"
                className={
                  shop
                    ? `product-shop-card${selected ? ' product-shop-card--selected' : ''}${!showShopMedia ? ' product-shop-card--name-only' : ''}`
                    : `product-picker-option product-catalogue-option${selected ? ' product-picker-option--active product-catalogue-option--selected' : ''}`
                }
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => pickProduct(product)}
              >
                {shop ? (
                  <>
                    {showShopMedia ? (
                      <ProductShopMedia product={product} />
                    ) : null}
                    <ProductShopCardBody product={product} />
                  </>
                ) : (
                  <>
                    <ProductThumb product={product} className="product-picker-option-thumb" />
                    <span className="product-picker-option-text">
                      <span className="product-picker-option-name">
                        <span className="product-picker-option-name-text">{product.name}</span>
                        {product.pasPreAllotted ? <PasTag inline /> : null}
                      </span>
                      {showCapacitySpecs ? (
                        <span className="product-picker-option-specs text-muted text-sm">{specs}</span>
                      ) : (
                        <span className="product-picker-option-meta text-muted text-sm">{specs}</span>
                      )}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {specModal}
    </>
  );
};

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
  const { activeProducts, pickProduct, specModal } = useProductPick(
    products,
    next => {
      onChange(next);
      setOpen(false);
    },
  );

  const selected = useMemo(
    () => activeProducts.find(p => p.id === value.productId) ?? null,
    [activeProducts, value.productId],
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
      if ((target as Element).closest?.('.product-spec-picker-backdrop')) return;
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
  }, [open, updateMenuPosition, activeProducts.length]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = activeProducts.findIndex(p => p.id === value.productId);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, activeProducts, value.productId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, Math.max(activeProducts.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const pick = activeProducts[activeIndex];
      if (pick) pickProduct(pick);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const menuPortal =
    open && menuStyle
      ? createPortal(
          activeProducts.length > 0 ? (
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
              {activeProducts.map((product, index) => (
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
                      <span className="product-picker-option-name">
                        <span className="product-picker-option-name-text">{product.name}</span>
                        {product.pasPreAllotted ? <PasTag inline /> : null}
                      </span>
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
        onClick={() => !disabled && activeProducts.length > 0 && setOpen(prev => !prev)}
        onKeyDown={handleKeyDown}
        disabled={disabled || activeProducts.length === 0}
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
      {specModal}

      {activeProducts.length === 0 && (
        <p className="product-picker-hint text-muted text-sm m-0 mt-1">
          No products in catalogue yet.
        </p>
      )}
    </div>
  );
};
