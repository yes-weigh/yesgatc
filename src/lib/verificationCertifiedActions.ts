import { buildDocaCertificateViewUrl } from './docaCertificateUrl';
import { canShowVerificationWalletReceipt } from './verificationReceipt';
import { canDownloadVerificationCertificate } from './verificationRequest';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

export type VerificationCertifiedActionId =
  | 'certificate'
  | 'label'
  | 'test-report'
  | 'receipt'
  | 'gst-bill';

export type VerificationCertifiedAction =
  | {
      id: 'certificate';
      label: string;
      kind: 'link';
      href: string;
    }
  | {
      id: 'label';
      label: string;
      kind: 'label-modal';
    }
  | {
      id: 'test-report';
      label: string;
      kind: 'test-report-modal';
    }
  | {
      id: 'gst-bill';
      label: string;
      kind: 'gst-bill-modal';
    }
  | {
      id: 'receipt';
      label: string;
      kind: 'receipt-modal';
    };

/** Fixed toolbar order — matches product mockup. */
export const VERIFICATION_CERTIFIED_ACTION_ORDER: VerificationCertifiedActionId[] = [
  'certificate',
  'test-report',
  'label',
  'receipt',
  'gst-bill',
];

/** URL for certificate preview / download — stored Firebase PDF preferred, else public certificate view URL. */
export function resolveCertificatePreviewUrl(record: SiteCalibration): string | null {
  const certificateNumber = record.certificateNumber?.trim() ?? '';
  const docaUrl = buildDocaCertificateViewUrl(certificateNumber);
  if (canDownloadVerificationCertificate(record) && record.certificatePdfUrl?.trim()) {
    return record.certificatePdfUrl.trim();
  }
  return docaUrl;
}

export function buildVerificationCertifiedActions(
  record: SiteCalibration,
  rc?: Pick<FirestoreUserDoc, 'certificationMethod'> | null,
): VerificationCertifiedAction[] {
  const certificateHref = resolveCertificatePreviewUrl(record);

  const byId = new Map<VerificationCertifiedActionId, VerificationCertifiedAction>();

  if (certificateHref) {
    byId.set('certificate', {
      id: 'certificate',
      label: 'Certificate',
      kind: 'link',
      href: certificateHref,
    });
  }

  byId.set('test-report', {
    id: 'test-report',
    label: 'Test Report',
    kind: 'test-report-modal',
  });

  byId.set('label', {
    id: 'label',
    label: 'Label',
    kind: 'label-modal',
  });

  if (record.verificationType === 'RV') {
    byId.set('gst-bill', {
      id: 'gst-bill',
      label: 'GST bill',
      kind: 'gst-bill-modal',
    });

    if (canShowVerificationWalletReceipt(record, rc ?? null)) {
      byId.set('receipt', {
        id: 'receipt',
        label: 'Receipt',
        kind: 'receipt-modal',
      });
    }
  }

  return VERIFICATION_CERTIFIED_ACTION_ORDER.map(id => byId.get(id)).filter(
    (action): action is VerificationCertifiedAction => action !== undefined,
  );
}
