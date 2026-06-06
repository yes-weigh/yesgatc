import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import { buildVerificationSubmitPatch } from './verificationRequest';
import { queueRvZohoInvoicesAfterSubmit } from './zohoRvInvoice';
import type { JobType } from '../types';

export type VerificationSubmitTarget = {
  id: string;
  verificationType?: JobType | '';
};

/**
 * Submit one or more draft verifications (RC Admin, VCT, or Super Admin flows).
 * RV records also queue a Zoho Books invoice via Cloud Function (backup to Firestore trigger).
 */
export async function submitVerificationRecords(
  targets: VerificationSubmitTarget[],
  firestore: Firestore = db,
): Promise<void> {
  if (targets.length === 0) return;

  const patch = buildVerificationSubmitPatch();
  await Promise.all(
    targets.map(target => updateDoc(doc(firestore, 'siteCalibrations', target.id), patch)),
  );

  queueRvZohoInvoicesAfterSubmit(
    targets.filter(target => target.verificationType === 'RV').map(target => target.id),
  );
}

export async function submitVerificationRecord(
  target: VerificationSubmitTarget,
  firestore: Firestore = db,
): Promise<void> {
  return submitVerificationRecords([target], firestore);
}
