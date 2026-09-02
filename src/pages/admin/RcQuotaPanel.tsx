import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { callableErrorMessage } from '../../lib/zohoRvInvoice';
import { syncYesoneOvUsed } from '../../lib/yesoneWebhookClient';
import { useAuth } from '../../context/AuthContext';
import {
  IWP_USED_FROM_DATE,
  isMasterPoolSerial,
  isMasterRc,
  masterRcPoolSerials,
  masterRcUnusedQty,
  MZN_G_REALLOC_MOVES,
  applySerialReallotment,
  serialReallotmentPending,
  rehomeMasterPoolSerials,
  remainingQuotaSerials,
  rcOvUsedFromRecords,
  serialsLinkedToInvoice,
  toggleVoidedSerial,
} from '../../lib/rcMasterQuota';
import { expandSerialRange, parseQuotaInput, uniqueSerials, yesoneSerialFromDoc } from '../../lib/yesoneInboundData';
import {
  inwardBatchesFromInboundEvents,
  serialInwardBatchFromDoc,
} from '../../lib/serialInwardReport';
import type { SiteCalibration } from '../../types';
import { SerialSeatOverlay } from '../../components/SerialSeatOverlay';

type QuotaRow = {
  uid: string;
  companyName: string;
  rcCode: string;
  ovQuota: string;
  ovQuotaUsed: string;
  storedSerials: string[];
  voidedSerials: string[];
};

function quotaBalanceValue(quota: string, used: string): number | null {
  const q = parseQuotaInput(quota);
  const u = parseQuotaInput(used);
  if (q == null || u == null) return null;
  return q - u;
}

function displayNum(value: string): string {
  return value.trim() || '—';
}

function sortQuotaRows(a: QuotaRow, b: QuotaRow): number {
  const aMaster = isMasterRc(a);
  const bMaster = isMasterRc(b);
  if (aMaster !== bMaster) return aMaster ? -1 : 1;
  if (aMaster) return 0;
  const soldA = parseQuotaInput(a.ovQuota) ?? -1;
  const soldB = parseQuotaInput(b.ovQuota) ?? -1;
  if (soldA !== soldB) return soldB - soldA;
  return a.companyName.localeCompare(b.companyName);
}

export function RcQuotaSynButton() {
  const [syncing, setSyncing] = useState(false);
  const [title, setTitle] = useState('Push OV used to Yesone');
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setSlot(
      document.getElementById('settings-syn-slot-mobile')
      || document.getElementById('settings-syn-slot-desktop'),
    );
  }, []);

  const handleSyn = async () => {
    setSyncing(true);
    try {
      const log = await syncYesoneOvUsed();
      setTitle(
        log.ok
          ? `Pushed ${log.rcSent}/${log.rcTotal} RC`
          : log.errors[0]?.error || `Failed for ${log.rcFailed} RC.`,
      );
    } catch (err: unknown) {
      setTitle(callableErrorMessage(err) || 'Push failed.');
    } finally {
      setSyncing(false);
    }
  };

  if (!slot) return null;

  return createPortal(
    <button
      type="button"
      className="btn btn-primary admin-setting-quota-syn"
      onClick={() => void handleSyn()}
      disabled={syncing}
      aria-label="Push OV used to Yesone"
      title={title}
    >
      <RefreshCw
        size={18}
        strokeWidth={2.5}
        color="#ffffff"
        aria-hidden
        className={syncing ? 'admin-setting-quota-syn-icon--spin' : undefined}
      />
    </button>,
    slot,
  );
}

