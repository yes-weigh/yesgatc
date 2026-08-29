import React, { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { ProductDetailsSpecs } from '../../components/ProductDetailsSpecs';
import { ProductShopMedia } from '../../components/ProductShopMedia';
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

  return (
    <div className="fade-in page-content">
      {viewingProduct && (
        <InlineFormPanel
          id="rc-product-detail"
          className="mb-6 inline-form-panel--wide inline-form-panel--rc-product"
        >
          <div className="product-form-panel">
            <ListViewBackBar onBack={handleCloseView} />
            <div className="product-form-topbar">
              <div className="product-form-topbar-text">
                <h2 id="rc-product-detail-title">
                  <Package className="inline-icon" /> {viewingProduct.name || 'Product'}
                </h2>
                <p className="text-muted text-sm mt-1 mb-0">
                  {viewingProduct.modelid || '—'}
                  {viewingProduct.modelNo ? ` · ${viewingProduct.modelNo}` : ''}
                </p>
              </div>
            </div>
            <div className="product-form-body rc-product-detail-body">
              <ProductDetailsSpecs product={viewingProduct} className="rc-product-detail-specs" />
            </div>
          </div>
        </InlineFormPanel>
      )}

      {!viewingProductId && (
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
                      <span className="product-shop-card-body">
                        <span className="product-shop-card-name">{displayName}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
