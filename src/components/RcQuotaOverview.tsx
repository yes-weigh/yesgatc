import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { CircleDot, Hash, Layers } from 'lucide-react';
import { db } from '../firebase';
import {
  IWP_USED_FROM_DATE,
  isMasterPoolSerial,
  isMasterRc,
  masterRcPoolSerials,
  masterRcUnusedQty,
  remainingQuotaSerials,
  rcOvUsedFromRecords,
} from '../lib/rcMasterQuota';
import { parseQuotaInput, uniqueSerials, yesoneSerialFromDoc } from '../lib/yesoneInboundData';
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
  const [allotSerials, setAllotSerials] = useState<string[]>([]);
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
    });
  }, [rcUid]);

  useEffect(() => {
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
      },
      () => setAllotSerials([]),
    );
  }, [rcUid]);

  const quota = useMemo(() => {
    const master = isMasterRc({ rcCode, companyName });
    const fromStore = uniqueSerials([...storedSerials, ...allotSerials]);
    const allottedSerials = master
      ? uniqueSerials([
        ...fromStore.filter(serial => !isMasterPoolSerial(serial)),
        ...masterRcPoolSerials(),
      ])
      : fromStore.filter(serial => !isMasterPoolSerial(serial));
    const used = rcOvUsedFromRecords(
      records,
      master ? { fromDate: IWP_USED_FROM_DATE } : undefined,
    );
    const remaining = remainingQuotaSerials(allottedSerials, used.serials, voidedSerials);
    const allottedQty = master ? masterRcUnusedQty() : parseQuotaInput(ovQuota);
    const usedQty = used.count;
    const balanceQty = allottedQty == null ? null : allottedQty - usedQty;
    return { remaining, allottedQty, usedQty, balanceQty };
  }, [allotSerials, companyName, ovQuota, rcCode, records, storedSerials, voidedSerials]);

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
          expectedCount={quota.balanceQty}
          canVoid={false}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
