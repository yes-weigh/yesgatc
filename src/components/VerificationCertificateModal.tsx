import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useHistoryOverlay } from '../hooks/useHistoryOverlay';
import { isVerificationCertificateVoided } from '../lib/verificationCertificateVoid';
import { resolveCertificatePreviewUrl } from '../lib/verificationCertifiedActions';
import {
  canShareVerificationCertificatePdf,
  formatCertificateShareError,
  shareVerificationCertificateOnWhatsApp,
} from '../lib/verificationCertificateShare';
import { VerificationVoidWatermark } from './VerificationVoidWatermark';
import type { Customer, SiteCalibration } from '../types';

type VerificationCertificateModalProps = {
  open: boolean;
  record: SiteCalibration;
  onClose: () => void;
};

export const VerificationCertificateModal: React.FC<VerificationCertificateModalProps> = ({
  open,
  record,
  onClose,
}) => {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  useHistoryOverlay(open, onClose);

  useEffect(() => {
    if (!open) return;

    const customerId = record.customerId?.trim();
    let cancelled = false;

    void (async () => {
      try {
        const customerSnap = customerId ? await getDoc(doc(db, 'customers', customerId)) : null;
        if (cancelled) return;
        setCustomer(customerSnap?.exists() ? ({ id: customerSnap.id, ...customerSnap.data() } as Customer) : null);
      } catch {
        if (!cancelled) setCustomer(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, record.customerId]);

  const previewUrl = useMemo(() => resolveCertificatePreviewUrl(record), [record]);
  const pdfShareAvailable = canShareVerificationCertificatePdf(record);
  const isVoided = isVerificationCertificateVoided(record);

  const handleWhatsAppShare = async () => {
    if (sharing || !pdfShareAvailable) return;

    setSharing(true);
    setShareMessage(null);
    setShareError(null);

    try {
      const result = await shareVerificationCertificateOnWhatsApp({
        record,
        phone: customer?.phone,
      });
      setShareMessage(
        result === 'shared'
          ? 'Certificate PDF shared.'
          : 'Certificate PDF downloaded. Attach it in the WhatsApp chat that opened.',
      );
    } catch (error) {
      setShareError(formatCertificateShareError(error));
    } finally {
      setSharing(false);
    }
  };

  if (!open || !previewUrl) return null;

  const isPdfPreview =
    /\.pdf(\?|$)/i.test(previewUrl) || previewUrl.includes('firebasestorage');

  return createPortal(
    <div
      className="modal-overlay verification-certificate-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="verification-certificate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-certificate-title"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="verification-certificate-close"
          onClick={onClose}
          aria-label="Close certificate preview"
        >
          <X size={18} aria-hidden />
        </button>

        <div className="verification-certificate-scroll">
          <div
            className={`verification-certificate-frame${isVoided ? ' verification-certificate-frame--voided' : ''}`}
          >
            {isPdfPreview ? (
              <iframe
                src={previewUrl}
                title={`Certificate for ${record.serialNumber || 'verification'}`}
                className="verification-certificate-iframe"
              />
            ) : (
              <iframe
                src={previewUrl}
                title={`Certificate for ${record.serialNumber || 'verification'}`}
                className="verification-certificate-iframe"
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            )}
            {isVoided && <VerificationVoidWatermark variant="certificate" />}
          </div>
        </div>

        <div className="verification-certificate-toolbar">
          <div className="verification-certificate-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm verification-gst-bill-whatsapp-btn"
              onClick={() => void handleWhatsAppShare()}
              disabled={sharing || !pdfShareAvailable}
              aria-label={
                sharing
                  ? 'Sharing certificate PDF'
                  : pdfShareAvailable
                    ? 'Share certificate PDF on WhatsApp'
                    : 'Certificate PDF not available for WhatsApp share'
              }
              title={
                pdfShareAvailable
                  ? 'Share certificate PDF on WhatsApp'
                  : 'Signed PDF is not stored yet'
              }
            >
              <MessageCircle size={18} aria-hidden />
            </button>
          </div>

          {shareMessage && (
            <p className="verification-gst-bill-print-status text-sm mb-0" role="status">
              {shareMessage}
            </p>
          )}

          {shareError && (
            <p className="verification-gst-bill-print-error text-sm mb-0" role="alert">
              {shareError}
            </p>
          )}

          {!pdfShareAvailable && (
            <p className="verification-gst-bill-hint text-muted text-sm mb-0" role="status">
              WhatsApp share needs the signed PDF stored in Firebase. Preview shows the DOCA page until then.
            </p>
          )}
        </div>

        <h2 id="verification-certificate-title" className="sr-only">
          Certificate for {record.serialNumber || 'device'}
        </h2>
      </div>
    </div>,
    document.body,
  );
};
