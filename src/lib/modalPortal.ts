export const APP_MODAL_ROOT_ID = 'app-modal-root';

/** Portal target inside the app shell (sidebar stays visible). Falls back to body on login etc. */
export function getModalPortalRoot(): HTMLElement {
  return document.getElementById(APP_MODAL_ROOT_ID) ?? document.body;
}

/** Prevent background scroll on the main page column while a modal is open. */
export function lockModalHostScroll(): () => void {
  const host =
    document.getElementById(APP_MODAL_ROOT_ID)?.parentElement ??
    document.querySelector('.main-content');

  if (host instanceof HTMLElement) {
    const prev = host.style.overflow;
    host.style.overflow = 'hidden';
    return () => {
      host.style.overflow = prev;
    };
  }

  const prev = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  return () => {
    document.body.style.overflow = prev;
  };
}
