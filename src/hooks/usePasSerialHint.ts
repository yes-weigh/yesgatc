import { useEffect, useState } from 'react';
import { verifyPasSerialInBank, type PasBankVerifyOptions } from '../lib/pasSerialBank';
import type { Product } from '../types';

export type PasSerialHint = { tone: 'ok' | 'err' | 'muted'; text: string };

export function usePasSerialHint(
  serial: string,
  product: Product | null | undefined,
  enabled: boolean,
  options?: PasBankVerifyOptions,
): PasSerialHint | null {
  const [hint, setHint] = useState<PasSerialHint | null>(null);
  const allowUsed = Boolean(options?.allowUsed);

  useEffect(() => {
    if (!enabled || !product) {
      setHint(null);
      return;
    }
    const trimmed = serial.trim();
    if (!trimmed) {
      setHint({
        tone: 'muted',
        text: 'Type the serial. Checked against this product’s PAS number bank.',
      });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void verifyPasSerialInBank(trimmed, product, { allowUsed })
        .then(error => {
          if (cancelled) return;
          setHint(
            error
              ? { tone: 'err', text: error }
              : { tone: 'ok', text: 'Serial is in the PAS number bank.' },
          );
        })
        .catch(() => {
          if (cancelled) return;
          setHint({ tone: 'err', text: 'Could not check PAS number bank.' });
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allowUsed, enabled, product, serial]);

  return hint;
}
