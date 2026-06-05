import { buildDocaCertificateViewUrl } from './docaCertificateUrl';
import { canDownloadVerificationCertificate } from './verificationRequest';
import type { SiteCalibration } from '../types';

export type VerificationCertifiedActionId =
  | 'certificate'
  | 'label'
  | 'test-report'
  | 'receipt'
  | 'gst-bill';

export type VerificationCertifiedPrintPlaceholderId =
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
      id: VerificationCertifiedPrintPlaceholderId;
      label: string;
      kind: 'print-placeholder';
    };

const PRINT_PLACEHOLDER_ACTIONS: VerificationCertifiedAction[] = [
  { id: 'label', label: 'Label', kind: 'print-placeholder' },
  { id: 'test-report', label: 'Test report', kind: 'print-placeholder' },
  { id: 'receipt', label: 'Receipt', kind: 'print-placeholder' },
  { id: 'gst-bill', label: 'GST bill', kind: 'print-placeholder' },
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

  for (const placeholder of PRINT_PLACEHOLDER_ACTIONS) {
    byId.set(placeholder.id, placeholder);
  }

  return VERIFICATION_CERTIFIED_ACTION_ORDER.map(id => byId.get(id)).filter(
    (action): action is VerificationCertifiedAction => action !== undefined,
  );
}
