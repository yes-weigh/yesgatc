import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type SerialSeatOverlayProps = {
  companyName: string;
  rcCode: string;
  serials: string[];
  voidedSerials: string[];
  expectedCount: number | null;
  canVoid: boolean;
  onToggleVoid?: (serial: string, voided: boolean) => Promise<void>;
  onClose: () => void;
};

export function SerialSeatOverlay({
  companyName,
  rcCode,
  serials,
  voidedSerials,
  expectedCount,
  canVoid,
  onToggleVoid,
  onClose,
}: SerialSeatOverlayProps) {
  const voidedKeys = new Set(voidedSerials.map(serial => serial.toLowerCase()));
  const activeCount = serials.filter(serial => !voidedKeys.has(serial.toLowerCase())).length;
  const mismatch = expectedCount == null ? activeCount > 0 : expectedCount !== activeCount;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const handleVoid = async (serial: string, nextVoided: boolean) => {
    if (!canVoid || !onToggleVoid || busy) return;
    setError('');
    setBusy(serial);
    try {
      await onToggleVoid(serial, nextVoided);
    } catch {
      setError('Could not void serial.');
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <div
      className="admin-setting-serial-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="serial-total-title"
    >
      <header className="admin-setting-serial-stage-head">
        <h2 id="serial-total-title" className="admin-setting-serial-stage-title">
          {companyName}
          {rcCode ? <span>{rcCode}</span> : null}
          <span className={`admin-setting-serial-count-num${mismatch ? ' admin-setting-qty--bad' : ''}`}>
            {activeCount}
          </span>
        </h2>
        <button
          type="button"
          className="rv-payment-panel-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </header>
      {error ? <p className="login-error">{error}</p> : null}
      {serials.length === 0 ? (
        <p className="text-muted text-sm">No serial numbers.</p>
      ) : (
        <ul className="admin-setting-serial-seats">
          {serials.map(serial => {
            const voided = voidedKeys.has(serial.toLowerCase());
            const className = `admin-setting-serial-seat${voided ? ' admin-setting-serial-seat--voided' : ''}`;
            if (!canVoid || !onToggleVoid) {
              return (
                <li key={serial} className={`${className} text-mono`}>{serial}</li>
              );
            }
            return (
              <li key={serial}>
                <button
                  type="button"
                  className={`${className} text-mono`}
                  aria-pressed={voided}
                  aria-label={voided ? `Restore ${serial}` : `Void ${serial}`}
                  disabled={Boolean(busy)}
                  onClick={() => void handleVoid(serial, !voided)}
                >
                  {serial}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
}
