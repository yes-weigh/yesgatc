/** Focus a text input and surface the software keyboard on mobile browsers / PWA. */
export function focusMobileTextInput(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): void {
  if (el.disabled || ('readOnly' in el && el.readOnly)) return;

  if (el instanceof HTMLSelectElement) {
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  const applyFocus = () => {
    el.focus({ preventScroll: false });
    try {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    } catch {
      /* setSelectionRange unsupported on some input types */
    }
  };

  applyFocus();

  const isIos =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as Window & { MSStream?: unknown }).MSStream;

  if (isIos) {
    const wasReadOnly = el.readOnly;
    el.readOnly = true;
    el.focus({ preventScroll: false });
    el.readOnly = wasReadOnly;
    applyFocus();
  }

  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function getVerificationSerialInput(
  localId: string,
): HTMLInputElement | HTMLSelectElement | null {
  const candidates = [
    document.getElementById(`verification-mobile-serial-${localId}`),
    document.getElementById(`verification-serial-${localId}`),
  ];
  for (const node of candidates) {
    if (node instanceof HTMLSelectElement && !node.disabled && node.getClientRects().length > 0) {
      return node;
    }
    if (!(node instanceof HTMLInputElement) || node.disabled) continue;
    if (node.getClientRects().length > 0) return node;
  }
  return null;
}
