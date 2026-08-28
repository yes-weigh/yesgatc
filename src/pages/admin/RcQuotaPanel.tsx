import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { callableErrorMessage } from '../../lib/zohoRvInvoice';
import { syncYesoneOvUsed } from '../../lib/yesoneWebhookClient';
import {
  IWP_USED_FROM_DATE,
  isMasterRcCode,
  masterRcPoolSerials,
  remainingQuotaSerials,
  rcOvUsedFromRecords,
  toggleVoidedSerial,
} from '../../lib/rcMasterQuota';
import { parseQuotaInput, uniqueSerials, unusedSerials, yesoneSerialFromDoc } from '../../lib/yesoneInboundData';
import type { SiteCalibration } from '../../types';
import { SerialSeatOverlay } from './SerialSeatOverlay';

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

function quotaBalance(quota: string, used: string): string {
  const value = quotaBalanceValue(quota, used);
  return value == null ? '—' : String(value);
}

function qtyMismatch(quota: string, used: string, serialCount: number): boolean {
  const balance = quotaBalanceValue(quota, used);
  if (balance == null) return serialCount > 0;
  return balance !== serialCount;
}

function displayNum(value: string): string {
  return value.trim() || '—';
}

function sortQuotaRows(a: QuotaRow, b: QuotaRow): number {
  const aMaster = isMasterRcCode(a.rcCode);
  const bMaster = isMasterRcCode(b.rcCode);
  if (aMaster !== bMaster) return aMaster ? -1 : 1;
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
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [serialsByRc, setSerialsByRc] = useState<Map<string, string[]>>(new Map());
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
    () => quotas.find(row => isMasterRcCode(row.rcCode))?.uid || '',
    [quotas],
  );

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
        for (const item of snap.docs) {
          const row = yesoneSerialFromDoc(item.id, item.data());
          if (row.status === 'cancelled' || row.status === 'replaced') continue;
          const keys = [row.rcId, row.rcCode.toUpperCase()].filter(Boolean);
          for (const key of keys) {
            const list = byKey.get(key) || [];
            list.push(row.serialNumber);
            byKey.set(key, list);
          }
        }
        setSerialsByRc(byKey);
      },
      () => setSerialsByRc(new Map()),
    );

    return () => {
      unsubRcs();
      unsubAllot();
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
    const masterPool = masterRcPoolSerials();
    const takenByOthers: string[] = [];
    for (const row of quotas) {
      if (isMasterRcCode(row.rcCode)) continue;
      const code = row.rcCode.toUpperCase();
      takenByOthers.push(
        ...row.storedSerials,
        ...(serialsByRc.get(row.uid) || []),
        ...(code ? serialsByRc.get(code) || [] : []),
      );
    }
    return quotas.map(row => {
      const code = row.rcCode.toUpperCase();
      const fromStore = uniqueSerials([
        ...row.storedSerials,
        ...(serialsByRc.get(row.uid) || []),
        ...(code ? serialsByRc.get(code) || [] : []),
      ]);
      const master = isMasterRcCode(row.rcCode);
      const allotted = master
        ? unusedSerials(masterPool, takenByOthers)
        : fromStore;
      const ovUsed = usedByRc.get(row.uid) || { count: 0, serials: [] };
      const remaining = remainingQuotaSerials(allotted, ovUsed.serials, row.voidedSerials);
      const sold = master
        ? (allotted.length ? String(allotted.length) : row.ovQuota)
        : row.ovQuota;
      const used = String(ovUsed.count);
      return {
        ...row,
        allotted,
        remaining,
        sold,
        used,
        serials: remaining,
      };
    });
  }, [quotas, serialsByRc, usedByRc]);

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
                const balance = quotaBalance(row.sold, row.used);
                const mismatch = qtyMismatch(row.sold, row.used, row.serials.length);
                const canOpen = row.allotted.length > 0 || mismatch;
                const bad = mismatch ? ' admin-setting-qty--bad' : '';
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
                          className={`admin-setting-quota-balance-btn${bad}`}
                          onClick={() => setOpenUid(row.uid)}
                          aria-label={`Serial numbers for ${row.companyName}`}
                        >
                          {balance}
                        </button>
                      ) : (
                        <span className={`text-mono admin-setting-quota-balance${bad}`}>{balance}</span>
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
