import React from 'react';
import { Pencil, Save, X } from 'lucide-react';

type CustomerFormEditToolbarProps = {
  editing: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  saving?: boolean;
  disabled?: boolean;
};

export const CustomerFormEditToolbar: React.FC<CustomerFormEditToolbarProps> = ({
  editing,
  onStartEdit,
  onSave,
  onCancelEdit,
  saving = false,
  disabled = false,
}) => (
  <div className="customer-form-edit-toolbar" role="toolbar" aria-label="Customer form actions">
    {!editing ? (
      <button
        type="button"
        className="customer-form-edit-btn customer-form-edit-btn--edit"
        onClick={onStartEdit}
        disabled={disabled || saving}
        title="Edit customer"
        aria-label="Edit customer"
      >
        <Pencil size={16} strokeWidth={2.25} />
      </button>
    ) : (
      <>
        <button
          type="button"
          className="customer-form-edit-btn customer-form-edit-btn--save"
          onClick={onSave}
          disabled={disabled || saving}
          title="Save changes"
          aria-label="Save changes"
        >
          {saving ? (
            <span className="customer-form-edit-btn-spinner" aria-label="Saving" />
          ) : (
            <Save size={16} strokeWidth={2.25} />
          )}
        </button>
        <button
          type="button"
          className="customer-form-edit-btn customer-form-edit-btn--cancel"
          onClick={onCancelEdit}
          disabled={disabled || saving}
          title="Cancel editing"
          aria-label="Cancel editing"
        >
          <X size={16} strokeWidth={2.25} />
        </button>
      </>
    )}
  </div>
);
