import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  serialsForReservedInvoices,
} from '../lib/invoicedQuotaSerials';
import {
  computeRcQuotaSeats,
  normalizeReservedAssignments,
  type RcQuotaSeats,
} from '../lib/rcMasterQuota';
import { expandSerialRange, uniqueSerials, yesoneSerialFromDoc } from '../lib/yesoneInboundData';
import {
  filterInwardBatchesForRc,
  inwardBatchesFromInboundEvents,
  serialInwardBatchFromDoc,
  type SerialInwardBatch,
} from '../lib/serialInwardReport';
import { useRcScope } from '../lib/roleScope';
import type { SiteCalibration } from '../types';

export function useRcQuotaSeats(
  rcUid: string | null | undefined,
  records: SiteCalibration[],
): RcQuotaSeats & { ready: boolean } {
  const { isRcAdmin } = useRcScope();
  const [companyName, setCompanyName] = useState('');
  const [rcCode, setRcCode] = useState('');
  const [ovQuota, setOvQuota] = useState('');
  const [ovQuotaUsed, setOvQuotaUsed] = useState('');
  const [storedSerials, setStoredSerials] = useState<string[]>([]);
  const [voidedSerials, setVoidedSerials] = useState<string[]>([]);
  const [reservedSerials, setReservedSerials] = useState<string[]>([]);
  const [reservedInvoices, setReservedInvoices] = useState<string[]>([]);
  const [reservedForUids, setReservedForUids] = useState<string[]>([]);
  const [reservedAssignments, setReservedAssignments] = useState<
    Array<{ invoiceNo: string; verifierUid: string; serialStart?: string; serialEnd?: string }>
  >([]);
  const [allotSerials, setAllotSerials] = useState<string[]>([]);
  const [batchRows, setBatchRows] = useState<SerialInwardBatch[]>([]);
  const [eventRows, setEventRows] = useState<SerialInwardBatch[]>([]);
  const [rcWideRecords, setRcWideRecords] = useState<SiteCalibration[] | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [allotLoaded, setAllotLoaded] = useState(!rcUid);
  const [batchLoaded, setBatchLoaded] = useState(!rcUid);
  const [eventLoaded, setEventLoaded] = useState(!rcUid);

  useEffect(() => {
    if (!rcUid || isRcAdmin) {
      setRcWideRecords(null);
      return;
    }
    return onSnapshot(
      query(collection(db, 'siteCalibrations'), where('rcId', '==', rcUid)),
      snap => {
        setRcWideRecords(
          snap.docs.map(item => ({ id: item.id, ...item.data() }) as SiteCalibration),
        );
      },
      () => setRcWideRecords(null),
    );
  }, [isRcAdmin, rcUid]);

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
        setOvQuotaUsed(
          data.ovQuotaUsed == null || data.ovQuotaUsed === '' ? '' : String(data.ovQuotaUsed),
        );
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
        setAllotLoaded(true);
      },
      () => {
        setAllotSerials([]);
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

  const mergedReserved = useMemo(() => {
    const fromAssignments: string[] = [];
    for (const row of reservedAssignments) {
      if (row.serialStart) {
        fromAssignments.push(
          ...expandSerialRange(row.serialStart, row.serialEnd || row.serialStart),
        );
      }
    }
    return uniqueSerials([
      ...reservedSerials,
      ...fromAssignments,
      ...serialsForReservedInvoices([...batchRows, ...eventRows], reservedInvoices),
    ]);
  }, [batchRows, eventRows, reservedAssignments, reservedInvoices, reservedSerials]);

  const reservedByUid = useMemo(() => {
    const map: Record<string, string[]> = {};
    const batches = [...batchRows, ...eventRows];
    const reservedAllow = new Set(reservedSerials.map(s => s.trim().toUpperCase()).filter(Boolean));
    for (const row of reservedAssignments) {
      let serials =
        row.serialStart
          ? expandSerialRange(row.serialStart, row.serialEnd || row.serialStart)
          : serialsForReservedInvoices(batches, [row.invoiceNo]);
      if (serials.length === 0 && reservedSerials.length > 0) {
        serials = reservedSerials;
      }
      // Clip to yesoneReservedSerials so leftover stickers never inflate QTY.
      if (reservedAllow.size > 0) {
        const clipped = serials.filter(s => reservedAllow.has(s.trim().toUpperCase()));
        if (clipped.length > 0) serials = clipped;
      }
      if (serials.length === 0) continue;
      map[row.verifierUid] = uniqueSerials([...(map[row.verifierUid] || []), ...serials]);
    }
    // Legacy: reserved serials + assignee uids, no invoice map → reserved pool only.
    if (Object.keys(map).length === 0 && reservedForUids.length > 0 && reservedSerials.length > 0) {
      for (const uid of reservedForUids) {
        map[uid] = reservedSerials;
      }
    }
    return map;
  }, [batchRows, eventRows, reservedAssignments, reservedForUids, reservedSerials]);

  const seats = useMemo(
    () =>
      computeRcQuotaSeats({
        rcCode,
        companyName,
        ovQuota,
        ovQuotaUsed,
        recordsAreRcWide: isRcAdmin || rcWideRecords != null,
        storedSerials,
        allotSerials,
        voidedSerials,
        records: isRcAdmin || !rcWideRecords ? records : rcWideRecords,
        reservedSerials: mergedReserved,
        reservedForUids,
        reservedByUid,
      }),
    [
      allotSerials,
      companyName,
      isRcAdmin,
      mergedReserved,
      ovQuota,
      ovQuotaUsed,
      rcCode,
      rcWideRecords,
      records,
      reservedByUid,
      reservedForUids,
      storedSerials,
      voidedSerials,
    ],
  );

  return { ...seats, ready: userLoaded && allotLoaded && batchLoaded && eventLoaded };
}
