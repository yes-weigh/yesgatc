import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { X } from 'lucide-react';
import { db } from '../../firebase';
import {
  uniqueSerials,
  unusedSerials,
  yesoneSerialFromDoc,
  type YesoneSerialAllotment,
} from '../../lib/yesoneInboundData';

type RcRow = {
  uid: string;
  companyName: string;
  rcCode: string;
  storedSerials: string[];
};

type SerialRow = RcRow & { serials: string[] };

export function SerialNumberPanel() {
  const [rcs, setRcs] = useState<RcRow[]>([]);
  const [allotments, setAllotments] = useState<YesoneSerialAllotment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openUid, setOpenUid] = useState('');
  const [unused, setUnused] = useState<string[]>([]);
  const [unusedLoading, setUnusedLoading] = useState(false);
  const [unusedError, setUnusedError] = useState('');

  useEffect(() => {
    const unsubRcs = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'rc_admin')),
      snap => {
        setRcs(
          snap.docs
            .map(item => {
              const data = item.data();
              return {
                uid: item.id,
                companyName: String(data.companyName || data.username || 'RC').trim(),
                rcCode: String(data.rcCode || '').trim(),
                storedSerials: uniqueSerials(data.yesoneAllottedSerials),
              };
            })
            .sort((a, b) => a.companyName.localeCompare(b.companyName)),
        );
        setLoading(false);
      },
      () => {
        setError('Could not load RC centres.');
        setLoading(false);
      },
    );

    const unsubAllot = onSnapshot(
      collection(db, 'serialAllotments'),
      snap => {
        setAllotments(
          snap.docs
            .map(item => yesoneSerialFromDoc(item.id, item.data()))
            .filter(row => row.status !== 'cancelled' && row.status !== 'replaced'),
        );
      },
      () => {
        setAllotments([]);
      },
    );

    return () => {
      unsubRcs();
      unsubAllot();
    };
  }, []);

  const rows = useMemo((): SerialRow[] => {
    return rcs.map(rc => {
      const code = rc.rcCode.toUpperCase();
      const fromAllotment = allotments
        .filter(item => item.rcId === rc.uid || (code && item.rcCode.toUpperCase() === code))
        .map(item => item.serialNumber);
      return {
        ...rc,
        serials: uniqueSerials([...rc.storedSerials, ...fromAllotment]),
      };
    });
  }, [rcs, allotments]);

  const openRow = useMemo(
    () => rows.find(row => row.uid === openUid) ?? null,
    [rows, openUid],
  );

  useEffect(() => {
    if (!openRow) {
      setUnused([]);
      setUnusedError('');
      setUnusedLoading(false);
      return;
    }

    let cancelled = false;
    setUnusedLoading(true);
    setUnusedError('');
    setUnused([]);

    void (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'siteCalibrations'), where('rcId', '==', openRow.uid)),
        );
        if (cancelled) return;
        const used = uniqueSerials(snap.docs.map(item => item.data().serialNumber));
        setUnused(unusedSerials(openRow.serials, used));
      } catch {
        if (!cancelled) setUnusedError('Could not load unused serial numbers.');
      } finally {
        if (!cancelled) setUnusedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openRow]);

  useEffect(() => {
    if (!openUid) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenUid('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openUid]);

  return (
    <div className="panel glass" aria-label="Serial number">
      {error ? <div className="login-error">{error}</div> : null}
      {!loading && rows.length > 0 ? (
        <div className="admin-setting-yesone-table-wrap">
          <table className="admin-setting-yesone-table">
            <thead>
              <tr>
                <th>RC</th>
                <th>Serial number</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.uid}>
                  <td>
                    {row.companyName}
                    {row.rcCode ? <span className="admin-setting-yesone-sub">{row.rcCode}</span> : null}
                  </td>
                  <td>
                    <div className="admin-setting-serial-cell">
                      <span className="text-mono admin-setting-serial-list">
                        {row.serials.length > 0 ? row.serials.join('\n') : '—'}
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm admin-setting-serial-unused-btn"
                        onClick={() => setOpenUid(row.uid)}
                      >
                        Unused
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {openRow
        ? createPortal(
            <div
              className="rv-payment-overlay"
              role="presentation"
              onClick={() => setOpenUid('')}
            >
              <div
                className="rv-payment-panel glass admin-setting-serial-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="unused-serial-title"
                onClick={event => event.stopPropagation()}
              >
                <header className="rv-payment-panel-head">
                  <div className="rv-payment-panel-title-wrap">
                    <h2 id="unused-serial-title" className="rv-payment-panel-title">
                      Unused serial numbers
                    </h2>
                  </div>
                  <button
                    type="button"
                    className="rv-payment-panel-close"
                    onClick={() => setOpenUid('')}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </header>
                <p className="admin-setting-yesone-sub">
                  {openRow.companyName}
                  {openRow.rcCode ? ` · ${openRow.rcCode}` : ''}
                </p>
                {unusedError ? <div className="login-error">{unusedError}</div> : null}
                {unusedLoading ? <p className="text-muted text-sm">Loading…</p> : null}
                {!unusedLoading && !unusedError && unused.length === 0 ? (
                  <p className="text-muted text-sm">No unused serial numbers.</p>
                ) : null}
                {unused.length > 0 ? (
                  <ul className="admin-setting-serial-unused-list">
                    {unused.map(serial => (
                      <li key={serial} className="text-mono">{serial}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
