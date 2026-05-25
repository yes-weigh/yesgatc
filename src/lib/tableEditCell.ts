import type { KeyboardEvent } from 'react';

export function tableEditCellProps(onEdit: () => void, title = 'Edit') {
  return {
    className: 'table-col-editable',
    onClick: onEdit,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onEdit();
      }
    },
    tabIndex: 0,
    role: 'button' as const,
    title,
  };
}
