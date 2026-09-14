import type { InterweighingDirectBatch } from '../types.ts';
import type { OvQuotaAllotment } from './ovQuotaGate.ts';
import { uniqueDirectSerials } from './interweighingDirectSerials.ts';
import { isGasStickerSerial } from './pasSerialBankMatch.ts';
import { assignmentIsPas, vrAllottedAssignmentSerials } from './vrAllotted.ts';

export type PasSeatAssignment = {
  verifierUid: string;
  verifierUids?: string[];
  productType?: string;
  productId?: string;
  productName?: string;
  modelid?: string;
  yesoneSku?: string;
  sku?: string;
  serialStart?: string;
  serialEnd?: string;
  serials?: string[];
};

function assignmentUids(row: PasSeatAssignment): string[] {
  return [...new Set([...(row.verifierUids || []), row.verifierUid].map(uid => uid.trim()).filter(Boolean))];
}

function toAllotment(
  serial: string,
  row: {
    productId?: string;
    productName?: string;
    modelid?: string;
    yesoneSku?: string;
    sku?: string;
  },
): OvQuotaAllotment | null {
  if (!serial.trim() || isGasStickerSerial(serial)) return null;
  return {
    serialNumber: serial.trim(),
    productId: row.productId,
    productName: row.productName,
    modelid: row.modelid,
    sku: row.yesoneSku || row.sku,
    pool: 'pas',
  };
}

/** Unused PAS seats from Invoice Allotment + Direct PAS batches. Never G/X. */
export function unusedPasSeatsForActor(input: {
  assignments: readonly PasSeatAssignment[];
  batches?: readonly InterweighingDirectBatch[];
  usedSerials: readonly string[];
  actorUid?: string | null;
  scopedToVerifier?: boolean;
}): { remaining: string[]; allotments: OvQuotaAllotment[] } {
  const used = new Set(input.usedSerials.map(serial => serial.trim().toUpperCase()).filter(Boolean));
  const actor = String(input.actorUid || '').trim();
  const allotments: OvQuotaAllotment[] = [];

  for (const row of input.assignments) {
    if (!assignmentIsPas(row)) continue;
    if (input.scopedToVerifier && actor && !assignmentUids(row).includes(actor)) continue;
    for (const serial of vrAllottedAssignmentSerials(row)) {
      if (used.has(serial.trim().toUpperCase())) continue;
      const item = toAllotment(serial, row);
      if (item) allotments.push(item);
    }
  }

  for (const row of input.batches || []) {
    if (String(row.productType || '').trim().toLowerCase() !== 'pas') continue;
    for (const serial of vrAllottedAssignmentSerials(row)) {
      if (used.has(serial.trim().toUpperCase())) continue;
      const item = toAllotment(serial, row);
      if (item) allotments.push(item);
    }
  }

  const remaining = uniqueDirectSerials(allotments.map(row => row.serialNumber));
  return { remaining, allotments };
}
