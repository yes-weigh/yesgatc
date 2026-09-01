import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { StorageImage } from './StorageImage';
import type { Product } from '../types';
import { formatShopCapacityLines } from '../lib/productSpecifications';

export type ProductShopMediaMeta = 'capacity' | 'identity';

type ProductShopMediaProps = {
  product: Product;
  inactive?: boolean;
  /** capacity = Max/e lines; identity = model approval / model no / brand (no specs). */
  meta?: ProductShopMediaMeta;
};

function identityLines(product: Product): string[] {
  const lines: string[] = [];
  const approval = product.modelApprovalNo?.trim();
  const modelNo = product.modelNo?.trim();
  const modelId = product.modelid?.trim();
  const brand = product.manufacturerBrandSeries?.trim();
  const accuracy = product.accuracyClass?.trim();
  if (approval) lines.push(approval);
  if (modelNo) lines.push(modelNo);
  else if (modelId) lines.push(modelId);
  if (brand) lines.push(brand);
  if (accuracy) lines.push(accuracy);
  return lines;
}

export const ProductShopMedia: React.FC<ProductShopMediaProps> = ({
  product,
  inactive = false,
  meta = 'capacity',
}) => {
  const lines =
    meta === 'identity' ? identityLines(product) : formatShopCapacityLines(product);
  const hasImage = Boolean(product.productImageUrl || product.productImagePath);

  return (
    <span
      className={`product-shop-card-media${meta === 'identity' ? ' product-shop-card-media--identity' : ''}`}
    >
      {lines.length > 0 ? (
        <span className="product-shop-card-cap-lines">
          {lines.map((line, index) => (
            <span key={`${line}-${index}`} className="product-shop-card-cap-line">
              {line}
            </span>
          ))}
        </span>
      ) : null}
      <span className="product-shop-card-img-wrap">
        {hasImage ? (
          <StorageImage
            url={product.productImageUrl}
            path={product.productImagePath}
            alt=""
            className="product-shop-card-img"
            persistentCache
          />
        ) : (
          <span className="product-shop-card-img product-picker-selected-thumb--placeholder">
            <ImageIcon size={28} />
          </span>
        )}
        {inactive ? <span className="product-shop-inactive-badge">Inactive</span> : null}
      </span>
    </span>
  );
};
