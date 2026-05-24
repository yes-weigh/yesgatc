import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { getModalPortalRoot, lockModalHostScroll } from '../lib/modalPortal';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      setPending({ options, resolve });
    });
  }, []);

  const dismiss = useCallback((result: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    current.resolve(result);
    setPending(null);
  }, []);

  useEffect(() => {
    if (!pending) return;

    const unlockScroll = lockModalHostScroll();

    const focusTimer = requestAnimationFrame(() => {
      cancelRef.current?.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss(false);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      unlockScroll();
      cancelAnimationFrame(focusTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [pending, dismiss]);

  const dialog =
    pending &&
    createPortal(
      <div
        className="modal-overlay confirm-overlay"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={() => dismiss(false)}
      >
        <div className="confirm-dialog glass" onClick={e => e.stopPropagation()}>
          <h3 id="confirm-dialog-title" className="confirm-dialog-title">
            {pending.options.title ?? 'Confirm'}
          </h3>
          <p id="confirm-dialog-message" className="confirm-dialog-message">
            {pending.options.message}
          </p>
          <div className="confirm-dialog-actions">
            <button
              ref={cancelRef}
              type="button"
              className="btn btn-secondary"
              onClick={() => dismiss(false)}
            >
              {pending.options.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={`btn ${pending.options.destructive ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => dismiss(true)}
            >
              {pending.options.confirmLabel ?? 'OK'}
            </button>
          </div>
        </div>
      </div>,
      getModalPortalRoot(),
    );

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {dialog}
    </ConfirmContext.Provider>
  );
};

export function useConfirm(): ConfirmContextValue['confirm'] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within ConfirmProvider');
  }
  return ctx.confirm;
}
