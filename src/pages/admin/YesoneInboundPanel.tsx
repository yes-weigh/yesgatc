import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  mergeYesonePlainLogs,
  yesonePlainLogsFromEventDoc,
  yesonePlainLogsFromLast,
  type YesonePlainLogRow,
} from '../../lib/yesoneInboundData';

function splitWhen(iso: string): { date: string; time: string } {
  if (!iso) return { date: '—', time: '—' };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: iso, time: '—' };
  return {
    date: date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    time: date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

export function YesoneInboundPanel() {
  const { appSettings } = useAppSettings();
  const [eventLogs, setEventLogs] = useState<YesonePlainLogRow[]>([]);

  useEffect(() => {
    return onSnapshot(
      collection(db, 'yesoneInboundEvents'),
      snap => {
        setEventLogs(snap.docs.flatMap(item => yesonePlainLogsFromEventDoc(item.id, item.data())));
      },
      () => {
        setEventLogs([]);
      },
    );
  }, []);

  const rows = useMemo(() => {
    const fromSettings = appSettings.yesoneInboundLogs.length > 0
      ? appSettings.yesoneInboundLogs
      : yesonePlainLogsFromLast(appSettings.yesoneLastInboundLog);
    return mergeYesonePlainLogs(fromSettings, eventLogs);
  }, [appSettings.yesoneInboundLogs, appSettings.yesoneLastInboundLog, eventLogs]);

  return (
    <div className="panel glass" aria-label="Yesone">
      <div className="admin-setting-yesone-table-wrap">
        <table className="admin-setting-yesone-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Status</th>
              <th>Event</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const when = splitWhen(row.at);
              return (
                <tr key={`${row.at}|${row.event}|${row.id}`}>
                  <td>{when.date}</td>
                  <td className="text-mono">{when.time}</td>
                  <td>
                    <span className={row.ok ? 'admin-setting-yesone-status--ok' : 'admin-setting-yesone-status--fail'}>
                      {row.ok ? 'ok' : 'failed'}
                    </span>
                  </td>
                  <td className="text-mono">{row.event}</td>
                  <td className="admin-setting-serial-list">{row.detail || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
