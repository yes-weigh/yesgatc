import React from 'react';
import { ExternalLink, Image as ImageIcon, Package } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';

export const RCProducts: React.FC = () => {
  const { products, loadingData } = useAppContext();

  return (
    <div className="fade-in page-content">
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
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="product-table-image-col">Image</th>
                    <th>Model ID</th>
                    <th>Model No</th>
                    <th>Product Name</th>
                    <th>Model Approval No</th>
                    <th>Maximum Capacity</th>
                    <th>View Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.id}>
                      <td className="product-table-image-col">
                        {p.productImageUrl ? (
                          <a
                            href={p.productImageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View product image"
                          >
                            <img src={p.productImageUrl} alt={p.name} className="product-table-thumb" />
                          </a>
                        ) : (
                          <span className="product-table-thumb-placeholder" title="No image">
                            <ImageIcon size={18} />
                          </span>
                        )}
                      </td>
                      <td className="font-medium text-mono">{p.modelid}</td>
                      <td className="text-mono">{p.modelNo || '—'}</td>
                      <td className="font-medium">{p.name}</td>
                      <td className="text-mono text-sm">{p.modelApprovalNo || '—'}</td>
                      <td>
                        {p.maximumCapacity
                          ? `${p.maximumCapacity} ${p.unitOfMeasurement || 'kg'}`
                          : '—'}
                      </td>
                      <td>
                        {p.modelApprovalDocUrl ? (
                          <a
                            href={p.modelApprovalDocUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue flex items-center gap-1"
                          >
                            <ExternalLink size={14} /> View
                          </a>
                        ) : (
                          <span className="text-muted text-sm">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
    </div>
  );
};
