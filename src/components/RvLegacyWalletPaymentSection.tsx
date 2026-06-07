import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { resolveRcFeesStructure } from '../lib/rcProfileFields';
import {
  buildRvPaymentFirestorePatch,
  computeRvPaymentBreakdownForRecord,
  isRvWalletPaymentOutstanding,
} from '../lib/rvPaymentAmount';
import {
  isWalletPaymentId,
  linkWalletPaymentToRecords,
  refundRvWalletPayment,
} from '../lib/rcWallet';
import { RvOutstandingWalletPaymentBanner } from './RvOutstandingWalletPaymentBanner';
import { RvWalletPaymentPanel } from './RvWalletPaymentPanel';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

type RvLegacyWalletPaymentSectionProps = {
  record: SiteCalibration;
  rcCenterName?: string;
  onPaymentRecorded?: () => void | Promise<void>;
  className?: string;
};

export const RvLegacyWalletPaymentSection: React.FC<RvLegacyWalletPaymentSectionProps> = ({
  record,
  rcCenterName,
  onPaymentRecorded,
  className = '',
}) => {
  const { user } = useAuth();
  const { products } = useAppContext();
  const [rcProfile, setRcProfile] = useState<FirestoreUserDoc | null>(null);
  const [legacyPaymentOpen, setLegacyPaymentOpen] = useState(false);
  const [legacyPaying, setLegacyPaying] = useState(false);
  const [legacyPaymentError, setLegacyPaymentError] = useState('');

  const isSuperAdmin = user?.role === 'super_admin';

  useEffect(() => {
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
  }, [record.rcId]);

  const legacyPaymentBreakdown = useMemo(
    () =>
      computeRvPaymentBreakdownForRecord(
        record,
        products,
        resolveRcFeesStructure(rcProfile),
      ),
    [record, products, rcProfile],
  );

  const showLegacyPaymentBanner =
    isRvWalletPaymentOutstanding(record)
    && legacyPaymentBreakdown != null
    && legacyPaymentBreakdown.total > 0;

  const handleLegacyPaymentComplete = async (paymentId: string) => {
    if (!legacyPaymentBreakdown || !record.rcId) return;
    setLegacyPaymentOpen(false);
    const walletPaymentId = isWalletPaymentId(paymentId) ? paymentId : null;
    setLegacyPaying(true);
    setLegacyPaymentError('');
    try {
      await updateDoc(doc(db, 'siteCalibrations', record.id), {
        ...buildRvPaymentFirestorePatch(paymentId, legacyPaymentBreakdown.total),
      });
      if (walletPaymentId) {
        await linkWalletPaymentToRecords({
          paymentId: walletPaymentId,
          recordIds: [record.id],
        });
      }
      await onPaymentRecorded?.();
    } catch (err: unknown) {
      if (walletPaymentId) {
        try {
          await refundRvWalletPayment({
            paymentId: walletPaymentId,
            reason: 'Failed to record legacy wallet payment on verification',
          });
        } catch {
          setLegacyPaymentError(
            `${err instanceof Error ? err.message : 'Failed to record payment.'} Wallet refund could not be completed automatically — contact support with payment id ${walletPaymentId}.`,
          );
          return;
        }
      }
      setLegacyPaymentError(
        err instanceof Error ? err.message : 'Failed to record payment on verification.',
      );
    } finally {
      setLegacyPaying(false);
    }
  };

  if (!showLegacyPaymentBanner || !legacyPaymentBreakdown) return null;

  return (
    <div className={className}>
      <RvOutstandingWalletPaymentBanner
        breakdown={legacyPaymentBreakdown}
        canPay={isSuperAdmin}
        rcCenterName={rcCenterName}
        onPay={() => {
          setLegacyPaymentError('');
          setLegacyPaymentOpen(true);
        }}
        paying={legacyPaying}
      />
      {legacyPaymentError && (
        <p className="rc-form-topbar-error text-sm mt-2" role="alert">
          {legacyPaymentError}
        </p>
      )}
      {legacyPaymentOpen && record.rcId && (
        <RvWalletPaymentPanel
          breakdown={legacyPaymentBreakdown}
          rcId={record.rcId}
          recordIds={[record.id]}
          onPaid={handleLegacyPaymentComplete}
          onClose={() => setLegacyPaymentOpen(false)}
          walletOwnerLabel={rcCenterName?.trim() ? `${rcCenterName.trim()}'s` : "this RC centre's"}
          paymentContext="legacy-admin"
        />
      )}
    </div>
  );
};
