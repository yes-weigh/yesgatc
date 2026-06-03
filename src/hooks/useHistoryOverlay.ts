import { useEffect, useRef } from 'react';
import { registerOverlay } from '../lib/overlayHistory';

/**
 * Syncs overlay open state with the browser history stack so hardware / gesture
 * back closes the overlay instead of leaving the current route.
 */
export function useHistoryOverlay(active: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    return registerOverlay(() => onCloseRef.current());
  }, [active]);
}
