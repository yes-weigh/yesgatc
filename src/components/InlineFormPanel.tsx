import React from 'react';

type InlineFormPanelProps = {
  id?: string;
  className?: string;
  children: React.ReactNode;
  /** Skip glass/fade-in — used for full-bleed mobile verification wizard. */
  plain?: boolean;
};

/** Glass-styled form shell shown above a table instead of a modal overlay. */
export const InlineFormPanel: React.FC<InlineFormPanelProps> = ({
  id,
  className,
  children,
  plain = false,
}) => (
  <div
    id={id}
    className={[
      'inline-form-panel',
      plain ? 'inline-form-panel--plain' : 'glass fade-in',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </div>
);
