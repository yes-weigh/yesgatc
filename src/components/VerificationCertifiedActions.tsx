import React, { useState } from 'react';
import { Award, BadgeCheck, BarChart3, Receipt, ScrollText, Tag } from 'lucide-react';
import { useMobileViewport } from '../hooks/useMobileViewport';
import {
  buildVerificationCertifiedActions,
  type VerificationCertifiedAction,
  type VerificationCertifiedActionId,
} from '../lib/verificationCertifiedActions';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import {
  canShowSignedCertificatePdf,
  certificateRequiresSignedUpload,
  resolveSignedCertificatePdfOnlyPath,
  resolveSignedCertificatePdfOnlyUrl,
  resolveUnsignedCertificatePdfStoragePath,
  resolveUnsignedCertificatePdfUrl,
  signedCertificateAvailability,
} from '../lib/signedCertificatePdf';
import { CertificatePdfShareViewer } from './CertificatePdfShareViewer';
import { SignedCertificateAvailabilityBadge } from './SignedCertificateAvailabilityBadge';
import { VerificationGstBillModal } from './VerificationGstBillModal';
import { VerificationLabelModal } from './VerificationLabelModal';
import { VerificationReceiptModal } from './VerificationReceiptModal';
import { VerificationTestReportModal } from './VerificationTestReportModal';
import type { SiteCalibration } from '../types';

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

function ActionTileContent({ action }: { action: VerificationCertifiedAction }) {
  return (
    <>
      <span className="verification-certified-action-icon" aria-hidden>
        {actionIcon(action.id)}
      </span>
      <span className="verification-certified-action-label">{action.label}</span>
    </>
  );
}

function CertifiedActionTile({
  action,
  isPhone,
  onCertificateOpen,
  onLabelOpen,
  onTestReportOpen,
  onGstBillOpen,
  onReceiptOpen,
}: {
  action: VerificationCertifiedAction;
  isPhone: boolean;
  onCertificateOpen: () => void;
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
        <ActionTileContent action={action} />
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
        <ActionTileContent action={action} />
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
        <ActionTileContent action={action} />
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
        <ActionTileContent action={action} />
      </button>
    );
  }

  if (isPhone) {
    return (
      <button
        type="button"
        className={className}
        onClick={onCertificateOpen}
        aria-label="View certificate"
      >
        <ActionTileContent action={action} />
      </button>
    );
  }

  return (
    <a
      href={action.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      <ActionTileContent action={action} />
    </a>
  );
}

function SignedCertificateTile({
  record,
  isPhone,
  onOpen,
}: {
  record: SiteCalibration;
  isPhone: boolean;
  onOpen: () => void;
}) {
  const signedUrl = resolveSignedCertificatePdfOnlyUrl(record);
  const hasSigned = canShowSignedCertificatePdf(record);
  const waitingEmaap = signedCertificateAvailability(record) === 'missing';
  if (!hasSigned && !waitingEmaap && !certificateRequiresSignedUpload(record)) return null;

  const className =
    'verification-certified-action verification-certified-action--signed-certificate';
  const label = hasSigned ? 'Signed PDF' : 'No signed PDF';

  const content = (
    <>
      <span className="verification-certified-action-icon" aria-hidden>
        <BadgeCheck size={22} strokeWidth={1.75} />
      </span>
      <span className="verification-certified-action-label">{label}</span>
    </>
  );

  if (!hasSigned) {
    return (
      <button
        type="button"
        className={`${className} verification-certified-action--placeholder`}
        disabled
        title="Signed PDF is not on eMAAP yet."
        aria-label="Signed PDF not available"
      >
        {content}
      </button>
    );
  }

  if (isPhone) {
    return (
      <button
        type="button"
        className={className}
        onClick={onOpen}
        aria-label="View signed certificate"
      >
        {content}
      </button>
    );
  }

  if (signedUrl) {
    return (
      <a
        href={signedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {content}
      </a>
    );
  }

  return (
    <button type="button" className={className} onClick={onOpen} aria-label="View signed certificate">
      {content}
    </button>
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
  const [pdfKind, setPdfKind] = useState<'original' | 'signed' | null>(null);

  if (!canShowVerificationCertifiedActions(record)) return null;

  const actions = buildVerificationCertifiedActions(record);
  if (!actions.length) return null;

  const pdfOpen = pdfKind !== null;
  const pdfUrl =
    pdfKind === 'signed'
      ? resolveSignedCertificatePdfOnlyUrl(record)
      : resolveUnsignedCertificatePdfUrl(record);
  const pdfPath =
    pdfKind === 'signed'
      ? resolveSignedCertificatePdfOnlyPath(record)
      : resolveUnsignedCertificatePdfStoragePath(record);

  return (
    <>
      <SignedCertificateAvailabilityBadge
        record={record}
        className="signed-cert-avail--toolbar"
      />
      <div
        className={`verification-certified-actions${className ? ` ${className}` : ''}`}
        role="toolbar"
        aria-label="Verification documents and printing"
      >
        {actions.flatMap(action => {
          const tile = (
            <CertifiedActionTile
              key={action.id}
              action={action}
              isPhone={isPhone}
              onCertificateOpen={() => setPdfKind('original')}
              onLabelOpen={() => setLabelOpen(true)}
              onTestReportOpen={() => setTestReportOpen(true)}
              onGstBillOpen={() => setGstBillOpen(true)}
              onReceiptOpen={() => setReceiptOpen(true)}
            />
          );
          if (action.id !== 'certificate') return [tile];
          return [
            tile,
            <SignedCertificateTile
              key="signed-certificate"
              record={record}
              isPhone={isPhone}
              onOpen={() => setPdfKind('signed')}
            />,
          ];
        })}
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
        open={pdfOpen}
        record={record}
        url={pdfUrl}
        storagePath={pdfPath}
        heading={pdfKind === 'signed' ? 'Signed certificate' : undefined}
        onClose={() => setPdfKind(null)}
      />
    </>
  );
};
