import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  RefreshCw,
  Shield,
  User,
  Users,
} from 'lucide-react';
import { useHistoryOverlay } from '../../hooks/useHistoryOverlay';
import type { VerificationJobKind } from '../../lib/siteCalibrationProfileFields';

export type { VerificationJobKind };

type VerificationJobKindPickerProps = {
  ovBalanceQty: number | null;
  ovRemainingCount?: number;
  pendingSerials: string[];
  /** Catalogue has PAS products — OV can start without GAS seats. */
  hasPasProducts?: boolean;
  /** Verifier: only OV Self — hide OV/RV Customer + balance card. */
  verifierMode?: boolean;
  onSelect: (kind: VerificationJobKind, serial?: string, manufacturingYear?: string) => void;
  onClose: () => void;
};

const KINDS: {
  id: VerificationJobKind;
  ov: boolean;
  title: string;
  subtitle: string;
  tone: 'blue' | 'green' | 'orange';
  Icon: typeof User;
}[] = [
  {
    id: 'ov_self',
    ov: true,
    title: 'OV Self',
    subtitle: 'Original Verification – Self',
    tone: 'blue',
    Icon: User,
  },
  {
    id: 'ov_customer',
    ov: true,
    title: 'OV Customer',
    subtitle: 'Original Verification – Customer',
    tone: 'green',
    Icon: Users,
  },
  {
    id: 'rv_customer',
    ov: false,
    title: 'RV Customer',
    subtitle: 'Re-verification – Customer',
    tone: 'orange',
    Icon: RefreshCw,
  },
];

export function VerificationJobKindPicker({
  ovBalanceQty,
  ovRemainingCount,
  pendingSerials,
  hasPasProducts = false,
  verifierMode = false,
  onSelect,
  onClose,
}: VerificationJobKindPickerProps) {
  const skipHistoryBackRef = useRef(false);
  const seats = useMemo(
    () =>
      [...pendingSerials].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      ),
    [pendingSerials],
  );
  const qtyBlocked = verifierMode
    ? seats.length === 0 && !hasPasProducts
    : ovBalanceQty != null && ovBalanceQty <= 0;
  const serialBlocked = ovRemainingCount === 0 || (verifierMode && seats.length === 0);
  const ovBlocked = qtyBlocked || (serialBlocked && !hasPasProducts);
  const balanceLabel = verifierMode
    ? String(seats.length)
    : ovBalanceQty == null
      ? '—'
      : String(Math.max(0, ovBalanceQty));

  const visibleKinds = useMemo(
    () => (verifierMode ? KINDS.filter(kind => kind.id === 'ov_self') : KINDS),
    [verifierMode],
  );

  useHistoryOverlay(true, onClose, { suppressHistoryBackRef: skipHistoryBackRef });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="verification-job-kind-page"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verification-job-kind-title"
    >
      <header className="verification-job-kind-page-bar">
        <button
          type="button"
          className="verification-job-kind-back"
          onClick={onClose}
          aria-label="Back to list"
        >
          <span className="verification-job-kind-back-icon" aria-hidden>
            <ArrowLeft size={18} strokeWidth={2.25} />
          </span>
          Back
        </button>
        <div className="verification-job-kind-page-intro">
          <h1 id="verification-job-kind-title">New Verification Job</h1>
          <p>Select verification type to create a new job</p>
        </div>
      </header>

      <div className="verification-job-kind-page-body">
        <div className="verification-job-kind-page-list">
          {visibleKinds.map(kind => {
            const disabled = kind.ov && ovBlocked;
            const Icon = kind.Icon;
            return (
              <button
                key={kind.id}
                type="button"
                className={`verification-job-kind-row verification-job-kind-row--${kind.tone}`}
                disabled={disabled}
                onClick={() => {
                  skipHistoryBackRef.current = true;
                  onSelect(kind.id);
                }}
              >
                <span className={`verification-job-kind-avatar verification-job-kind-avatar--${kind.tone}`}>
                  <Icon size={18} strokeWidth={2.2} aria-hidden />
                  <span className="verification-job-kind-shield" aria-hidden>
                    <Shield size={10} strokeWidth={2.4} />
                  </span>
                </span>
                <span className="verification-job-kind-copy">
                  <span className="verification-job-kind-copy-title">{kind.title}</span>
                  <span className="verification-job-kind-copy-sub">{kind.subtitle}</span>
                </span>
                <ChevronRight className="verification-job-kind-chevron" size={18} strokeWidth={2} aria-hidden />
              </button>
            );
          })}

          {!verifierMode ? (
            <div className="verification-job-kind-balance-card" role="status">
              <span className="verification-job-kind-avatar verification-job-kind-avatar--purple">
                <ClipboardList size={18} strokeWidth={2.2} aria-hidden />
              </span>
              <span className="verification-job-kind-copy">
                <span className="verification-job-kind-copy-title">Balance OV Quantity to do</span>
                <span className="verification-job-kind-copy-sub">Total OV Self + OV Customer</span>
              </span>
              <span className="verification-job-kind-balance-stat">
                <strong>{balanceLabel}</strong>
                <span>Jobs</span>
              </span>
            </div>
          ) : null}
        </div>

        {!verifierMode && qtyBlocked ? (
          <p className="verification-job-kind-hint">OV quota is 0. RV Customer still available.</p>
        ) : !verifierMode && serialBlocked && !hasPasProducts ? (
          <p className="verification-job-kind-hint">No allotted serials left. RV Customer still available.</p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
