import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Image as ImageIcon, Package, X } from 'lucide-react';
import { InlineFormPanel } from '../../components/InlineFormPanel';
import { ProductDetailsSpecs } from '../../components/ProductDetailsSpecs';
import { tableEditCellProps } from '../../lib/tableEditCell';
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
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3 flex items-center gap-1 shrink-0"
                onClick={handleCloseView}
                aria-label="Close product details"
              >
                <X size={15} /> Close
              </button>
            </div>
            <div className="product-form-body rc-product-detail-body">
              <ProductDetailsSpecs product={viewingProduct} className="rc-product-detail-specs" />
            </div>
          </div>
        </InlineFormPanel>
      )}

      {!viewingProductId && (
        <div className="panel glass panel--table mb-6">
          <div className="panel-header">
            <div>
              <h2>
                <Package className="inline-icon" /> Products
              </h2>
              <p className="text-muted text-sm mt-1">
                Admin-managed product catalogue · {products.length} product{products.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="panel-body p-0">
            {loadingData ? (
              <div className="flex justify-center py-16">
                <span className="spinner-inline large"></span>
              </div>
            ) : (
              <div className="table-scroll-wrap">
                <table className="data-table data-table--rc-products data-table--mobile-cards">
                  <thead>
                    <tr>
                      <th className="product-table-image-col">Image</th>
                      <th>Model ID</th>
                      <th>Model No</th>
                      <th>Product Name</th>
                      <th>Maximum Capacity</th>
                      <th>Actual Scale Interval (d)</th>
                      <th>Model Approval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map(p => {
                      const openView = () => handleViewProduct(p);
                      const viewCell = tableEditCellProps(openView, 'View product details');
                      const capacity = formatProductCapacity(p);
                      const interval = formatProductInterval(p);
                      const modelLine = [p.modelid, p.modelNo].filter(Boolean).join(' · ') || '—';
                      const hasApproval = Boolean(p.modelApprovalNo || p.modelApprovalDocUrl);

                      return (
                        <tr key={p.id} className="table-mobile-row table-mobile-row--media">
                          <td {...viewCell} className="product-table-image-col table-mobile-col-media table-col-editable">
                            {p.productImageUrl ? (
                              <a
                                href={p.productImageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View product image"
                                onClick={e => e.stopPropagation()}
                              >
                                <img src={p.productImageUrl} alt={p.name} className="product-table-thumb" />
                              </a>
                            ) : (
                              <span className="product-table-thumb-placeholder" title="No image">
                                <ImageIcon size={18} />
                              </span>
                            )}
                          </td>
                          <td {...viewCell} className="font-medium text-mono table-mobile-col-hide table-col-editable">
                            {p.modelid}
                          </td>
                          <td {...viewCell} className="text-mono table-mobile-col-hide table-col-editable">
                            {p.modelNo || '—'}
                          </td>
                          <td {...viewCell} className="font-medium table-mobile-col-primary table-col-editable">
                            <span className="table-mobile-primary-text">{p.name}</span>
                            <div className="table-mobile-summary">
                              <span className="table-mobile-summary-meta text-mono">{modelLine}</span>
                              <span className="table-mobile-summary-meta">
                                {capacity} · d {interval}
                              </span>
                              {hasApproval && (
                                <span className="table-mobile-summary-meta text-mono">
                                  {p.modelApprovalNo || 'Approval doc'}
                                  {p.modelApprovalDocUrl && (
                                    <a
                                      href={p.modelApprovalDocUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm text-blue"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <ExternalLink size={12} /> Doc
                                    </a>
                                  )}
                                </span>
                              )}
                            </div>
                          </td>
                          <td {...viewCell} className="table-mobile-col-capacity table-mobile-col-hide table-col-editable">
                            {capacity}
                          </td>
                          <td {...viewCell} className="table-mobile-col-interval table-mobile-col-hide table-col-editable">
                            {interval}
                          </td>
                          <td {...viewCell} className="table-mobile-col-hide table-col-editable">
                            {!p.modelApprovalNo && !p.modelApprovalDocUrl ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <span className="text-mono">{p.modelApprovalNo || '—'}</span>
                                {p.modelApprovalDocUrl && (
                                  <a
                                    href={p.modelApprovalDocUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-blue flex items-center gap-1"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <ExternalLink size={14} /> View doc
                                  </a>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {products.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center py-10 text-muted">
                          No admin products available yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
