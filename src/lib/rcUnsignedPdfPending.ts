import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { tallySignedPdfFilters } from './signedCertificatePdf';
import type { SiteCalibration } from '../types';

/** Above this, RC + VCT get disturbing popups on every menu / new job. */
export const UNSIGNED_PDF_DISTURB_THRESHOLD = 10;

export async function fetchRcUnsignedPdfCount(rcUid: string): Promise<number> {
  const snap = await getDocs(
    query(collection(db, 'siteCalibrations'), where('rcId', '==', rcUid)),
  );
  const records = snap.docs.map(
    item => ({ id: item.id, ...item.data() }) as SiteCalibration,
  );
  return tallySignedPdfFilters(records).notSigned;
}

/** Pending No signed PDF count for an RC centre. Refetch when `reloadKey` changes. */
export function useRcUnsignedPdfCount(
  rcUid: string | null | undefined,
  reloadKey?: string | number,
): { count: number; ready: boolean; disturb: boolean } {
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!rcUid) {
      setCount(0);
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    void fetchRcUnsignedPdfCount(rcUid)
      .then(next => {
        if (cancelled) return;
        setCount(next);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCount(0);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rcUid, reloadKey]);

  return {
    count,
    ready,
    disturb: count > UNSIGNED_PDF_DISTURB_THRESHOLD,
  };
}
