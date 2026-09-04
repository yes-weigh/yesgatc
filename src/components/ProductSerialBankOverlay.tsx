import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import {
  listProductSerialBank,
  productUsesPasSerials,
  type ProductSerialBankSummary,
  type ProductSerialRow,
} from '../lib/pasSerialBank';
import type { Product } from '../types';

function seatClass(row: ProductSerialRow): string {
  const status = row.status.trim().toLowerCase();
  if (status === 'used') return 'admin-setting-serial-seat admin-setting-serial-seat--used text-mono';
  if (status === 'cancelled' || status === 'replaced') {
    return 'admin-setting-serial-seat admin-setting-serial-seat--voided text-mono';
  }
  return 'admin-setting-serial-seat text-mono';
}

export function ProductSerialBankOverlay({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ProductSerialBankSummary | null>(null);
  const pas = productUsesPasSerials(product);

  useHistoryOverlay(true, onClose);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let cancelled = false;
    setLoading(true);
    setError('');
    void listProductSerialBank(product)
      .then(next => {
        if (!cancelled) setSummary(next);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load serials.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      document.body.style.overflow = prevOverflow;
    };
  }, [product]);

  const qty = summary?.qty ?? 0;

  return createPortal(
    <div
      className="admin-setting-serial-overlay product-serial-bank-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-serial-bank-title"
    >
      <header className="admin-setting-serial-stage-head">
        <h2 id="product-serial-bank-title" className="admin-setting-serial-stage-title">
          {product.name.trim() || 'Product'}
          <span>{pas ? 'PAS' : 'GAS'}</span>
          <span className="admin-setting-serial-count-num">{qty}</span>
        </h2>
        <button type="button" className="rv-payment-panel-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>
      <div className="product-serial-bank-qty" aria-label="Serial quantity">
        <span>
          Qty <strong>{qty}</strong>
        </span>
        <span>
          Available <strong>{summary?.available ?? 0}</strong>
        </span>
        <span>
          Used <strong>{summary?.used ?? 0}</strong>
        </span>
        {(summary?.cancelled ?? 0) > 0 ? (
          <span>
            Cancelled <strong>{summary?.cancelled ?? 0}</strong>
          </span>
        ) : null}
      </div>
      {error ? <p className="login-error">{error}</p> : null}
      {loading ? (
        <p className="text-muted text-sm product-serial-bank-empty">Loading serials…</p>
      ) : !summary || summary.rows.length === 0 ? (
        <p className="text-muted text-sm product-serial-bank-empty">No serial numbers in this pool.</p>
      ) : (
        <ul className="admin-setting-serial-seats">
          {summary.rows.map(row => (
            <li key={row.id} className={seatClass(row)} title={row.status}>
              {row.serial}
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
