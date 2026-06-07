import React, { useState } from 'react';
import { Award, BarChart3, Receipt, ScrollText, Tag } from 'lucide-react';
import {
  buildVerificationCertifiedActions,
  type VerificationCertifiedAction,
  type VerificationCertifiedActionId,
} from '../lib/verificationCertifiedActions';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import { VerificationCertificateModal } from './VerificationCertificateModal';
import { VerificationGstBillModal } from './VerificationGstBillModal';
import { VerificationLabelModal } from './VerificationLabelModal';
import { VerificationReceiptModal } from './VerificationReceiptModal';
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
  onLabelOpen,
  onGstBillOpen,
  onReceiptOpen,
  onCertificateOpen,
}: {
  action: VerificationCertifiedAction;
  onLabelOpen: () => void;
  onGstBillOpen: () => void;
  onReceiptOpen: () => void;
  onCertificateOpen: () => void;
}) {
  const className = `verification-certified-action verification-certified-action--${action.id}`;

  if (action.kind === 'certificate-modal') {
    return (
      <button
        type="button"
        className={className}
        onClick={onCertificateOpen}
        aria-label="View verification certificate"
      >
        <ActionTileContent action={action} />
      </button>
    );
  }

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

  if (action.kind === 'print-placeholder') {
    return (
      <button
        type="button"
        className={`${className} verification-certified-action--placeholder`}
        disabled
        title="Printer printing — coming soon"
        aria-label={`${action.label} — printer printing coming soon`}
      >
        <ActionTileContent action={action} />
      </button>
    );
  }

  return null;
}

export const VerificationCertifiedActions: React.FC<VerificationCertifiedActionsProps> = ({
  record,
  className = '',
}) => {
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [gstBillOpen, setGstBillOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  if (!canShowVerificationCertifiedActions(record)) return null;

  const actions = buildVerificationCertifiedActions(record);
  if (!actions.length) return null;

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
            onCertificateOpen={() => setCertificateOpen(true)}
            onLabelOpen={() => setLabelOpen(true)}
            onGstBillOpen={() => setGstBillOpen(true)}
            onReceiptOpen={() => setReceiptOpen(true)}
          />
        ))}
      </div>

      <VerificationCertificateModal
        open={certificateOpen}
        record={record}
        onClose={() => setCertificateOpen(false)}
      />

      <VerificationLabelModal
        open={labelOpen}
        record={record}
        onClose={() => setLabelOpen(false)}
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
    </>
  );
};
