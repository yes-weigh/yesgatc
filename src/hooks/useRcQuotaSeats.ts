import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { computeRcQuotaSeats, type RcQuotaSeats } from '../lib/rcMasterQuota';
import { uniqueSerials, yesoneSerialFromDoc } from '../lib/yesoneInboundData';
import type { SiteCalibration } from '../types';

export function useRcQuotaSeats(
  rcUid: string | null | undefined,
  records: SiteCalibration[],
): RcQuotaSeats & { ready: boolean } {
  const [companyName, setCompanyName] = useState('');
  const [rcCode, setRcCode] = useState('');
  const [ovQuota, setOvQuota] = useState('');
  const [storedSerials, setStoredSerials] = useState<string[]>([]);
  const [voidedSerials, setVoidedSerials] = useState<string[]>([]);
  const [allotSerials, setAllotSerials] = useState<string[]>([]);
  const [userLoaded, setUserLoaded] = useState(false);
  const [allotLoaded, setAllotLoaded] = useState(!rcUid);

  useEffect(() => {
    if (!rcUid) {
      setUserLoaded(false);
      return;
    }
    setUserLoaded(false);
    return onSnapshot(doc(db, 'users', rcUid), snap => {
      if (snap.exists()) {
        const data = snap.data();
        setCompanyName(String(data.companyName || data.username || 'RC').trim());
        setRcCode(String(data.rcCode || '').trim());
        setOvQuota(data.ovQuota == null || data.ovQuota === '' ? '' : String(data.ovQuota));
        setStoredSerials(uniqueSerials(data.yesoneAllottedSerials));
        setVoidedSerials(uniqueSerials(data.yesoneVoidedSerials));
      }
      setUserLoaded(true);
    });
  }, [rcUid]);

  useEffect(() => {
    if (!rcUid) {
      setAllotSerials([]);
      setAllotLoaded(true);
      return;
    }
    setAllotLoaded(false);
    return onSnapshot(
      query(collection(db, 'serialAllotments'), where('rcId', '==', rcUid)),
      snap => {
        const list: string[] = [];
        for (const item of snap.docs) {
          const row = yesoneSerialFromDoc(item.id, item.data());
          if (row.status === 'cancelled' || row.status === 'replaced') continue;
          list.push(row.serialNumber);
        }
        setAllotSerials(uniqueSerials(list));
        setAllotLoaded(true);
      },
      () => {
        setAllotSerials([]);
        setAllotLoaded(true);
      },
    );
  }, [rcUid]);

  const seats = useMemo(
    () =>
      computeRcQuotaSeats({
        rcCode,
        companyName,
        ovQuota,
        storedSerials,
        allotSerials,
        voidedSerials,
        records,
      }),
    [allotSerials, companyName, ovQuota, rcCode, records, storedSerials, voidedSerials],
  );

  return { ...seats, ready: userLoaded && allotLoaded };
}
