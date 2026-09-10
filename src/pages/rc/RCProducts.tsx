import React, { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { ProductShopCardBody, ProductShopMedia } from '../../components/ProductShopMedia';
import { ProductViewPanel } from '../../components/ProductViewPanel';
import { useAppContext } from '../../context/AppContext';
import { isProductActive } from '../../lib/productSpecifications';
import type { Product } from '../../types';

export const RCProducts: React.FC = () => {
  const { products, loadingData } = useAppContext();
  const [viewingProductId, setViewingProductId] = useState<string | null>(null);

  const catalogueProducts = useMemo(
    () => products.filter(isProductActive),
    [products],
  );

  const viewingProduct = useMemo(
    () => products.find(p => p.id === viewingProductId) ?? null,
    [products, viewingProductId],
  );

  const handleCloseView = () => setViewingProductId(null);

  const handleViewProduct = (product: Product) => setViewingProductId(product.id);

  useEffect(() => {
    if (!viewingProductId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewingProductId]);

  if (viewingProduct) {
    return (
      <div className="fade-in product-edit-page">
        <ProductViewPanel product={viewingProduct} onClose={handleCloseView} />
      </div>
    );
  }

  return (
    <div className="fade-in page-content">
      <div className="rc-list-page rc-list-page--product-shop">
        {loadingData ? (
          <div className="rc-vehicles-loading">
            <span className="spinner-inline large" />
          </div>
        ) : catalogueProducts.length === 0 ? (
          <div className="rc-vehicles-empty">
            <span className="rc-list-summary-icon rc-list-summary-icon--lg" aria-hidden>
              <Package size={24} strokeWidth={1.85} />
            </span>
            <p>No admin products available yet.</p>
          </div>
        ) : (
          <ul className="product-catalogue-list product-catalogue-list--shop rc-product-shop-grid">
            {catalogueProducts.map(p => {
              const displayName = (p.name || '—').trim();
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="product-shop-card"
                    onClick={() => handleViewProduct(p)}
                    aria-label={`View ${displayName}`}
                  >
                    <ProductShopMedia product={p} />
                    <ProductShopCardBody product={p} name={displayName} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
