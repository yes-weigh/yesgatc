import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Product, RcFeesStructure, SiteCalibration, WalletLedgerEntry } from '../types';
import { resolveRvWalletDisplayAmount } from './rvPaymentAmount';
import { walletLedgerTypeLabel } from './rcWallet';

function roundInr(value: number): number {
  return Math.round(value * 100) / 100;
}

function inrAmountsMatch(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export type WalletLedgerRecordSplit = {
  recordId: string;
  amountInr: number;
  detail: string;
};

export type WalletLedgerDisplayRow = {
  key: string;
  ledgerEntryId: string;
  entry: WalletLedgerEntry;
  amountInr: number;
  balanceAfterInr: number | null;
  typeLabel: string;
  detail?: string;
  splitIndex: number;
  splitCount: number;
};

function verificationRecordLabel(record: SiteCalibration): string {
  const serial = record.serialNumber?.trim();
  if (serial) return serial;
  const cert = record.certificateNumber?.trim();
  if (cert) return cert;
  return record.id.slice(0, 8);
}

export function splitRvWalletLedgerAmounts(
  entry: WalletLedgerEntry,
  recordsById: ReadonlyMap<string, SiteCalibration>,
  products: Product[],
  fees: RcFeesStructure,
): WalletLedgerRecordSplit[] | null {
  if (entry.type !== 'rv_payment' && entry.type !== 'rv_refund') return null;

  const recordIds = entry.recordIds?.filter(id => typeof id === 'string' && id.trim()) ?? [];
  if (recordIds.length <= 1) return null;

  const sign = entry.amountInr >= 0 ? 1 : -1;
  const splits: WalletLedgerRecordSplit[] = [];

  for (const recordId of recordIds) {
    const record = recordsById.get(recordId);
    if (!record) continue;
    const perRecord = resolveRvWalletDisplayAmount(record, products, fees);
    if (perRecord == null || perRecord <= 0) continue;
    splits.push({
      recordId,
      amountInr: sign * roundInr(perRecord),
      detail: verificationRecordLabel(record),
    });
  }

  if (splits.length <= 1) return null;

  const splitSum = splits.reduce((sum, row) => sum + Math.abs(row.amountInr), 0);
  const entryTotal = Math.abs(entry.amountInr);
  if (!inrAmountsMatch(splitSum, entryTotal)) return null;

  return splits;
}

export function expandWalletLedgerForDisplay(
  entries: WalletLedgerEntry[],
  recordsById: ReadonlyMap<string, SiteCalibration>,
  products: Product[],
  fees: RcFeesStructure,
): WalletLedgerDisplayRow[] {
  const rows: WalletLedgerDisplayRow[] = [];

  for (const entry of entries) {
    const splits = splitRvWalletLedgerAmounts(entry, recordsById, products, fees);
    if (!splits) {
      const singleRecordId = entry.recordIds?.length === 1 ? entry.recordIds[0] : undefined;
      const singleRecord = singleRecordId ? recordsById.get(singleRecordId) : undefined;
      rows.push({
        key: entry.id,
        ledgerEntryId: entry.id,
        entry,
        amountInr: entry.amountInr,
        balanceAfterInr: entry.balanceAfterInr,
        typeLabel: walletLedgerTypeLabel(entry.type),
        detail: singleRecord ? verificationRecordLabel(singleRecord) : undefined,
        splitIndex: 0,
        splitCount: 1,
      });
      continue;
    }

    splits.forEach((split, index) => {
      rows.push({
        key: `${entry.id}:${split.recordId}`,
        ledgerEntryId: entry.id,
        entry,
        amountInr: split.amountInr,
        balanceAfterInr: index === splits.length - 1 ? entry.balanceAfterInr : null,
        typeLabel: walletLedgerTypeLabel(entry.type),
        detail: split.detail,
        splitIndex: index,
        splitCount: splits.length,
      });
    });
  }

  return rows;
}

export async function fetchSiteCalibrationsByIds(
  recordIds: Iterable<string>,
): Promise<Map<string, SiteCalibration>> {
  const unique = [...new Set([...recordIds].filter(id => typeof id === 'string' && id.trim()))];
  const map = new Map<string, SiteCalibration>();

  await Promise.all(
    unique.map(async id => {
      const snap = await getDoc(doc(db, 'siteCalibrations', id));
      if (!snap.exists()) return;
      map.set(id, { id: snap.id, ...(snap.data() as Omit<SiteCalibration, 'id'>) });
    }),
  );

  return map;
}

export function collectWalletLedgerRecordIds(entries: WalletLedgerEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const recordId of entry.recordIds ?? []) {
      if (typeof recordId === 'string' && recordId.trim()) ids.add(recordId);
    }
  }
  return [...ids];
}
