import { useEffect, useRef } from 'react';
import { registerOverlay } from '../lib/overlayHistory';

export type UseHistoryOverlayOptions = {
  /**
   * When the overlay deactivates, skip `history.back()` on cleanup.
   * Use when closing because the route changed (e.g. sidebar nav) so navigation is not undone.
   */
  suppressHistoryBackWhenInactive?: boolean;
};

/**
 * Syncs overlay open state with the browser history stack so hardware / gesture
 * back closes the overlay instead of leaving the current route.
 */
export function useHistoryOverlay(
  active: boolean,
  onClose: () => void,
  options?: UseHistoryOverlayOptions
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const suppressHistoryBackRef = useRef(false);
  suppressHistoryBackRef.current = Boolean(options?.suppressHistoryBackWhenInactive);

  useEffect(() => {
    if (!active) return;
    const dismiss = registerOverlay(() => onCloseRef.current());
    return () => dismiss({ suppressHistoryBack: suppressHistoryBackRef.current });
  }, [active]);
}
