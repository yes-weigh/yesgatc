import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Image as ImageIcon,
  Package,
  Pencil,
  Scale,
  Ruler,
  ShieldCheck,
} from 'lucide-react';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ListViewBackBar } from '../../components/ListViewBackBar';
import { ProductDetailsSpecs } from '../../components/ProductDetailsSpecs';
import {
  RcListCardToggle,
  RcListEditHint,
  RcListMetaChip,
  RcListPhoto,
  RcListStatusBadge,
} from '../../components/RcListCard';
import { useAppContext } from '../../context/AppContext';
import type { Product } from '../../types';

function formatProductCapacity(product: Product): string {
  return product.maximumCapacity
    ? `${product.maximumCapacity} ${product.unitOfMeasurement || 'kg'}`
    : '—';
}

function formatProductInterval(product: Product): string {
  if (product.actualScaleInterval != null && Number.isFinite(product.actualScaleInterval)) {
    return `${product.actualScaleInterval} g`;
  }
  if (product.verificationScaleInterval) {
    return `${product.verificationScaleInterval} g`;
  }
  return '—';
}

export const RCProducts: React.FC = () => {
  const { products, loadingData } = useAppContext();
  const [viewingProductId, setViewingProductId] = useState<string | null>(null);

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
        <div className="rc-list-page">
          <section className="rc-vehicles-summary-card">
            <div className="rc-vehicles-summary-leading">
              <span className="rc-list-summary-icon" aria-hidden>
                <Package size={20} strokeWidth={1.85} />
              </span>
              <h2 className="rc-vehicles-summary-title">Products</h2>
              <p className="rc-vehicles-summary-sub">
                {products.length} product{products.length !== 1 ? 's' : ''} in catalogue
              </p>
            </div>
          </section>

          {loadingData ? (
            <div className="rc-vehicles-loading">
              <span className="spinner-inline large" />
            </div>
          ) : products.length === 0 ? (
            <div className="rc-vehicles-empty">
              <span className="rc-list-summary-icon rc-list-summary-icon--lg" aria-hidden>
                <Package size={24} strokeWidth={1.85} />
              </span>
              <p>No admin products available yet.</p>
            </div>
          ) : (
            <div className="rc-list-cards">
              {products.map(p => {
                const capacity = formatProductCapacity(p);
                const interval = formatProductInterval(p);
                const modelLine = [p.modelid, p.modelNo].filter(Boolean).join(' · ') || '—';
                const displayName = (p.name || '—').trim().toUpperCase();
                const hasApproval = Boolean(p.modelApprovalNo || p.modelApprovalDocUrl);

                return (
                  <article key={p.id} className="rc-list-card rc-list-card--product">
                    <div className="rc-list-card-top">
                      <button
                        type="button"
                        className="rc-list-card-main"
                        onClick={() => handleViewProduct(p)}
                        aria-label={`View ${displayName}`}
                      >
                        <RcListPhoto
                          url={p.productImageUrl}
                          path={p.productImagePath}
                          placeholder={<ImageIcon size={28} strokeWidth={1.5} />}
                        />
                        <span className="rc-list-card-info">
                          <span className="rc-list-card-name-row">
                            <span className="rc-list-card-name">{displayName}</span>
                            <RcListEditHint />
                          </span>
                          <span className="rc-list-meta-chips">
                            <RcListMetaChip icon={<Package size={13} strokeWidth={2} />}>
                              {modelLine}
                            </RcListMetaChip>
                            <RcListMetaChip icon={<Scale size={13} strokeWidth={2} />}>
                              {capacity}
                            </RcListMetaChip>
                            <RcListMetaChip icon={<Ruler size={13} strokeWidth={2} />}>
                              d {interval}
                            </RcListMetaChip>
                          </span>
                          <span className="rc-list-card-badges">
                            {hasApproval ? (
                              <RcListStatusBadge
                                tone="approved"
                                label={p.modelApprovalNo || 'Model approval'}
                                icon={<ShieldCheck size={12} strokeWidth={2.5} aria-hidden />}
                              />
                            ) : (
                              <RcListStatusBadge
                                tone="pending"
                                label="Approval pending"
                                icon={<ShieldCheck size={12} strokeWidth={2.5} aria-hidden />}
                              />
                            )}
                            {p.modelApprovalDocUrl && (
                              <RcListStatusBadge
                                tone="info"
                                label="Approval doc"
                                icon={<ExternalLink size={12} strokeWidth={2.5} aria-hidden />}
                              />
                            )}
                          </span>
                        </span>
                      </button>
                      <RcListCardToggle
                        className="rc-list-card-toggle--view"
                        onClick={() => handleViewProduct(p)}
                        title="View product details"
                        ariaLabel={`View ${displayName}`}
                      >
                        <Pencil size={18} strokeWidth={1.75} />
                      </RcListCardToggle>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
