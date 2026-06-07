import React, { useState } from 'react';
import { Award, BarChart3, Receipt, ScrollText, Tag } from 'lucide-react';
import {
  buildVerificationCertifiedActions,
  type VerificationCertifiedAction,
  type VerificationCertifiedActionId,
} from '../lib/verificationCertifiedActions';
import { canShowVerificationCertifiedActions } from '../lib/verificationRequest';
import { VerificationLabelModal } from './VerificationLabelModal';
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
}: {
  action: VerificationCertifiedAction;
  onLabelOpen: () => void;
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

export const VerificationCertifiedActions: React.FC<VerificationCertifiedActionsProps> = ({
  record,
  className = '',
}) => {
  const [labelOpen, setLabelOpen] = useState(false);

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
            onLabelOpen={() => setLabelOpen(true)}
          />
        ))}
      </div>

      <VerificationLabelModal
        open={labelOpen}
        record={record}
        onClose={() => setLabelOpen(false)}
      />
    </>
  );
};