export function RcQuotaPanel() {
  const { user } = useAuth();
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [serialsByRc, setSerialsByRc] = useState<Map<string, string[]>>(new Map());
  const [allotInvoicedByRc, setAllotInvoicedByRc] = useState<Map<string, string[]>>(new Map());
  const [batchInvoicedByRc, setBatchInvoicedByRc] = useState<Map<string, string[]>>(new Map());
  const [eventInvoicedByRc, setEventInvoicedByRc] = useState<Map<string, string[]>>(new Map());
  const [usedByRc, setUsedByRc] = useState<Map<string, { count: number; serials: string[] }>>(
    new Map(),
  );
  const [error, setError] = useState('');
  const [openUid, setOpenUid] = useState('');

  const rcUidsKey = useMemo(
    () => quotas.map(row => row.uid).sort().join(','),
    [quotas],
  );
  const masterUid = useMemo(
    () => quotas.find(row => isMasterRc(row))?.uid || '',
    [quotas],
  );
  const reallocBusy = useRef(false);
  const rehomeBusy = useRef(false);

  useEffect(() => {
    if (user?.role !== 'super_admin' || reallocBusy.current || quotas.length === 0) return;
    const rows = quotas.map(row => {
      const code = row.rcCode.toUpperCase();
      return {
        uid: row.uid,
        rcCode: row.rcCode,
        companyName: row.companyName,
        storedSerials: uniqueSerials([
          ...row.storedSerials,
          ...(serialsByRc.get(row.uid) || []),
          ...(code ? serialsByRc.get(code) || [] : []),
        ]),
      };
    });
    if (!serialReallotmentPending(rows, MZN_G_REALLOC_MOVES)) return;
    reallocBusy.current = true;
    void applySerialReallotment(rows, MZN_G_REALLOC_MOVES).finally(() => {
      reallocBusy.current = false;
    });
  }, [quotas, serialsByRc, user?.role]);

  useEffect(() => {
    if (user?.role !== 'super_admin' || rehomeBusy.current || !masterUid || quotas.length === 0) return;
    const rows = quotas.map(row => {
      const code = row.rcCode.toUpperCase();
      return {
        uid: row.uid,
        rcCode: row.rcCode,
        ovQuota: row.ovQuota,
        storedSerials: uniqueSerials([
          ...row.storedSerials,
          ...(serialsByRc.get(row.uid) || []),
          ...(code ? serialsByRc.get(code) || [] : []),
        ]),
      };
    });
    const master = rows.find(row => row.uid === masterUid);
    const pool = masterRcPoolSerials();
    const held = new Set(
      (master?.storedSerials || []).filter(isMasterPoolSerial).map(serial => serial.toUpperCase()),
    );
    const iwpMissing = pool.some(serial => !held.has(serial.toUpperCase()));
    const hasStolen = rows.some(
      row => row.uid !== masterUid && row.storedSerials.some(isMasterPoolSerial),
    );
    if (!hasStolen && !iwpMissing) return;
    rehomeBusy.current = true;
    void rehomeMasterPoolSerials(masterUid, rows).finally(() => {
      rehomeBusy.current = false;
    });
  }, [masterUid, quotas, serialsByRc, user?.role]);

  useEffect(() => {
    const unsubRcs = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'rc_admin')),
      snap => {
        setQuotas(
          snap.docs
            .map(item => {
              const data = item.data();
              return {
                uid: item.id,
                companyName: String(data.companyName || data.username || 'RC').trim(),
                rcCode: String(data.rcCode || '').trim(),
                ovQuota: data.ovQuota == null || data.ovQuota === '' ? '' : String(data.ovQuota),
                ovQuotaUsed: data.ovQuotaUsed == null || data.ovQuotaUsed === '' ? '' : String(data.ovQuotaUsed),
                storedSerials: uniqueSerials(data.yesoneAllottedSerials),
                voidedSerials: uniqueSerials(data.yesoneVoidedSerials),
              } satisfies QuotaRow;
            })
            .sort(sortQuotaRows),
        );
      },
      () => setError('Could not load RC quota.'),
    );

    const unsubAllot = onSnapshot(
      collection(db, 'serialAllotments'),
      snap => {
        const byKey = new Map<string, string[]>();
        const invoicedKey = new Map<string, string[]>();
        for (const item of snap.docs) {
          const row = yesoneSerialFromDoc(item.id, item.data());
          if (row.status === 'cancelled' || row.status === 'replaced') continue;
          const keys = [row.rcId, row.rcCode.toUpperCase()].filter(Boolean);
          for (const key of keys) {
            const list = byKey.get(key) || [];
            list.push(row.serialNumber);
            byKey.set(key, list);
            if (row.invoiceNo.trim()) {
              const inv = invoicedKey.get(key) || [];
              inv.push(row.serialNumber);
              invoicedKey.set(key, inv);
            }
          }
        }
        setSerialsByRc(byKey);
        const normalized = new Map<string, string[]>();
        for (const [key, list] of invoicedKey) normalized.set(key, uniqueSerials(list));
        setAllotInvoicedByRc(normalized);
      },
      () => {
        setSerialsByRc(new Map());
        setAllotInvoicedByRc(new Map());
      },
    );

    const unsubBatches = onSnapshot(
      collection(db, 'serialInwardBatches'),
      snap => {
        const invoicedKey = new Map<string, string[]>();
        for (const item of snap.docs) {
          const row = serialInwardBatchFromDoc(item.id, item.data());
          if (!row.invoiceNo.trim()) continue;
          const keys = [row.rcId, row.rcCode.toUpperCase()].filter(Boolean);
          const serials = expandSerialRange(row.serialStart, row.serialEnd);
          for (const key of keys) {
            const list = invoicedKey.get(key) || [];
            list.push(...serials);
            invoicedKey.set(key, list);
          }
        }
        const normalized = new Map<string, string[]>();
        for (const [key, list] of invoicedKey) normalized.set(key, uniqueSerials(list));
        setBatchInvoicedByRc(normalized);
      },
      () => setBatchInvoicedByRc(new Map()),
    );

    const unsubEvents = onSnapshot(
      collection(db, 'yesoneInboundEvents'),
      snap => {
        const events = snap.docs.map(item => {
          const data = item.data() as { at?: string; payload?: unknown };
          return { id: item.id, at: data.at, payload: data.payload };
        });
        const batches = inwardBatchesFromInboundEvents(events);
        const byKey = new Map<string, string[]>();
        for (const row of batches) {
          if (!row.invoiceNo.trim()) continue;
          const keys = [row.rcId, row.rcCode.toUpperCase()].filter(Boolean);
          const serials = expandSerialRange(row.serialStart, row.serialEnd);
          for (const key of keys) {
            const list = byKey.get(key) || [];
            list.push(...serials);
            byKey.set(key, list);
          }
        }
        const normalized = new Map<string, string[]>();
        for (const [key, list] of byKey) normalized.set(key, uniqueSerials(list));
        setEventInvoicedByRc(normalized);
      },
      () => setEventInvoicedByRc(new Map()),
    );

    return () => {
      unsubRcs();
      unsubAllot();
      unsubBatches();
      unsubEvents();
    };
  }, []);

  useEffect(() => {
    const uids = rcUidsKey ? rcUidsKey.split(',') : [];
    if (!uids.length) {
      setUsedByRc(new Map());
      return;
    }
    const unsubs = uids.map(uid =>
      onSnapshot(
        query(collection(db, 'siteCalibrations'), where('rcId', '==', uid)),
        snap => {
          setUsedByRc(prev => {
            const next = new Map(prev);
            next.set(
              uid,
              rcOvUsedFromRecords(
                snap.docs.map(item => ({ id: item.id, ...item.data() }) as SiteCalibration),
                uid === masterUid ? { fromDate: IWP_USED_FROM_DATE } : undefined,
              ),
            );
            return next;
          });
        },
        () => {
          setUsedByRc(prev => {
            const next = new Map(prev);
            next.set(uid, { count: 0, serials: [] });
            return next;
          });
        },
      ),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [rcUidsKey, masterUid]);

  const rows = useMemo(() => {
    return quotas.map(row => {
      const master = isMasterRc(row);
      const code = row.rcCode.toUpperCase();
      const fromStore = uniqueSerials([
        ...row.storedSerials,
        ...(serialsByRc.get(row.uid) || []),
        ...(code ? serialsByRc.get(code) || [] : []),
      ]);
      const allotted = master
        ? uniqueSerials([...fromStore.filter(serial => !isMasterPoolSerial(serial)), ...masterRcPoolSerials()])
        : fromStore.filter(serial => !isMasterPoolSerial(serial));
      const ovUsed = usedByRc.get(row.uid) || { count: 0, serials: [] };
      let remaining = remainingQuotaSerials(allotted, ovUsed.serials, row.voidedSerials);
      if (!master) {
        const invoiced = uniqueSerials([
          ...(allotInvoicedByRc.get(row.uid) || []),
          ...(code ? allotInvoicedByRc.get(code) || [] : []),
          ...(batchInvoicedByRc.get(row.uid) || []),
          ...(code ? batchInvoicedByRc.get(code) || [] : []),
          ...(eventInvoicedByRc.get(row.uid) || []),
          ...(code ? eventInvoicedByRc.get(code) || [] : []),
        ]);
        remaining = serialsLinkedToInvoice(remaining, invoiced);
      }
      return {
        ...row,
        allotted,
        remaining,
        sold: master ? String(masterRcUnusedQty()) : row.ovQuota,
        used: String(ovUsed.count),
        serials: remaining,
      };
    });
  }, [allotInvoicedByRc, batchInvoicedByRc, eventInvoicedByRc, quotas, serialsByRc, usedByRc]);

  const openRow = useMemo(
    () => rows.find(row => row.uid === openUid) ?? null,
    [rows, openUid],
  );

  return (
    <div className="panel glass panel--table admin-setting-quota-panel" aria-label="RC quota">
      {error ? <div className="login-error">{error}</div> : null}
      {rows.length > 0 ? (
        <div className="admin-setting-yesone-table-wrap">
          <table className="admin-setting-yesone-table admin-setting-quota-table">
            <thead>
              <tr>
                <th>RC</th>
                <th>Allotted</th>
                <th>Used</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const balance = quotaBalanceValue(row.sold, row.used);
                const seatBalance = row.serials.length;
                const canOpen = row.allotted.length > 0 || seatBalance > 0 || row.voidedSerials.length > 0;
                return (
                  <tr key={row.uid}>
                    <td>
                      {row.companyName}
                      {row.rcCode ? <span className="admin-setting-yesone-sub">{row.rcCode}</span> : null}
                    </td>
                    <td>
                      <span className="text-mono admin-setting-quota-balance">
                        {displayNum(row.sold)}
                      </span>
                    </td>
                    <td>
                      <span className="text-mono admin-setting-quota-balance">
                        {displayNum(row.used)}
                      </span>
                    </td>
                    <td>
                      {canOpen ? (
                        <button
                          type="button"
                          className="admin-setting-quota-balance-btn"
                          onClick={() => setOpenUid(row.uid)}
                          aria-label={`Serial numbers for ${row.companyName}`}
                        >
                          {balance == null ? '—' : balance}
                        </button>
                      ) : (
                        <span className="text-mono admin-setting-quota-balance">
                          {balance == null ? '—' : balance}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {openRow ? (
        <SerialSeatOverlay
          companyName={openRow.companyName}
          rcCode={openRow.rcCode}
          serials={uniqueSerials([...openRow.serials, ...openRow.voidedSerials])}
          voidedSerials={openRow.voidedSerials}
          expectedCount={quotaBalanceValue(openRow.sold, openRow.used)}
          canVoid
          onToggleVoid={(serial, voided) => toggleVoidedSerial(openRow.uid, serial, voided)}
          onClose={() => setOpenUid('')}
        />
      ) : null}
    </div>
  );
}
