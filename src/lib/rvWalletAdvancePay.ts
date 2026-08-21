import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_RC_FEES_STRUCTURE } from './rcProfileFields';
import { payRvFromWallet } from './rcWallet';
import {
  buildRvPaymentFirestorePatch,
  computeRvPaymentBreakdownForRecord,
  isRvPaymentSatisfied,
} from './rvPaymentAmount';
import type { Product, RcFeesStructure, SiteCalibration } from '../types';
import type { RvWalletFeeSettings } from './zohoRvSubmit';

function idempotencyKeyForRecords(recordIds: string[]): string {
  const raw = `submit-${[...recordIds].sort().join('.')}`;
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
}

/**
 * Debit RC wallet before RV submit/certify so records never sit as Payment due.
 * Skips already-paid rows. Groups unpaid RV by rcId.
 */
export async function ensureRvWalletDebitedForRecords(input: {
  records: SiteCalibration[];
  products: Product[];
  feeSettings?: RvWalletFeeSettings | null;
  feesForRc: (rcId: string) => RcFeesStructure;
}): Promise<void> {
  const unpaid = input.records.filter(record => {
    if (record.verificationType !== 'RV') return false;
    const fees = record.rcId ? input.feesForRc(record.rcId) : DEFAULT_RC_FEES_STRUCTURE;
    const expected = computeRvPaymentBreakdownForRecord(
      record,
      input.products,
      fees,
      input.feeSettings,
    )?.total ?? null;
    return !isRvPaymentSatisfied(record, expected);
  });

  if (unpaid.length === 0) return;

  const byRc = new Map<string, SiteCalibration[]>();
  for (const record of unpaid) {
    const rcId = record.rcId?.trim();
    if (!rcId) {
      throw new Error(
        `RV ${record.serialNumber || record.id} has no RC centre — cannot debit wallet.`,
      );
    }
    const list = byRc.get(rcId) ?? [];
    list.push(record);
    byRc.set(rcId, list);
  }

  for (const [rcId, group] of byRc) {
    const fees = input.feesForRc(rcId);
    const lines = group.map(record => {
      const breakdown = computeRvPaymentBreakdownForRecord(
        record,
        input.products,
        fees,
        input.feeSettings,
      );
      if (!breakdown || breakdown.total <= 0) {
        throw new Error(
          `Could not calculate wallet fee for ${record.serialNumber || record.id}. Check product capacity.`,
        );
      }
      return { record, breakdown };
    });

    const total = Math.round(lines.reduce((sum, line) => sum + line.breakdown.total, 0) * 100) / 100;
    const administrativeFees =
      Math.round(lines.reduce((sum, line) => sum + line.breakdown.administrativeFees, 0) * 100) / 100;
    const gst = Math.round(lines.reduce((sum, line) => sum + line.breakdown.gst, 0) * 100) / 100;

    const paid = await payRvFromWallet({
      rcId,
      amountInr: total,
      breakdown: {
        administrativeFees,
        gst,
        total,
        tdsTotal: administrativeFees,
        gatewayTotal: 0,
      },
      idempotencyKey: idempotencyKeyForRecords(group.map(record => record.id)),
      recordIds: group.map(record => record.id),
    });

    await Promise.all(
      lines.map(({ record, breakdown }) =>
        updateDoc(doc(db, 'siteCalibrations', record.id), {
          ...buildRvPaymentFirestorePatch(paid.paymentId, breakdown.total),
        }),
      ),
    );
  }
}
