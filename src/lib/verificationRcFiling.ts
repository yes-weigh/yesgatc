import { deleteField, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { SiteCalibration } from '../types';
import { isKeralaState, KERALA_STATE, rcFilingPartyPatch } from './keralaRegion';
import { inferVerificationSubject } from './siteCalibrationProfileFields';
import { normalizeVerificationStatus } from './verificationRequest';

/** Submitted jobs the operator asked to file under RC name. */
const FORCE_RC_FILING_SERIALS = new Set(['MY2122', 'MY2116', 'MY2115']);

function rcCentreName(record: SiteCalibration, rcNameByUid: Map<string, string>): string {
  const name = (record.rcId && rcNameByUid.get(record.rcId)) || '';
  return name.trim() === '—' ? '' : name.trim();
}

function sourceCustomerId(record: SiteCalibration): string {
  const source = record.sourceCustomerId?.trim() || '';
  if (source && source !== record.rcId) return source;
  const customerId = record.customerId?.trim() || '';
  if (customerId && customerId !== record.rcId) return customerId;
  return '';
}

export async function rewriteOutOfKeralaJobsToRcName(input: {
  records: SiteCalibration[];
  customersById: Map<string, { pincode?: string; state?: string }>;
  rcNameByUid: Map<string, string>;
}): Promise<number> {
  const now = new Date().toISOString();
  const writes: Promise<void>[] = [];
  const patchedCustomers = new Set<string>();

  for (const record of input.records) {
    const status = normalizeVerificationStatus(record);
    if (status !== 'submitted' && status !== 'approved') continue;
    if (record.certificatePdfUrl?.trim() || record.certificateNumber?.trim()) continue;

    const customer = record.customerId ? input.customersById.get(record.customerId) : undefined;
    const rcName = rcCentreName(record, input.rcNameByUid);
    const serial = record.serialNumber?.trim().toUpperCase() || '';
    const forceSerial = FORCE_RC_FILING_SERIALS.has(serial);
    const sourceId = sourceCustomerId(record);

    if (forceSerial && sourceId && !patchedCustomers.has(sourceId)) {
      const source = input.customersById.get(sourceId);
      if (source && !isKeralaState(source.state)) {
        patchedCustomers.add(sourceId);
        writes.push(
          updateDoc(doc(db, 'customers', sourceId), {
            state: KERALA_STATE,
            updatedAt: now,
          }),
        );
      }
    }

    if (!rcName || !record.rcId) continue;

    const patch = forceSerial
      ? {
          fileCertificateAsRc: true as const,
          verificationSubject: 'self' as const,
          customerId: record.rcId,
          customerName: rcName,
          ...(sourceId ? { sourceCustomerId: sourceId } : {}),
          ...(record.customerName?.trim() && record.customerName.trim() !== rcName
            ? { sourceCustomerName: record.customerName.trim() }
            : {}),
        }
      : rcFilingPartyPatch({
          verificationSubject: inferVerificationSubject(record),
          customerId: record.customerId,
          customerName: record.customerName,
          pincode: customer?.pincode,
          state: customer?.state,
          rcUid: record.rcId,
          rcCompanyName: rcName,
        });

    if (!patch.customerName || !patch.verificationSubject) continue;
    if (
      record.fileCertificateAsRc
      && inferVerificationSubject(record) === 'self'
      && record.customerName?.trim() === patch.customerName
    ) {
      continue;
    }

    writes.push(
      updateDoc(doc(db, 'siteCalibrations', record.id), {
        ...patch,
        updatedAt: now,
        pipelineFailedPhase: deleteField(),
        pipelineFailureMessage: deleteField(),
        pipelineFailedAt: deleteField(),
        certificationLastError: deleteField(),
      }),
    );
  }

  await Promise.all(writes);
  return writes.length;
}
