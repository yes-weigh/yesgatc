import React, { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, Receipt, ScrollText, Tag } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useMobileViewport } from '../hooks/useMobileViewport';
import {
  buildVerificationCertifiedActions,
  type VerificationCertifiedAction,
  type VerificationCertifiedActionId,
} from '../lib/verificationCertifiedActions';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import {
  canShowSignedCertificatePdf,
  certificateSignStatus,
  resolveSignedCertificatePdfOnlyPath,
  resolveSignedCertificatePdfOnlyUrl,
  resolveUnsignedCertificatePdfStoragePath,
  resolveUnsignedCertificatePdfUrl,
} from '../lib/signedCertificatePdf';
import { prefetchPdfJs } from '../lib/pdfJs';
import { CertificatePdfShareViewer } from './CertificatePdfShareViewer';
import { UnsignedCertificateDownloadWarn } from './RcUnsignedPdfDisturbHost';
import { VerificationGstBillModal } from './VerificationGstBillModal';
import { VerificationLabelModal } from './VerificationLabelModal';
import { VerificationReceiptModal } from './VerificationReceiptModal';
import { VerificationTestReportModal } from './VerificationTestReportModal';
import type { FirestoreUserDoc, SiteCalibration } from '../types';

type VerificationCertifiedActionsProps = {
  record: SiteCalibration;
  className?: string;
};

function actionIcon(id: VerificationCertifiedActionId) {
  switch (id) {
    case 'certificate':
      return <Award size={22} strokeWidth={1.75} aria-hidden />;
    case 'label':
      return <Tag size={22} strokeWidth={1.75} aria-hidden />;
    case 'test-report':
      return <BarChart3 size={22} strokeWidth={1.75} aria-hidden />;
    case 'receipt':
      return <Receipt size={22} strokeWidth={1.75} aria-hidden />;
    case 'gst-bill':
      return <ScrollText size={22} strokeWidth={1.75} aria-hidden />;
  }
}

function CertificateSignTag({ record }: { record: SiteCalibration }) {
  const status = certificateSignStatus(record);
  if (status === 'voided') return null;
  const signed = status === 'signed';
  return (
    <span
      className={`verification-certified-action-tag${
        signed
          ? ' verification-certified-action-tag--signed'
          : ' verification-certified-action-tag--unsigned'
      }`}
    >
      {signed ? 'Signed' : 'Not signed'}
    </span>
  );
}

function ActionTileContent({
  action,
  record,
}: {
  action: VerificationCertifiedAction;
  record: SiteCalibration;
}) {
  return (
    <>
      <span className="verification-certified-action-icon" aria-hidden>
        {actionIcon(action.id)}
      </span>
      <span className="verification-certified-action-label">{action.label}</span>
      {action.id === 'certificate' ? <CertificateSignTag record={record} /> : null}
    </>
  );
}

function CertifiedActionTile({
  action,
  record,
  isPhone,
  onCertificateOpen,
  onLabelOpen,
  onTestReportOpen,
  onGstBillOpen,
  onReceiptOpen,
}: {
  action: VerificationCertifiedAction;
  record: SiteCalibration;
  isPhone: boolean;
  onCertificateOpen: (event?: React.MouseEvent) => void;
  onLabelOpen: () => void;
  onTestReportOpen: () => void;
  onGstBillOpen: () => void;
  onReceiptOpen: () => void;
}) {
  const className = `verification-certified-action verification-certified-action--${action.id}`;

  if (action.kind === 'label-modal') {
    return (
      <button
        type="button"
        className={className}
        onClick={onLabelOpen}
        aria-label="View verification label"
      >
        <ActionTileContent action={action} record={record} />
      </button>
    );
  }

  if (action.kind === 'test-report-modal') {
    return (
      <button
        type="button"
        className={className}
        onClick={onTestReportOpen}
        aria-label="View test report"
      >
        <ActionTileContent action={action} record={record} />
      </button>
    );
  }

  if (action.kind === 'gst-bill-modal') {
    return (
      <button
        type="button"
        className={className}
        onClick={onGstBillOpen}
        aria-label="View GST bill"
      >
        <ActionTileContent action={action} record={record} />
      </button>
    );
  }

  if (action.kind === 'receipt-modal') {
    return (
      <button
        type="button"
        className={className}
        onClick={onReceiptOpen}
        aria-label="View wallet receipt"
      >
        <ActionTileContent action={action} record={record} />
      </button>
    );
  }

  const signed = canShowSignedCertificatePdf(record);
  const href =
    (signed ? resolveSignedCertificatePdfOnlyUrl(record) : null) || action.href;
  const signStatus = certificateSignStatus(record);
  const ariaLabel =
    signStatus === 'signed'
      ? 'View signed certificate'
      : signStatus === 'not_signed'
        ? 'View certificate — not signed'
        : 'View certificate';

  if (isPhone) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onCertificateOpen()}
        aria-label={ariaLabel}
      >
        <ActionTileContent action={action} record={record} />
      </button>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={ariaLabel}
      onClick={event => {
        if (signStatus === 'not_signed') {
          event.preventDefault();
          onCertificateOpen(event);
        }
      }}
    >
      <ActionTileContent action={action} record={record} />
    </a>
  );
}

