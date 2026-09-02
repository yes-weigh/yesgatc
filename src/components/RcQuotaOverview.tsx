import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { CircleDot, Hash, Layers } from 'lucide-react';
import { db } from '../firebase';
import {
  computeRcQuotaSeats,
  toggleReservedSerial,
} from '../lib/rcMasterQuota';
import { uniqueSerials, yesoneSerialFromDoc } from '../lib/yesoneInboundData';
import {
  filterInwardBatchesForRc,
  inwardBatchesFromInboundEvents,
  serialInwardBatchFromDoc,
  type SerialInwardBatch,
} from '../lib/serialInwardReport';
import {
  invoicedSerialsFromAllotments,
  serialsForReservedInvoices,
  serialsFromInwardBatches,
} from '../lib/invoicedQuotaSerials';
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
  const [companyName, setCompanyName] = useState('');
  const [rcCode, setRcCode] = useState('');
  const [ovQuota, setOvQuota] = useState('');
  const [storedSerials, setStoredSerials] = useState<string[]>([]);
  const [voidedSerials, setVoidedSerials] = useState<string[]>([]);
  const [reservedSerials, setReservedSerials] = useState<string[]>([]);
  const [reservedInvoices, setReservedInvoices] = useState<string[]>([]);
  const [reservedForUids, setReservedForUids] = useState<string[]>([]);
  const [allotSerials, setAllotSerials] = useState<string[]>([]);
  const [allotInvoiced, setAllotInvoiced] = useState<string[]>([]);
  const [batchRows, setBatchRows] = useState<SerialInwardBatch[]>([]);
  const [eventRows, setEventRows] = useState<SerialInwardBatch[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return onSnapshot(doc(db, 'users', rcUid), snap => {
      if (!snap.exists()) return;
      const data = snap.data();
      setCompanyName(String(data.companyName || data.username || 'RC').trim());
      setRcCode(String(data.rcCode || '').trim());
      setOvQuota(data.ovQuota == null || data.ovQuota === '' ? '' : String(data.ovQuota));
      setStoredSerials(uniqueSerials(data.yesoneAllottedSerials));
      setVoidedSerials(uniqueSerials(data.yesoneVoidedSerials));
      setReservedSerials(uniqueSerials(data.yesoneReservedSerials));
      setReservedInvoices(
        uniqueSerials(Array.isArray(data.yesoneReservedInvoices) ? data.yesoneReservedInvoices : []),
      );
      setReservedForUids(
        uniqueSerials(Array.isArray(data.yesoneReservedForUids) ? data.yesoneReservedForUids : []),
      );
    });
  }, [rcUid]);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'serialAllotments'), where('rcId', '==', rcUid)),
      snap => {
        const rows = snap.docs.map(item => yesoneSerialFromDoc(item.id, item.data()));
        const active = rows.filter(row => row.status !== 'cancelled' && row.status !== 'replaced');
        setAllotSerials(uniqueSerials(active.map(row => row.serialNumber)));
        setAllotInvoiced(invoicedSerialsFromAllotments(active));
      },
      () => {
        setAllotSerials([]);
        setAllotInvoiced([]);
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

  const quota = useMemo(
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
      }),
    [
      allotSerials,
      companyName,
      invoicedSerials,
      mergedReserved,
      ovQuota,
      rcCode,
      records,
      reservedForUids,
      storedSerials,
      voidedSerials,
    ],
  );

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
            <p className="rc-summary-tile__value">{displayQty(quota.balanceQty)}</p>
          </button>
        </div>
      </section>

      {open ? (
        <SerialSeatOverlay
          companyName={companyName || 'RC'}
          rcCode={rcCode}
          serials={quota.remaining}
          voidedSerials={[]}
          reservedSerials={quota.reservedSerials}
          expectedCount={quota.balanceQty}
          canVoid={false}
          canReserve
          onToggleReserve={(serial, reserved) => toggleReservedSerial(rcUid, serial, reserved)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
