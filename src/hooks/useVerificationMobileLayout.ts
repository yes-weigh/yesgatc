import { useEffect } from 'react';
import { useMobileViewport } from './useMobileViewport';

const BODY_CLASS = 'verification-mobile-wizard-active';

const METRIC_SELECTORS = {
  stickyTop: '.mobile-app-bar--sticky',
  stepper: '.verification-mobile-chrome--stepper',
  actions: '.verification-mobile-chrome--actions',
  footer: '.verification-mobile-chrome--footer',
} as const;

function syncVerificationMobileMetrics() {
  const appBar = document.querySelector(METRIC_SELECTORS.stickyTop);
  if (appBar) {
    document.body.style.setProperty(
      '--mobile-verification-sticky-top',
      `${appBar.getBoundingClientRect().height}px`,
    );
  }

  const stepper = document.querySelector(METRIC_SELECTORS.stepper);
  if (stepper) {
    const stepperHeight = stepper.getBoundingClientRect().height;
    document.body.style.setProperty('--mobile-verification-stepper-height', `${stepperHeight}px`);
    document.body.style.setProperty('--mobile-verification-content-inset-top', `${stepperHeight}px`);
  }

  const actions = document.querySelector(METRIC_SELECTORS.actions);
  if (actions) {
    document.body.style.setProperty(
      '--mobile-verification-bottom-height',
      `${actions.getBoundingClientRect().height}px`,
    );
  }

  const footer = document.querySelector(METRIC_SELECTORS.footer);
  if (footer) {
    document.body.style.setProperty(
      '--mobile-verification-footer-height',
      `${footer.getBoundingClientRect().height}px`,
    );
  }

  const bottomChrome = footer ?? actions;
  if (bottomChrome) {
    document.body.style.setProperty(
      '--mobile-verification-content-inset-bottom',
      `${bottomChrome.getBoundingClientRect().height}px`,
    );
  }
}

/** Keeps verification wizard chrome pinned to the viewport on mobile. */
export function useVerificationMobileLayout(active: boolean): boolean {
  const isMobile = useMobileViewport();
  const enabled = active && isMobile;

  useEffect(() => {
    if (!enabled) return;

    document.body.classList.add(BODY_CLASS);

    const observer = new ResizeObserver(syncVerificationMobileMetrics);

    const observeChrome = () => {
      syncVerificationMobileMetrics();
      Object.values(METRIC_SELECTORS).forEach(selector => {
        const node = document.querySelector(selector);
        if (node) observer.observe(node);
      });
    };

    observeChrome();
    window.addEventListener('resize', syncVerificationMobileMetrics);

    const retryTimer = window.setInterval(observeChrome, 250);
    const stopRetryTimer = window.setTimeout(() => window.clearInterval(retryTimer), 2000);

    return () => {
      window.clearInterval(retryTimer);
      window.clearTimeout(stopRetryTimer);
      observer.disconnect();
      window.removeEventListener('resize', syncVerificationMobileMetrics);
      document.body.classList.remove(BODY_CLASS);
      document.body.style.removeProperty('--mobile-verification-sticky-top');
      document.body.style.removeProperty('--mobile-verification-stepper-height');
      document.body.style.removeProperty('--mobile-verification-bottom-height');
      document.body.style.removeProperty('--mobile-verification-footer-height');
      document.body.style.removeProperty('--mobile-verification-content-inset-top');
      document.body.style.removeProperty('--mobile-verification-content-inset-bottom');
    };
  }, [enabled]);

  return enabled;
}
