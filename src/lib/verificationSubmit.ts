import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { buildVerificationSubmitPatch } from './verificationRequest';
import { queueRvZohoInvoicesAfterSubmit, submitRvWithZohoGate } from './zohoRvInvoice';
import type { JobType } from '../types';

export type VerificationSubmitTarget = {
  id: string;
  verificationType?: JobType | '';
};

export type VerificationSubmitOptions = {
  /** When true, RV records use submitRvWithZohoGate instead of direct Firestore submit. */
  zohoRvInvoicingEnabled?: boolean;
};

/**
 * Submit one or more draft verifications (RC Admin, VCT, or Super Admin flows).
 * When Zoho RV invoicing is enabled, RV records are invoiced in Zoho while still draft,
 * then marked submitted; OV records submit immediately as before.
 */
export async function submitVerificationRecords(
  targets: VerificationSubmitTarget[],
  firestore: Firestore = db,
  options?: VerificationSubmitOptions,
): Promise<void> {
  if (targets.length === 0) return;

  const patch = buildVerificationSubmitPatch();
  const rvTargets = targets.filter(target => target.verificationType === 'RV');
  const nonRvTargets = targets.filter(target => target.verificationType !== 'RV');

  const submitNonRv = nonRvTargets.map(target =>
    updateDoc(doc(firestore, 'siteCalibrations', target.id), patch),
  );

  if (options?.zohoRvInvoicingEnabled && rvTargets.length > 0) {
    await Promise.all(submitNonRv);
    await submitRvWithZohoGate({ recordIds: rvTargets.map(target => target.id) });
    return;
  }

  await Promise.all([
    ...submitNonRv,
    ...rvTargets.map(target => updateDoc(doc(firestore, 'siteCalibrations', target.id), patch)),
  ]);

  queueRvZohoInvoicesAfterSubmit(rvTargets.map(target => target.id));
}

export async function submitVerificationRecord(
  target: VerificationSubmitTarget,
  firestore: Firestore = db,
  options?: VerificationSubmitOptions,
): Promise<void> {
  return submitVerificationRecords([target], firestore, options);
}
