import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  PAS_SERIAL_BANK_META_COLLECTION,
  mergePasBlockedSerials,
  pasSerialsFromAllotments,
  pasSerialsFromMetaRanges,
  type PasAllotmentIdentity,
} from '../lib/pasSerialBank';
import type { Product } from '../types';

/** PAS bank seats RC/VCT must not see on GAS remaining sticker boards. */
export function usePasBlockedSerials(
  allotmentRows: readonly PasAllotmentIdentity[],
  products: readonly Product[] | undefined,
): string[] {
  const [metaSerials, setMetaSerials] = useState<string[]>([]);

  useEffect(() => {
    return onSnapshot(
      collection(db, PAS_SERIAL_BANK_META_COLLECTION),
      snap => {
        setMetaSerials(
          pasSerialsFromMetaRanges(
            snap.docs.map(item => {
              const data = item.data() as { from?: string; to?: string };
              return { from: data.from, to: data.to };
            }),
          ),
        );
      },
      () => setMetaSerials([]),
    );
  }, []);

  return useMemo(
    () => mergePasBlockedSerials(pasSerialsFromAllotments(allotmentRows, products), metaSerials),
    [allotmentRows, metaSerials, products],
  );
}
