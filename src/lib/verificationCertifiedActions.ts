import { buildDocaCertificateViewUrl } from './docaCertificateUrl';
import { canShowVerificationWalletReceipt } from './verificationReceipt';
import { canDownloadVerificationCertificate } from './verificationRequest';
import type { SiteCalibration } from '../types';

export type VerificationCertifiedActionId =
  | 'certificate'
  | 'label'
  | 'test-report'
  | 'receipt'
  | 'gst-bill';

export type VerificationCertifiedPrintPlaceholderId = 'test-report';

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
      id: 'gst-bill';
      label: string;
      kind: 'gst-bill-modal';
    }
  | {
      id: 'receipt';
      label: string;
      kind: 'receipt-modal';
    }
  | {
      id: VerificationCertifiedPrintPlaceholderId;
      label: string;
      kind: 'print-placeholder';
    };

const PRINT_PLACEHOLDER_ACTIONS: VerificationCertifiedAction[] = [
  { id: 'test-report', label: 'Test report', kind: 'print-placeholder' },
];

/** Fixed toolbar order — matches product mockup. */
export const VERIFICATION_CERTIFIED_ACTION_ORDER: VerificationCertifiedActionId[] = [
  'certificate',
  'label',
  'test-report',
  'receipt',
  'gst-bill',
];

/** URL for certificate preview / download — stored PDF preferred, else public DOCA page. */
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

    if (canShowVerificationWalletReceipt(record)) {
      byId.set('receipt', {
        id: 'receipt',
        label: 'Receipt',
        kind: 'receipt-modal',
      });
    }
  }

  for (const placeholder of PRINT_PLACEHOLDER_ACTIONS) {
    byId.set(placeholder.id, placeholder);
  }

  return VERIFICATION_CERTIFIED_ACTION_ORDER.map(id => byId.get(id)).filter(
    (action): action is VerificationCertifiedAction => action !== undefined,
  );
}
