import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { RefreshCw } from 'lucide-react';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/useAuth';
import { useConfirm } from '../context/ConfirmContext';
import { resolveRcFeesStructure } from '../lib/rcProfileFields';
import {
  isWalletPaymentId,
  linkWalletPaymentToRecords,
  refundRvWalletPayment,
} from '../lib/rcWallet';
import { computeRvPaymentBreakdownForRecord } from '../lib/rvPaymentAmount';
import {
  canResubmitRejectedVerification,
  findSerialRvWalletPayment,
  getVerificationSerialGroup,
  rejectedResubmitNeedsFreshWalletCharge,
  resubmitRejectedVerification,
} from '../lib/verificationResubmit';
import type { FirestoreUserDoc, SiteCalibration } from '../types';
import { RvWalletPaymentPanel } from './RvWalletPaymentPanel';

type RejectedResubmitSectionProps = {
  record: SiteCalibration;
  allRecords?: SiteCalibration[];
  rcCenterName?: string;
  onResubmitted?: (newRecordId?: string) => void | Promise<void>;
  className?: string;
};

export const RejectedResubmitSection: React.FC<RejectedResubmitSectionProps> = ({
  record,
  allRecords = [],
  rcCenterName,
  onResubmitted,
  className = '',
}) => {
  const { user } = useAuth();
  const { products } = useAppContext();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [rcProfile, setRcProfile] = useState<FirestoreUserDoc | null>(null);

  const isSuperAdmin = user?.role === 'super_admin';
  const group = useMemo(
    () => getVerificationSerialGroup(allRecords.length ? allRecords : [record], record),
    [allRecords, record],
  );

  const eligible = canResubmitRejectedVerification(record, group, isSuperAdmin);
  const reusablePayment = useMemo(
    () => findSerialRvWalletPayment(record, group),
    [record, group],
  );
  const needsFreshWallet = rejectedResubmitNeedsFreshWalletCharge(record, group);

  useEffect(() => {
    if (!eligible || !needsFreshWallet) {
      setRcProfile(null);
      return;
    }
    const rcId = record.rcId?.trim();
    if (!rcId) {
      setRcProfile(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', rcId));
        if (!cancelled) {
          setRcProfile(snap.exists() ? (snap.data() as FirestoreUserDoc) : null);
        }
      } catch {
        if (!cancelled) setRcProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eligible, needsFreshWallet, record.rcId]);

  const breakdown = useMemo(
    () =>
      needsFreshWallet
        ? computeRvPaymentBreakdownForRecord(
            record,
            products,
            resolveRcFeesStructure(rcProfile),
          )
        : null,
    [needsFreshWallet, record, products, rcProfile],
  );

  if (!eligible) return null;

  const appNo = record.applicationNumber?.trim() || '—';
  const serial = record.serialNumber?.trim() || '—';

  const completeResubmit = async (rvPayment?: { paymentId: string; amountInr: number }) => {
    if (!user?.uid) return;
    setBusy(true);
    setError('');
    const walletPaymentId =
      rvPayment && isWalletPaymentId(rvPayment.paymentId) ? rvPayment.paymentId : null;
    try {
      const result = await resubmitRejectedVerification(db, record, user.uid, {
        group,
        rvPayment,
      });
      if (walletPaymentId) {
        await linkWalletPaymentToRecords({
          paymentId: walletPaymentId,
          recordIds: [result.newRecordId],
        });
      }
      setPaymentOpen(false);
      await onResubmitted?.(result.newRecordId);
    } catch (err: unknown) {
      if (walletPaymentId) {
        try {
          await refundRvWalletPayment({
            paymentId: walletPaymentId,
            reason: 'Failed to create rejected verification resubmit',
          });
        } catch {
          setError(
            `${err instanceof Error ? err.message : 'Resubmit failed.'} Wallet refund could not be completed automatically — contact support with payment id ${walletPaymentId}.`,
          );
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to resubmit rejected verification.');
    } finally {
      setBusy(false);
    }
  };

  const handleResubmitClick = async () => {
    setError('');

    if (needsFreshWallet) {
      if (!record.rcId?.trim()) {
        setError('Rejected RV has no RC centre — cannot debit wallet.');
        return;
      }
      if (!breakdown || breakdown.total <= 0) {
        setError('Could not compute RV wallet fee for this verification.');
        return;
      }

      const ok = await confirm({
        title: 'Resubmit rejected RV?',
        message: [
          `Queue a new verification for App ${appNo} (serial ${serial})?`,
          '',
          `No prior wallet payment for this serial — RC wallet will be debited ₹${Math.round(breakdown.total)}.`,
          'The rejected record stays closed; the worker picks up the new submission.',
        ].join('\n'),
        messageFormat: 'preline',
        confirmLabel: 'Continue to payment',
        destructive: true,
      });
      if (!ok) return;
      setPaymentOpen(true);
      return;
    }

    const reuseLine = reusablePayment
      ? `Wallet already paid for this serial (₹${Math.round(reusablePayment.amountInr)}) — no new debit.`
      : null;

    const ok = await confirm({
      title: 'Resubmit rejected verification?',
      message: [
        `Queue a new verification for App ${appNo} (serial ${serial})?`,
        '',
        ...(reuseLine ? [reuseLine, ''] : []),
        'The rejected record stays closed; the worker picks up the new submission.',
      ].join('\n'),
      messageFormat: 'preline',
      confirmLabel: 'Resubmit',
      destructive: true,
    });
    if (!ok) return;
    await completeResubmit();
  };

  const helpText = needsFreshWallet
    ? 'New run — wallet will be charged.'
    : reusablePayment
      ? `New run — reuses ₹${Math.round(reusablePayment.amountInr)} wallet payment.`
      : 'New run for certificate worker.';

  return (
    <div className={`rejected-resubmit ${className}`.trim()}>
      <div className="rejected-resubmit__inner glass">
        <div className="rejected-resubmit__text">
          <p className="rejected-resubmit__label text-muted text-xs mb-1">Super Admin</p>
          <p className="rejected-resubmit__title mb-0">Resubmit</p>
          <p className="text-muted text-sm mb-0">{helpText}</p>
          {error && (
            <p className="form-error text-sm mb-0 mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => void handleResubmitClick()}
        >
          <RefreshCw size={14} aria-hidden />
          {busy ? 'Resubmitting…' : 'Resubmit'}
        </button>
      </div>

      {paymentOpen && record.rcId && breakdown && (
        <RvWalletPaymentPanel
          breakdown={breakdown}
          rcId={record.rcId}
          onPaid={async paymentId => {
            await completeResubmit({
              paymentId,
              amountInr: breakdown.total,
            });
          }}
          onClose={() => {
            if (!busy) setPaymentOpen(false);
          }}
          walletOwnerLabel={rcCenterName?.trim() ? `${rcCenterName.trim()}'s` : "this RC centre's"}
          paymentContext="legacy-admin"
        />
      )}
    </div>
  );
};
