type OverlayEntry = {
  id: number;
  close: () => void;
};

const stack: OverlayEntry[] = [];
let nextId = 0;
let ignorePopCount = 0;
let listenerAttached = false;

function onPopState() {
  if (ignorePopCount > 0) {
    ignorePopCount -= 1;
    return;
  }
  const entry = stack.pop();
  entry?.close();
}

function ensureListener() {
  if (listenerAttached || typeof window === 'undefined') return;
  listenerAttached = true;
  window.addEventListener('popstate', onPopState);
}

export type OverlayDismissOptions = {
  /** When true, remove the overlay from the stack without calling `history.back()`. */
  suppressHistoryBack?: boolean;
};

export type OverlayDismiss = (options?: OverlayDismissOptions) => void;

/** Push a history entry; back will invoke `close` before leaving the route. */
export function registerOverlay(close: () => void): OverlayDismiss {
  ensureListener();
  const id = ++nextId;
  const entry: OverlayEntry = { id, close };
  stack.push(entry);
  window.history.pushState({ __yesgatcOverlay: id }, '');

  return (options?: OverlayDismissOptions) => {
    const index = stack.findIndex(item => item.id === id);
    if (index === -1) return;
    const isTop = index === stack.length - 1;
    stack.splice(index, 1);
    if (isTop && !options?.suppressHistoryBack) {
      ignorePopCount += 1;
      window.history.back();
    }
  };
}
