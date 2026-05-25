import React, { useEffect, useId, useState } from 'react';
import { ChevronDown, ExternalLink, Package } from 'lucide-react';
import {
  formatProductMaximumCapacity,
  formatProductMinimumCapacity,
  formatProductMpe,
  formatProductScaleInterval,
  formatProductText,
  formatProductVerificationInterval,
  formatProductVerificationIntervals,
} from '../lib/productCalculations';
import type { Product } from '../types';

const SpecItem: React.FC<{
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}> = ({ label, value, mono }) => (
  <div className="customer-device-spec-item">
    <span className="customer-device-spec-label">{label}</span>
    <span className={mono ? 'text-mono' : undefined}>{value}</span>
  </div>
);

const ProductSpecsContent: React.FC<{ product: Product }> = ({ product }) => (
  <div className="customer-device-product-specs" aria-label="Product details">
    <div className="customer-device-thumb">
      <div
        className={`customer-device-thumb-box${product.productImageUrl ? '' : ' customer-device-thumb-box--placeholder'}`}
        title={product.name || 'Product photo'}
      >
        {product.productImageUrl ? (
          <img src={product.productImageUrl} alt="" className="customer-device-thumb-img" />
        ) : (
          <Package size={22} className="text-muted" aria-hidden />
        )}
      </div>
    </div>
    <div className="customer-device-product-specs-grid">
      <SpecItem label="Model ID" value={formatProductText(product.modelid)} mono />
      <SpecItem label="Model no." value={formatProductText(product.modelNo)} mono />
      <SpecItem label="Product name" value={formatProductText(product.name)} />
      <SpecItem label="Unit" value={formatProductText(product.unitOfMeasurement)} />
      <SpecItem label="Type" value={formatProductText(product.typeOfInstrument)} />
      <SpecItem label="Manufacturer" value={formatProductText(product.manufacturerBrandSeries)} />
      <SpecItem label="Accuracy class" value={formatProductText(product.accuracyClass)} />
      <SpecItem label="Supply voltage" value={formatProductText(product.supplyVoltage)} />
      <SpecItem label="Maximum capacity" value={formatProductMaximumCapacity(product)} />
      <SpecItem label="Interval e" value={formatProductVerificationInterval(product)} />
      <SpecItem label="Minimum capacity (Min)" value={formatProductMinimumCapacity(product)} />
      <SpecItem label="Scale interval (d)" value={formatProductScaleInterval(product)} />
      <SpecItem label="Verification intervals (n)" value={formatProductVerificationIntervals(product)} />
      <SpecItem label="MPE" value={formatProductMpe(product.maximumPermissibleError)} />
      <SpecItem
        label="Model approval no."
        value={formatProductText(product.modelApprovalNo)}
        mono
      />
      <SpecItem
        label="Model approval doc"
        value={
          product.modelApprovalDocUrl ? (
            <a
              href={product.modelApprovalDocUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue flex items-center gap-1"
            >
              <ExternalLink size={14} aria-hidden />
              View document
            </a>
          ) : (
            '—'
          )
        }
      />
    </div>
  </div>
);

export const ProductDetailsSpecs: React.FC<{
  product: Product;
  className?: string;
  collapsible?: boolean;
  panelId?: string;
}> = ({ product, className, collapsible = false, panelId }) => {
  const generatedId = useId();
  const detailsId = panelId || generatedId;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [product.id]);

  if (!collapsible) {
    return (
      <div className={className}>
        <ProductSpecsContent product={product} />
      </div>
    );
  }

  const summary = [formatProductText(product.name), formatProductMaximumCapacity(product)]
    .filter(v => v !== '—')
    .join(' · ');

  return (
    <div className={`customer-device-details${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="customer-device-details-toggle"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        aria-controls={detailsId}
      >
        <span className="customer-device-details-toggle-label">
          <span>Product details</span>
          {summary && (
            <span className="customer-device-details-toggle-summary text-muted">{summary}</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`customer-device-details-chevron${open ? ' customer-device-details-chevron--open' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div id={detailsId} className="customer-device-details-panel">
          <ProductSpecsContent product={product} />
        </div>
      )}
    </div>
  );
};
