import React from 'react';
import { ExternalLink, Package } from 'lucide-react';
import { StorageImage } from './StorageImage';
import {
  DetailsCompactField,
  DetailsCompactThumb,
  DetailsSpecsCompactShell,
} from './DetailsSpecsCompact';
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

const ProductDetailsFieldsGrid: React.FC<{ product: Product }> = ({ product }) => (
  <div className="details-specs-compact-fields">
    <DetailsCompactField label="Unit" value={formatProductText(product.unitOfMeasurement)} />
    <DetailsCompactField label="Type" value={formatProductText(product.typeOfInstrument)} />
    <DetailsCompactField
      label="Manufacturer"
      value={formatProductText(product.manufacturerBrandSeries)}
    />
    <DetailsCompactField label="Accuracy class" value={formatProductText(product.accuracyClass)} />
    <DetailsCompactField label="Supply voltage" value={formatProductText(product.supplyVoltage)} />
    <DetailsCompactField label="Maximum capacity" value={formatProductMaximumCapacity(product)} />
    <DetailsCompactField label="Interval e" value={formatProductVerificationInterval(product)} />
    <DetailsCompactField
      label="Minimum capacity (Min)"
      value={formatProductMinimumCapacity(product)}
    />
    <DetailsCompactField label="Scale interval (d)" value={formatProductScaleInterval(product)} />
    <DetailsCompactField
      label="Verification intervals (n)"
      value={formatProductVerificationIntervals(product)}
    />
    <DetailsCompactField label="MPE" value={formatProductMpe(product.maximumPermissibleError)} />
    <DetailsCompactField
      label="Model approval no."
      value={formatProductText(product.modelApprovalNo)}
      mono
    />
    <DetailsCompactField
      label="Model approval doc"
      spanFull
      value={
        product.modelApprovalDocUrl ? (
          <a
            href={product.modelApprovalDocUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="details-specs-doc-link text-sm text-blue"
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
);

export const ProductDetailsSpecs: React.FC<{
  product: Product;
  className?: string;
  /** Under a product picker — fields only, no duplicate thumb/title. */
  embedded?: boolean;
}> = ({ product, className, embedded = false }) => {
  if (embedded) {
    return (
      <div className={`product-details-embedded${className ? ` ${className}` : ''}`}>
        <p className="product-details-embedded-heading">Product specs</p>
        <div className="details-specs--compact details-specs--compact-fields-only">
          <ProductDetailsFieldsGrid product={product} />
        </div>
      </div>
    );
  }

  const modelLine = [formatProductText(product.modelid), formatProductText(product.modelNo)]
    .filter(v => v !== '—')
    .join(' · ');

  return (
    <DetailsSpecsCompactShell
      className={className}
      ariaLabel="Product details"
      thumb={
        <DetailsCompactThumb
          placeholder={!product.productImageUrl && !product.productImagePath}
          title={product.name || 'Product photo'}
        >
          {product.productImageUrl || product.productImagePath ? (
            <StorageImage
              url={product.productImageUrl}
              path={product.productImagePath}
              alt=""
            />
          ) : (
            <Package size={18} className="text-muted" aria-hidden />
          )}
        </DetailsCompactThumb>
      }
    >
      <div className="details-specs-compact-primary">
        <span className="details-specs-compact-title">{formatProductText(product.name)}</span>
        {modelLine && <span className="details-specs-compact-line text-mono">{modelLine}</span>}
      </div>
      <ProductDetailsFieldsGrid product={product} />
    </DetailsSpecsCompactShell>
  );
};
