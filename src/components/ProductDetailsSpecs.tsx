import React from 'react';
import { ExternalLink, Package } from 'lucide-react';
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
    <span className={`customer-device-spec-value${mono ? ' customer-device-spec-value--mono' : ''}`}>
      {value}
    </span>
  </div>
);

export const ProductDetailsSpecs: React.FC<{
  product: Product;
  className?: string;
}> = ({ product, className }) => (
  <div className={`customer-device-product-details${className ? ` ${className}` : ''}`}>
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
                className="customer-device-spec-doc-link text-sm text-blue"
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
  </div>
);
