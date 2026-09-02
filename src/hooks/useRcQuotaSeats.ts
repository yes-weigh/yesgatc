import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  invoicedSerialsFromAllotments,
  serialsForReservedInvoices,
  serialsFromInwardBatches,
} from '../lib/invoicedQuotaSerials';
import {
  computeRcQuotaSeats,
  normalizeReservedAssignments,
  type RcQuotaSeats,
} from '../lib/rcMasterQuota';
import { uniqueSerials, yesoneSerialFromDoc } from '../lib/yesoneInboundData';
import {
  filterInwardBatchesForRc,
  inwardBatchesFromInboundEvents,
  serialInwardBatchFromDoc,
  type SerialInwardBatch,
} from '../lib/serialInwardReport';
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
  const [reservedSerials, setReservedSerials] = useState<string[]>([]);
  const [reservedInvoices, setReservedInvoices] = useState<string[]>([]);
  const [reservedForUids, setReservedForUids] = useState<string[]>([]);
  const [reservedAssignments, setReservedAssignments] = useState<
    Array<{ invoiceNo: string; verifierUid: string }>
  >([]);
  const [allotSerials, setAllotSerials] = useState<string[]>([]);
  const [allotInvoiced, setAllotInvoiced] = useState<string[]>([]);
  const [batchRows, setBatchRows] = useState<SerialInwardBatch[]>([]);
  const [eventRows, setEventRows] = useState<SerialInwardBatch[]>([]);
  const [userLoaded, setUserLoaded] = useState(false);
  const [allotLoaded, setAllotLoaded] = useState(!rcUid);
  const [batchLoaded, setBatchLoaded] = useState(!rcUid);
  const [eventLoaded, setEventLoaded] = useState(!rcUid);

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
        setReservedSerials(uniqueSerials(data.yesoneReservedSerials));
        setReservedInvoices(
          uniqueSerials(
            Array.isArray(data.yesoneReservedInvoices) ? data.yesoneReservedInvoices : [],
          ),
        );
        setReservedForUids(
          uniqueSerials(
            Array.isArray(data.yesoneReservedForUids) ? data.yesoneReservedForUids : [],
          ),
        );
        setReservedAssignments(normalizeReservedAssignments(data.yesoneReservedAssignments));
      }
      setUserLoaded(true);
    });
  }, [rcUid]);

  useEffect(() => {
    if (!rcUid) {
      setAllotSerials([]);
      setAllotInvoiced([]);
      setAllotLoaded(true);
      return;
    }
    setAllotLoaded(false);
    return onSnapshot(
      query(collection(db, 'serialAllotments'), where('rcId', '==', rcUid)),
      snap => {
        const rows = snap.docs.map(item => yesoneSerialFromDoc(item.id, item.data()));
        const active = rows.filter(row => row.status !== 'cancelled' && row.status !== 'replaced');
        setAllotSerials(uniqueSerials(active.map(row => row.serialNumber)));
        setAllotInvoiced(invoicedSerialsFromAllotments(active));
        setAllotLoaded(true);
      },
      () => {
        setAllotSerials([]);
        setAllotInvoiced([]);
        setAllotLoaded(true);
      },
    );
  }, [rcUid]);

  useEffect(() => {
    if (!rcUid) {
      setBatchRows([]);
      setBatchLoaded(true);
      return;
    }
    setBatchLoaded(false);
    return onSnapshot(
      query(collection(db, 'serialInwardBatches'), where('rcId', '==', rcUid)),
      snap => {
        setBatchRows(snap.docs.map(item => serialInwardBatchFromDoc(item.id, item.data())));
        setBatchLoaded(true);
      },
      () => {
        setBatchRows([]);
        setBatchLoaded(true);
      },
    );
  }, [rcUid]);

  useEffect(() => {
    if (!rcUid) {
      setEventRows([]);
      setEventLoaded(true);
      return;
    }
    setEventLoaded(false);
    return onSnapshot(
      collection(db, 'yesoneInboundEvents'),
      snap => {
        const events = snap.docs.map(item => {
          const data = item.data() as { at?: string; payload?: unknown };
          return { id: item.id, at: data.at, payload: data.payload };
        });
        setEventRows(
          filterInwardBatchesForRc(inwardBatchesFromInboundEvents(events), {
            rcId: rcUid,
            rcCode,
          }),
        );
        setEventLoaded(true);
      },
      () => {
        setEventRows([]);
        setEventLoaded(true);
      },
    );
  }, [rcCode, rcUid]);

  const invoicedSerials = useMemo(
    () =>
      uniqueSerials([
        ...allotInvoiced,
        ...serialsFromInwardBatches(batchRows),
        ...serialsFromInwardBatches(eventRows),
      ]),
    [allotInvoiced, batchRows, eventRows],
  );

  const mergedReserved = useMemo(
    () =>
      uniqueSerials([
        ...reservedSerials,
        ...serialsForReservedInvoices([...batchRows, ...eventRows], reservedInvoices),
      ]),
    [batchRows, eventRows, reservedInvoices, reservedSerials],
  );

  const reservedByUid = useMemo(() => {
    const map: Record<string, string[]> = {};
    const batches = [...batchRows, ...eventRows];
    for (const row of reservedAssignments) {
      const serials = serialsForReservedInvoices(batches, [row.invoiceNo]);
      if (serials.length === 0) continue;
      map[row.verifierUid] = uniqueSerials([...(map[row.verifierUid] || []), ...serials]);
    }
    // Legacy: reserved serials + assignee uids, no invoice map → give full reserved pool to each.
    if (Object.keys(map).length === 0 && reservedForUids.length > 0 && mergedReserved.length > 0) {
      for (const uid of reservedForUids) {
        map[uid] = mergedReserved;
      }
    }
    return map;
  }, [batchRows, eventRows, mergedReserved, reservedAssignments, reservedForUids]);

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
        invoicedSerials,
        reservedSerials: mergedReserved,
        reservedForUids,
        reservedByUid,
      }),
    [
      allotSerials,
      companyName,
      invoicedSerials,
      mergedReserved,
      ovQuota,
      rcCode,
      records,
      reservedByUid,
      reservedForUids,
      storedSerials,
      voidedSerials,
    ],
  );

  return { ...seats, ready: userLoaded && allotLoaded && batchLoaded && eventLoaded };
}
