import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  isRvZohoInvoiceOutstanding,
  isZohoRvInvoicingEnabled,
  rcZohoIdReady,
  rvZohoInvoiceSummary,
} from '../lib/zohoRvSubmit';
import { pushLegacyRvZohoInvoice } from '../lib/zohoRvInvoice';
import { RvOutstandingZohoInvoiceBanner } from './RvOutstandingZohoInvoiceBanner';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

type RvLegacyZohoInvoiceSectionProps = {
  record: SiteCalibration;
  rcCenterName?: string;
  onInvoicePushed?: () => void | Promise<void>;
  className?: string;
};

export const RvLegacyZohoInvoiceSection: React.FC<RvLegacyZohoInvoiceSectionProps> = ({
  record,
  rcCenterName,
  onInvoicePushed,
  className = '',
}) => {
  const { user } = useAuth();
  const { appSettings } = useAppSettings();
  const [rcProfile, setRcProfile] = useState<FirestoreUserDoc | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState('');

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

  const invoiceSummary = useMemo(() => rvZohoInvoiceSummary(record), [record]);

  const showLegacyZohoBanner =
    isRvZohoInvoiceOutstanding(record)
    && invoiceSummary != null;

  const pushBlockedReason = useMemo(() => {
    if (!isZohoRvInvoicingEnabled(appSettings)) {
      return 'Enable Zoho RV invoicing in Admin Settings before pushing.';
    }
    if (!rcZohoIdReady(rcProfile?.zohoId)) {
      return 'Set the RC Zoho customer ID on the RC profile before pushing.';
    }
    if (!record.applicationNumber?.trim()) {
      return 'Application number is missing on this verification.';
    }
    if (record.maximumCapacity == null) {
      return 'Maximum capacity is missing — cannot select the Zoho product.';
    }
    return null;
  }, [appSettings, rcProfile?.zohoId, record.applicationNumber, record.maximumCapacity]);

  const handlePush = async () => {
    if (pushBlockedReason) return;
    setPushError('');
    setPushing(true);
    try {
      await pushLegacyRvZohoInvoice({ recordId: record.id });
      await onInvoicePushed?.();
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : 'Failed to push Zoho invoice.');
    } finally {
      setPushing(false);
    }
  };

  if (!showLegacyZohoBanner || !invoiceSummary) return null;

  return (
    <div className={className}>
      <RvOutstandingZohoInvoiceBanner
        summary={invoiceSummary}
        applicationNumber={record.applicationNumber}
        canPush={isSuperAdmin}
        rcCenterName={rcCenterName}
        onPush={() => void handlePush()}
        pushing={pushing}
        pushBlockedReason={isSuperAdmin ? pushBlockedReason : null}
      />
      {pushError && (
        <p className="rc-form-topbar-error text-sm mt-2" role="alert">
          {pushError}
        </p>
      )}
    </div>
  );
};
