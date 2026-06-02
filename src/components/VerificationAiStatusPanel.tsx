import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { VerificationAiStatusItem } from '../lib/verificationAiStatus';

type VerificationAiStatusPanelProps = {
  items: VerificationAiStatusItem[];
};

function AiShieldIcon() {
  return (
    <span className="verification-ai-status-shield" aria-hidden>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M16 28.5S26.5 24.5 26.5 16V7.5L16 4 5.5 7.5V16C5.5 24.5 16 28.5 16 28.5Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="verification-ai-status-shield-label">AI</span>
    </span>
  );
}

export const VerificationAiStatusPanel: React.FC<VerificationAiStatusPanelProps> = ({ items }) => (
  <section className="verification-ai-status" aria-labelledby="verification-ai-status-title">
    <header className="verification-ai-status-head">
      <AiShieldIcon />
      <h3 id="verification-ai-status-title" className="verification-ai-status-title">
        AI Verification Status
      </h3>
    </header>

    <ul className="verification-ai-status-list">
      {items.map(item => (
        <li
          key={item.id}
          className={`verification-ai-status-row${
            item.success ? ' verification-ai-status-row--success' : ''
          }`}
        >
          <CheckCircle2
            size={18}
            className="verification-ai-status-row-icon"
            aria-hidden
          />
          <span className="verification-ai-status-row-label">{item.label}</span>
          <span className="verification-ai-status-row-value">{item.statusLabel}</span>
        </li>
      ))}
    </ul>
  </section>
);
