import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { StorageImage } from './StorageImage';
import type { Product } from '../types';
import { formatShopCapacityLines } from '../lib/productSpecifications';

type ProductShopMediaProps = {
  product: Product;
  inactive?: boolean;
};

export const ProductShopMedia: React.FC<ProductShopMediaProps> = ({
  product,
  inactive = false,
}) => {
  const lines = formatShopCapacityLines(product);
  const hasImage = Boolean(product.productImageUrl || product.productImagePath);

  return (
    <span className="product-shop-card-media">
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
