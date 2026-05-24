import React from 'react';

type InlineFormPanelProps = {
  id?: string;
  className?: string;
  children: React.ReactNode;
};

/** Glass-styled form shell shown above a table instead of a modal overlay. */
export const InlineFormPanel: React.FC<InlineFormPanelProps> = ({ id, className, children }) => (
  <div
    id={id}
    className={`inline-form-panel glass fade-in${className ? ` ${className}` : ''}`}
  >
    {children}
  </div>
);
