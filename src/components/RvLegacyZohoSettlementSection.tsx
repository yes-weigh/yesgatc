import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  rcZohoExpenseAccountIdFromDoc,
  rcZohoExpenseAccountNameFromDoc,
} from '../lib/rcZohoExpenseAccountMigration';
import {
  isRvZohoSettlementOutstanding,
  isZohoRvInvoicingEnabled,
  rcZohoIdReady,
  rvLabourPayoutInr,
  rvZohoInvoiceSummary,
  verificationZohoInvoiceNumber,
} from '../lib/zohoRvSubmit';
import { pushLegacyRvZohoSettlement } from '../lib/zohoRvInvoice';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

type RvLegacyZohoSettlementSectionProps = {
  record: SiteCalibration;
  onSettled?: () => void | Promise<void>;
  className?: string;
};

export const RvLegacyZohoSettlementSection: React.FC<RvLegacyZohoSettlementSectionProps> = ({
  record,
  onSettled,
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
  const labourPayout = useMemo(() => rvLabourPayoutInr(record), [record]);
  const invoiceNumber = verificationZohoInvoiceNumber(record);

  const showBanner = isRvZohoSettlementOutstanding(record) && invoiceSummary != null;

  const pushBlockedReason = useMemo(() => {
    if (!isZohoRvInvoicingEnabled(appSettings)) {
      return 'Enable Zoho RV invoicing in Admin Settings.';
    }
    if (appSettings.zohoRvSettlementEnabled === false) {
      return 'Enable Zoho RV settlement in Admin Settings.';
    }
    if (!rcZohoIdReady(rcProfile?.zohoId)) {
      return 'Set the RC Zoho customer ID before settlement.';
    }
    const expenseAccountId = rcProfile ? rcZohoExpenseAccountIdFromDoc(rcProfile) : '';
    if (!expenseAccountId || expenseAccountId.replace(/\D/g, '').length < 10) {
      return 'Set the RC labour expense account ID on the RC profile.';
    }
    if (!record.applicationNumber?.trim()) {
      return 'Application number is missing.';
    }
    if (labourPayout == null) {
      return 'Maximum capacity is missing — cannot compute labour payout.';
    }
    return null;
  }, [appSettings, rcProfile, record.applicationNumber, labourPayout]);

  const handlePush = async () => {
    if (pushBlockedReason) return;
    setPushError('');
    setPushing(true);
    try {
      await pushLegacyRvZohoSettlement({ recordId: record.id });
      await onSettled?.();
    } catch (err: unknown) {
      setPushError(err instanceof Error ? err.message : 'Failed to settle Zoho RV payment.');
    } finally {
      setPushing(false);
    }
  };

  if (!showBanner || !invoiceSummary || labourPayout == null) return null;

  return (
    <div className={`rv-outstanding-zoho-banner${className ? ` ${className}` : ''}`}>
      <div className="rv-outstanding-zoho-banner__body">
        <p className="rv-outstanding-zoho-banner__title">Zoho payment &amp; labour expense pending</p>
        <p className="rv-outstanding-zoho-banner__meta text-sm text-muted mb-0">
          Invoice {invoiceNumber || '—'} · collect ₹{invoiceSummary.totalInr.toLocaleString('en-IN')} to GATC Wallet
          {record.zohoCustomerPaymentStatus === 'skipped_paid' ? ' (already paid in Zoho — will skip)' : ''}
          {' · '}pay ₹{labourPayout.toLocaleString('en-IN')} labour expense
          {rcProfile && rcZohoExpenseAccountNameFromDoc(rcProfile)
            ? ` (${rcZohoExpenseAccountNameFromDoc(rcProfile)})`
            : ''}
        </p>
      </div>
      {isSuperAdmin && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void handlePush()}
          disabled={pushing || Boolean(pushBlockedReason)}
          title={pushBlockedReason || undefined}
        >
          {pushing ? 'Settling…' : 'Settle in Zoho'}
        </button>
      )}
      {pushBlockedReason && isSuperAdmin && (
        <p className="text-muted text-xs mt-2 mb-0">{pushBlockedReason}</p>
      )}
      {pushError && (
        <p className="rc-form-topbar-error text-sm mt-2 mb-0" role="alert">
          {pushError}
        </p>
      )}
    </div>
  );
};
