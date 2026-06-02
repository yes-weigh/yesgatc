import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Award,
  BadgeCheck,
  ExternalLink,
  Factory,
  FileText,
  Gauge,
  Hash,
  Package,
  Repeat,
  Scale,
  Target,
  Zap,
} from 'lucide-react';
import { StorageImage } from './StorageImage';
import {
  DetailsCompactField,
  DetailsCompactThumb,
  DetailsSpecsCompactShell,
} from './DetailsSpecsCompact';
import { ProductSpecIconTile } from './ProductSpecIconTile';
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

const ProductDetailsFieldsGrid: React.FC<{ product: Product; dense?: boolean }> = ({
  product,
  dense = false,
}) => {
  if (dense) {
    return (
      <div className="details-specs-icon-grid">
        <ProductSpecIconTile
          label="Unit"
          value={formatProductText(product.unitOfMeasurement)}
          icon={Scale}
          tone="sky"
        />
        <ProductSpecIconTile
          label="Type"
          value={formatProductText(product.typeOfInstrument)}
          icon={Gauge}
          tone="violet"
        />
        <ProductSpecIconTile
          label="Mfr"
          value={formatProductText(product.manufacturerBrandSeries)}
          icon={Factory}
          tone="amber"
        />
        <ProductSpecIconTile
          label="Class"
          value={formatProductText(product.accuracyClass)}
          icon={Award}
          tone="emerald"
        />
        <ProductSpecIconTile
          label="Voltage"
          value={formatProductText(product.supplyVoltage)}
          icon={Zap}
          tone="yellow"
        />
        <ProductSpecIconTile
          label="Max cap"
          value={formatProductMaximumCapacity(product)}
          icon={ArrowUp}
          tone="cyan"
        />
        <ProductSpecIconTile
          label="e"
          value={formatProductVerificationInterval(product)}
          icon={Hash}
          tone="indigo"
        />
        <ProductSpecIconTile
          label="Min"
          value={formatProductMinimumCapacity(product)}
          icon={ArrowDown}
          tone="teal"
        />
        <ProductSpecIconTile
          label="d"
          value={formatProductScaleInterval(product)}
          icon={Hash}
          tone="pink"
        />
        <ProductSpecIconTile
          label="n"
          value={formatProductVerificationIntervals(product)}
          icon={Repeat}
          tone="blue"
        />
        <ProductSpecIconTile
          label="MPE"
          value={formatProductMpe(product.maximumPermissibleError)}
          icon={Target}
          tone="orange"
        />
        <ProductSpecIconTile
          label="Approval #"
          value={formatProductText(product.modelApprovalNo)}
          icon={BadgeCheck}
          tone="lime"
          mono
        />
        <ProductSpecIconTile
          label="Approval doc"
          spanFull
          icon={FileText}
          tone="rose"
          value={
            product.modelApprovalDocUrl ? (
              <a
                href={product.modelApprovalDocUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="details-specs-doc-link"
              >
                <ExternalLink size={12} aria-hidden />
                View
              </a>
            ) : (
              '—'
            )
          }
        />
      </div>
    );
  }

  return (
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
};

export const ProductDetailsSpecs: React.FC<{
  product: Product;
  className?: string;
  /** Under a product picker — fields only, no duplicate thumb/title. */
  embedded?: boolean;
  /** Tight icon tile grid for wizard / mobile device cards. */
  dense?: boolean;
}> = ({ product, className, embedded = false, dense = false }) => {
  if (embedded || dense) {
    return (
      <div
        className={[
          'product-details-embedded',
          dense ? 'product-details--dense' : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {!dense && <p className="product-details-embedded-heading">Product specs</p>}
        <div
          className={[
            'details-specs--compact',
            'details-specs--compact-fields-only',
            dense ? 'details-specs--icon-grid-wrap' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <ProductDetailsFieldsGrid product={product} dense={dense} />
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