export const VerificationCertifiedActions: React.FC<VerificationCertifiedActionsProps> = ({
  record,
  className = '',
}) => {
  const isPhone = useMobileViewport();
  const [labelOpen, setLabelOpen] = useState(false);
  const [testReportOpen, setTestReportOpen] = useState(false);
  const [gstBillOpen, setGstBillOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [downloadWarnOpen, setDownloadWarnOpen] = useState(false);
  const [rcProfile, setRcProfile] = useState<FirestoreUserDoc | null>(null);

  useEffect(() => {
    prefetchPdfJs();
  }, []);

  useEffect(() => {
    const rcId = record.rcId?.trim();
    if (!rcId) {
      setRcProfile(null);
      return;
    }
    return onSnapshot(
      doc(db, 'users', rcId),
      snap => setRcProfile(snap.exists() ? (snap.data() as FirestoreUserDoc) : null),
      () => setRcProfile(null),
    );
  }, [record.rcId]);

  const actions = useMemo(
    () => buildVerificationCertifiedActions(record, rcProfile),
    [record, rcProfile],
  );

  if (!canShowVerificationCertifiedActions(record)) return null;
  if (!actions.length) return null;

  const signed = canShowSignedCertificatePdf(record);
  const pdfUrl = signed
    ? resolveSignedCertificatePdfOnlyUrl(record)
    : resolveUnsignedCertificatePdfUrl(record);
  const pdfPath = signed
    ? resolveSignedCertificatePdfOnlyPath(record)
    : resolveUnsignedCertificatePdfStoragePath(record);

  const openCertificate = () => {
    if (isPhone) {
      setCertificateOpen(true);
      return;
    }
    const href =
      (signed ? resolveSignedCertificatePdfOnlyUrl(record) : null)
      || resolveUnsignedCertificatePdfUrl(record)
      || actions.find(item => item.id === 'certificate' && item.kind === 'link')?.href
      || null;
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  };

  const requestCertificateOpen = () => {
    if (certificateSignStatus(record) === 'not_signed') {
      setDownloadWarnOpen(true);
      return;
    }
    openCertificate();
  };

  const continueAfterWarn = () => {
    setDownloadWarnOpen(false);
    openCertificate();
  };

  return (
    <>
      <div
        className={`verification-certified-actions${className ? ` ${className}` : ''}`}
        role="toolbar"
        aria-label="Verification documents and printing"
      >
        {actions.map(action => (
          <CertifiedActionTile
            key={action.id}
            action={action}
            record={record}
            isPhone={isPhone}
            onCertificateOpen={requestCertificateOpen}
            onLabelOpen={() => setLabelOpen(true)}
            onTestReportOpen={() => setTestReportOpen(true)}
            onGstBillOpen={() => setGstBillOpen(true)}
            onReceiptOpen={() => setReceiptOpen(true)}
          />
        ))}
      </div>

      <VerificationLabelModal
        open={labelOpen}
        record={record}
        onClose={() => setLabelOpen(false)}
      />

      <VerificationTestReportModal
        open={testReportOpen}
        record={record}
        onClose={() => setTestReportOpen(false)}
      />

      <VerificationGstBillModal
        open={gstBillOpen}
        record={record}
        onClose={() => setGstBillOpen(false)}
      />

      <VerificationReceiptModal
        open={receiptOpen}
        record={record}
        onClose={() => setReceiptOpen(false)}
      />

      <CertificatePdfShareViewer
        open={certificateOpen}
        record={record}
        url={pdfUrl}
        storagePath={pdfPath}
        heading={signed ? 'Signed certificate' : undefined}
        warnUnsignedDownload
        onClose={() => setCertificateOpen(false)}
      />

      <UnsignedCertificateDownloadWarn
        open={downloadWarnOpen}
        onContinue={continueAfterWarn}
        onCancel={() => setDownloadWarnOpen(false)}
      />
    </>
  );
};
