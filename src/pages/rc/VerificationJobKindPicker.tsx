import { useEffect, useMemo, useState } from 'react';
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
import { ManufacturingYearPicker } from '../../components/ManufacturingYearPicker';
import { useHistoryOverlay } from '../../hooks/useHistoryOverlay';
import {
  verificationJobKindLabel,
  type VerificationJobKind,
} from '../../lib/siteCalibrationProfileFields';

export type { VerificationJobKind };

type VerificationJobKindPickerProps = {
  ovBalanceQty: number | null;
  ovRemainingCount?: number;
  pendingSerials: string[];
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
  verifierMode = false,
  onSelect,
  onClose,
}: VerificationJobKindPickerProps) {
  const qtyBlocked = ovBalanceQty != null && ovBalanceQty <= 0;
  const serialBlocked = ovRemainingCount === 0;
  const ovBlocked = qtyBlocked || serialBlocked;
  const balanceLabel = ovBalanceQty == null ? '—' : String(Math.max(0, ovBalanceQty));
  const [pickingKind, setPickingKind] = useState<VerificationJobKind | null>(null);
  const [pickedSerial, setPickedSerial] = useState('');
  const [manualSerial, setManualSerial] = useState('');
  const [manufacturingYear, setManufacturingYear] = useState('');

  const visibleKinds = useMemo(
    () => (verifierMode ? KINDS.filter(kind => kind.id === 'ov_self') : KINDS),
    [verifierMode],
  );
  const seats = useMemo(
    () =>
      [...pendingSerials].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      ),
    [pendingSerials],
  );

  const isRvManual = pickingKind === 'rv_customer';
  const serialReady = isRvManual
    ? manualSerial.trim().length > 0 && manufacturingYear.trim().length > 0
    : Boolean(pickedSerial);

  const resetSerialPick = () => {
    setPickingKind(null);
    setPickedSerial('');
    setManualSerial('');
    setManufacturingYear('');
  };

  useHistoryOverlay(true, onClose);
  useHistoryOverlay(pickingKind !== null, resetSerialPick);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pickingKind) {
        resetSerialPick();
        return;
      }
      onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, pickingKind]);

  const handleKindClick = (kind: VerificationJobKind) => {
    setPickedSerial('');
    setManualSerial('');
    setManufacturingYear('');
    setPickingKind(kind);
  };

  const handleConfirmSerial = () => {
    if (!pickingKind) return;
    const serial = isRvManual ? manualSerial.trim() : pickedSerial;
    if (!serial) return;
    if (isRvManual && !manufacturingYear.trim()) return;
    onSelect(pickingKind, serial, isRvManual ? manufacturingYear.trim() : undefined);
  };

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
                onClick={() => handleKindClick(kind.id)}
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
        ) : !verifierMode && serialBlocked ? (
          <p className="verification-job-kind-hint">No allotted serials left. RV Customer still available.</p>
        ) : null}
      </div>

      {pickingKind ? (
        <div
          className="verification-ov-seat-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="verification-ov-seat-title"
        >
          <header className="verification-ov-seat-head">
            <button
              type="button"
              className="verification-job-kind-back"
              onClick={resetSerialPick}
              aria-label="Back"
            >
              <span className="verification-job-kind-back-icon" aria-hidden>
                <ArrowLeft size={18} strokeWidth={2.25} />
              </span>
              Back
            </button>
            <div className="verification-ov-seat-intro-row">
              <div className="verification-ov-seat-intro">
                <h2 id="verification-ov-seat-title">
                  {isRvManual ? 'Enter serial number' : 'Pending serials'}
                </h2>
                <p>
                  {isRvManual
                    ? `${verificationJobKindLabel(pickingKind)} — serial + year of manufacturing`
                    : `${verificationJobKindLabel(pickingKind)} — select one serial number`}
                </p>
              </div>
              {!isRvManual ? (
                <div className="verification-ov-seat-qty" role="status" aria-label={`Quantity ${balanceLabel}`}>
                  <span className="verification-ov-seat-qty-label">Qty</span>
                  <strong className="verification-ov-seat-qty-value">{balanceLabel}</strong>
                </div>
              ) : null}
            </div>
          </header>

          {isRvManual ? (
            <div className="verification-rv-serial-entry">
              <div className="verification-rv-serial-entry__stack">
                <label className="sr-only" htmlFor="rv-manual-serial">
                  Serial number
                </label>
                <input
                  id="rv-manual-serial"
                  className="input-field verification-rv-serial-entry__input text-mono"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="Serial number"
                  value={manualSerial}
                  onChange={e => setManualSerial(e.target.value)}
                />
                <div className="verification-rv-serial-entry__year">
                  <span className="verification-rv-serial-entry__year-label">
                    Year of manufacturing <span className="verification-device-required">*</span>
                  </span>
                  <ManufacturingYearPicker
                    value={manufacturingYear}
                    onChange={setManufacturingYear}
                  />
                </div>
              </div>
            </div>
          ) : seats.length === 0 ? (
            <p className="verification-job-kind-hint">No pending serials.</p>
          ) : (
            <ul className="admin-setting-serial-seats verification-ov-seat-grid">
              {seats.map(serial => {
                const picked = pickedSerial === serial;
                return (
                  <li key={serial}>
                    <button
                      type="button"
                      className={`admin-setting-serial-seat text-mono${picked ? ' admin-setting-serial-seat--picked' : ''}`}
                      aria-pressed={picked}
                      aria-label={picked ? `${serial} selected` : `Select ${serial}`}
                      onClick={() => setPickedSerial(picked ? '' : serial)}
                    >
                      {serial}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <footer className="verification-ov-seat-foot">
            <p className="verification-ov-seat-picked">
              {isRvManual
                ? !manualSerial.trim()
                  ? 'Enter serial number'
                  : !manufacturingYear.trim()
                    ? 'Select year of manufacturing'
                    : `${manualSerial.trim()} · ${manufacturingYear}`
                : pickedSerial
                  ? `Selected ${pickedSerial}`
                  : 'Select one serial'}
            </p>
            <button
              type="button"
              className="verification-ov-seat-continue"
              disabled={!serialReady}
              onClick={handleConfirmSerial}
            >
              Continue
            </button>
          </footer>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
