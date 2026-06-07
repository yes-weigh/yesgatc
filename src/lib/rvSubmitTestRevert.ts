import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import { formatRcFeeAmount } from './rcProfileFields';
import { normalizeVerificationStatus } from './verificationRequest';
import type { SiteCalibration } from '../types';

const FUNCTIONS_REGION = 'us-central1';

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

function rvSettlementReference(prefix: string, applicationNumber: string): string {
  const safe = applicationNumber.replace(/[^\w/.-]/g, '').slice(0, 40);
  return `${prefix}${safe || 'UNKNOWN'}`;
}

export function isDevWipeableCertifiedRv(
  record: SiteCalibration,
  isSuperAdmin: boolean,
): boolean {
  if (!isSuperAdmin || record.verificationType !== 'RV') return false;
  const status = normalizeVerificationStatus(record);
  return status === 'certified' || status === 'approved';
}

export function collectRvSubmitBatchForDisplay(
  anchor: SiteCalibration,
  allRecords: SiteCalibration[],
  isSuperAdmin = false,
): SiteCalibration[] {
  if (anchor.verificationType !== 'RV') return [anchor];
  if (isDevWipeableCertifiedRv(anchor, isSuperAdmin)) return [anchor];
  if (normalizeVerificationStatus(anchor) !== 'submitted') return [anchor];

  const submittedAt = anchor.submittedAt;
  const rcId = anchor.rcId;
  if (!submittedAt || !rcId) return [anchor];

  const batch = allRecords.filter(
    record =>
      record.rcId === rcId
      && record.submittedAt === submittedAt
      && record.verificationType === 'RV'
      && normalizeVerificationStatus(record) === 'submitted',
  );

  return batch.length ? batch : [anchor];
}

export function canRevertRvSubmitTest(
  record: SiteCalibration,
  isSuperAdmin = false,
): boolean {
  if (!import.meta.env.DEV || record.verificationType !== 'RV') return false;

  if (isDevWipeableCertifiedRv(record, isSuperAdmin)) return true;

  return (
    normalizeVerificationStatus(record) === 'submitted'
    && !record.approvedAt
    && !record.certifiedAt
    && !record.certificateNumber?.trim()
  );
}

/** Plain-text Zoho manual cleanup instructions for the revert confirmation. */
export function buildRvSubmitTestRevertMessage(
  batch: SiteCalibration[],
  rcName: string,
): string {
  const hasCertified = batch.some(
    record => normalizeVerificationStatus(record) === 'certified'
      || normalizeVerificationStatus(record) === 'approved',
  );

  const lines: string[] = [
    `Firebase (automatic): delete ${batch.length} RV record${batch.length === 1 ? '' : 's'}, restore wallet balance when a ledger row exists, and remove wallet ledger rows.`,
  ];
  if (hasCertified) {
    lines.push(
      'Certified/approved records are Super Admin dev wipe only — certificate PDFs in Storage are not deleted.',
    );
  }
  lines.push('', 'ZOHO BOOKS — remove manually to stay in sync:');

  if (batch.length === 0) {
    lines.push('• No records in this submit batch.');
    return lines.join('\n');
  }

  batch.forEach((record, index) => {
    const appNo = record.applicationNumber?.trim() || '—';
    const header = batch.length > 1
      ? `Record ${index + 1} · App ${appNo}`
      : `App ${appNo} · ${rcName}`;

    lines.push('');
    lines.push(header);

    if (record.zohoInvoiceId || record.zohoInvoiceNumber) {
      lines.push(
        `• Sales invoice: ${record.zohoInvoiceNumber?.trim() || record.zohoInvoiceId}`,
      );
      if (record.zohoInvoiceId) {
        lines.push(`  Invoice ID: ${record.zohoInvoiceId}`);
      }
    } else {
      lines.push('• Sales invoice: none recorded in Firebase');
    }

    if (record.zohoInvoiceReferenceNumber) {
      lines.push(`• Invoice ORDER NUMBER: ${record.zohoInvoiceReferenceNumber}`);
    }

    const payRef = rvSettlementReference('RV-PAY-', appNo);
    const labRef = rvSettlementReference('RV-LAB-', appNo);
    lines.push(`• Customer payment (if posted): ref ${payRef}`);
    if (record.zohoCustomerPaymentId) {
      lines.push(`  Payment ID: ${record.zohoCustomerPaymentId}`);
    }

    lines.push(`• Labour expense (if posted): ref ${labRef}`);
    if (record.zohoExpenseId) {
      lines.push(`  Expense ID: ${record.zohoExpenseId}`);
    }

    if (record.rvPaymentId?.startsWith('wallet:') && record.rvPaymentAmount != null) {
      lines.push(
        `• App wallet debit to restore: ${formatRcFeeAmount(record.rvPaymentAmount)} (${record.rvPaymentId})`,
      );
    }

    if (record.certificateNumber?.trim()) {
      lines.push(`• DOCA certificate: ${record.certificateNumber.trim()} (remove in portal if issued)`);
    }
  });

  lines.push('');
  lines.push('DOCA: no app action — ensure the certificate worker is in fill-only / offline mode during testing.');

  return lines.join('\n');
}

export async function revertRvSubmitTest(recordId: string): Promise<{
  recordId: string;
  deletedRecordIds: string[];
  deletedCount: number;
  walletPaymentsCleared: number;
  reverted: boolean;
}> {
  const fn = httpsCallable<
    { recordId: string },
    {
      recordId: string;
      deletedRecordIds: string[];
      deletedCount: number;
      walletPaymentsCleared: number;
      reverted: boolean;
    }
  >(functionsClient(), 'revertRvSubmitTest');

  const result = await fn({ recordId });
  return result.data;
}
