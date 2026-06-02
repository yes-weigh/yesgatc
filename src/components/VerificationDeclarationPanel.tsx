import React from 'react';
import { UserRound } from 'lucide-react';

export const VERIFICATION_DECLARATION_TEXT =
  'I hereby declare that the above information is true and correct to the best of my knowledge.';

type VerificationDeclarationPanelProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export const VerificationDeclarationPanel: React.FC<VerificationDeclarationPanelProps> = ({
  checked,
  onChange,
  disabled = false,
}) => (
  <section className="verification-declaration" aria-labelledby="verification-declaration-title">
    <header className="verification-declaration-head">
      <span className="verification-declaration-head-icon" aria-hidden>
        <UserRound size={18} />
      </span>
      <h3 id="verification-declaration-title" className="verification-declaration-title">
        Declaration
      </h3>
    </header>

    <label className="verification-declaration-label">
      <input
        type="checkbox"
        className="verification-declaration-checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="verification-declaration-text">{VERIFICATION_DECLARATION_TEXT}</span>
    </label>
  </section>
);
