import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { CircleDot, Hash, Layers } from 'lucide-react';
import { db } from '../firebase';
import {
  computeRcQuotaSeats,
  excludeReservedSerials,
  normalizeReservedAssignments,
  toggleReservedSerial,
} from '../lib/rcMasterQuota';
import {
  expandSerialRange,
  uniqueSerials,
  yesoneSerialFromDoc,
  type YesoneSerialAllotment,
} from '../lib/yesoneInboundData';
import {
  filterInwardBatchesForRc,
  inwardBatchesFromInboundEvents,
  serialInwardBatchFromDoc,
  type SerialInwardBatch,
} from '../lib/serialInwardReport';
import { serialsForReservedInvoices } from '../lib/invoicedQuotaSerials';
import { pasProductIdSet, pasSerialsFromAllotments } from '../lib/pasSerialBank';
import { useAppContext } from '../context/AppContext';
import { useRcScope } from '../lib/roleScope';
import type { SiteCalibration } from '../types';
import { SerialSeatOverlay } from './SerialSeatOverlay';

type RcQuotaOverviewProps = {
  rcUid: string;
  records: SiteCalibration[];
};

function displayQty(value: number | null): string {
  return value == null ? '—' : String(value);
}

export function RcQuotaOverview({ rcUid, records }: RcQuotaOverviewProps) {
  const { isRcAdmin } = useRcScope();
  const { products } = useAppContext();
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
  const [allotmentRows, setAllotmentRows] = useState<YesoneSerialAllotment[]>([]);
  const [batchRows, setBatchRows] = useState<SerialInwardBatch[]>([]);
  const [eventRows, setEventRows] = useState<SerialInwardBatch[]>([]);
  const [quotaRecords, setQuotaRecords] = useState<SiteCalibration[]>(records);
  const [rcWideOk, setRcWideOk] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setQuotaRecords(prev => (rcWideOk ? prev : records));
  }, [rcWideOk, records]);

  useEffect(() => {
    setRcWideOk(false);
    return onSnapshot(
      query(collection(db, 'siteCalibrations'), where('rcId', '==', rcUid)),
      snap => {
        setQuotaRecords(
          snap.docs.map(item => ({ id: item.id, ...item.data() }) as SiteCalibration),
        );
        setRcWideOk(true);
      },
      () => {
        setRcWideOk(false);
        /* keep list-scoped records if RC-wide read denied */
      },
    );
  }, [rcUid]);

  useEffect(() => {
    return onSnapshot(doc(db, 'users', rcUid), snap => {
      if (!snap.exists()) return;
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
        uniqueSerials(Array.isArray(data.yesoneReservedInvoices) ? data.yesoneReservedInvoices : []),
      );
      setReservedForUids(
        uniqueSerials(Array.isArray(data.yesoneReservedForUids) ? data.yesoneReservedForUids : []),
      );
      setReservedAssignments(normalizeReservedAssignments(data.yesoneReservedAssignments));
    });
  }, [rcUid]);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'serialAllotments'), where('rcId', '==', rcUid)),
      snap => {
        const rows = snap.docs.map(item => yesoneSerialFromDoc(item.id, item.data()));
        const active = rows.filter(row => row.status !== 'cancelled' && row.status !== 'replaced');
        setAllotmentRows(active);
        setAllotSerials(uniqueSerials(active.map(row => row.serialNumber)));
      },
      () => {
        setAllotmentRows([]);
        setAllotSerials([]);
      },
    );
  }, [rcUid]);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'serialInwardBatches'), where('rcId', '==', rcUid)),
      snap => {
        setBatchRows(snap.docs.map(item => serialInwardBatchFromDoc(item.id, item.data())));
      },
      () => setBatchRows([]),
    );
  }, [rcUid]);

  useEffect(() => {
    return onSnapshot(collection(db, 'yesoneInboundEvents'), snap => {
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
    }, () => setEventRows([]));
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

  const pasProductIds = useMemo(() => pasProductIdSet(products), [products]);
  const pasSerials = useMemo(
    () => pasSerialsFromAllotments(allotmentRows, products),
    [allotmentRows, products],
  );

  const quota = useMemo(
    () =>
      computeRcQuotaSeats({
        rcCode,
        companyName,
        ovQuota,
        ovQuotaUsed,
        recordsAreRcWide: isRcAdmin || rcWideOk,
        storedSerials,
        allotSerials,
        voidedSerials,
        records: quotaRecords,
        reservedSerials: mergedReserved,
        reservedForUids,
        pasProductIds,
        pasSerials,
      }),
    [
      allotSerials,
      companyName,
      isRcAdmin,
      mergedReserved,
      ovQuota,
      ovQuotaUsed,
      pasProductIds,
      pasSerials,
      quotaRecords,
      rcCode,
      rcWideOk,
      reservedForUids,
      storedSerials,
      voidedSerials,
    ],
  );

  // VCT: never show verifier-reserved stickers (mask from balance overlay + count).
  const balanceSerials = useMemo(() => {
    if (isRcAdmin) return quota.remaining;
    // Field staff / VCT: public pool only.
    return excludeReservedSerials(quota.vctRemaining, mergedReserved);
  }, [isRcAdmin, mergedReserved, quota.remaining, quota.vctRemaining]);

  const balanceQty = isRcAdmin ? quota.balanceQty : balanceSerials.length;

  return (
    <>
      <section className="wl-stages-panel wl-quota" aria-labelledby="wl-quota-title">
        <div className="wl-section__head">
          <h2 id="wl-quota-title" className="wl-section__title">
            Quota
          </h2>
        </div>
        <div className="rc-summary-row wl-quota-row">
          <article className="rc-summary-tile rc-summary-tile--blue">
            <p className="rc-summary-tile__label">
              <Layers size={16} strokeWidth={2.2} aria-hidden />
              Allotted
            </p>
            <p className="rc-summary-tile__value">{displayQty(quota.allottedQty)}</p>
          </article>
          <article className="rc-summary-tile rc-summary-tile--pink">
            <p className="rc-summary-tile__label">
              <CircleDot size={16} strokeWidth={2.2} aria-hidden />
              Used
            </p>
            <p className="rc-summary-tile__value">{displayQty(quota.usedQty)}</p>
          </article>
          <button
            type="button"
            className="rc-summary-tile rc-summary-tile--green"
            onClick={() => setOpen(true)}
            aria-label="Balance serial numbers"
          >
            <p className="rc-summary-tile__label">
              <Hash size={16} strokeWidth={2.2} aria-hidden />
              Balance
            </p>
            <p className="rc-summary-tile__value">
              {displayQty(balanceQty)}
            </p>
          </button>
        </div>
      </section>

      {open ? (
        <SerialSeatOverlay
          companyName={companyName || 'RC'}
          rcCode={rcCode}
          serials={balanceSerials}
          voidedSerials={[]}
          reservedSerials={isRcAdmin ? quota.reservedSerials : []}
          expectedCount={balanceQty}
          canVoid={false}
          canReserve={isRcAdmin}
          onToggleReserve={(serial, reserved) => toggleReservedSerial(rcUid, serial, reserved)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
