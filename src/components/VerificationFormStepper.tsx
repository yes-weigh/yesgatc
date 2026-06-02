import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import type { VerificationFormStepDef, VerificationFormStepId } from '../lib/verificationFormSteps';

type VerificationFormStepperProps = {
  steps: VerificationFormStepDef[];
  activeStep: number;
  furthestStep: number;
  completedStepIds?: Set<VerificationFormStepId>;
  onStepSelect: (index: number) => void;
  readOnly?: boolean;
};

export const VerificationFormStepper: React.FC<VerificationFormStepperProps> = ({
  steps,
  activeStep,
  furthestStep,
  completedStepIds,
  onStepSelect,
  readOnly = false,
}) => {
  const listRef = useRef<HTMLOListElement>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    const node = itemRefs.current[activeStep];
    if (!node || !listRef.current) return;
    node.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [activeStep]);

  return (
    <div className="verification-wizard-stepper-wrap">
      <nav className="verification-wizard-stepper" aria-label="Verification form steps">
        <ol ref={listRef} className="verification-wizard-stepper-list">
          {steps.map((step, index) => {
            const isActive = index === activeStep;
            const isComplete = readOnly
              ? !isActive && Boolean(completedStepIds?.has(step.id))
              : !isActive && index < activeStep;
            const isUpcoming = !isActive && !isComplete;
            const lineFilled = index < activeStep;
            const canSelect = readOnly || index <= furthestStep;

            return (
              <li
                key={step.id}
                ref={el => {
                  itemRefs.current[index] = el;
                }}
                className={[
                  'verification-wizard-stepper-item',
                  isActive ? 'verification-wizard-stepper-item--active' : '',
                  isComplete ? 'verification-wizard-stepper-item--complete' : '',
                  isUpcoming ? 'verification-wizard-stepper-item--upcoming' : '',
                  lineFilled ? 'verification-wizard-stepper-item--line-filled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className="verification-wizard-stepper-btn"
                  onClick={() => canSelect && onStepSelect(index)}
                  disabled={!canSelect}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={`${step.label}${isComplete ? ', completed' : isActive ? ', current' : ''}`}
                >
                  <span className="verification-wizard-stepper-marker" aria-hidden>
                    {isComplete ? (
                      <Check size={16} strokeWidth={2.5} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="verification-wizard-stepper-label">{step.shortLabel}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
};
