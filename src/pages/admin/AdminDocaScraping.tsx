import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  FileText,
  Globe2,
  ImageIcon,
  Pause,
  Play,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  DEFAULT_AUTOMATION_WORKER_REMOTE,
  subscribeAutomationWorkerRemote,
} from '../../lib/automationWorker';
import {
  ensureDocaScrapeRemoteDefaults,
  pauseDocaScrape,
  resumeDocaScrape,
  startDocaScrape,
  subscribeDocaCertificates,
  subscribeDocaScrapeLogs,
  subscribeDocaScrapeStatus,
  type DocaCertificateRecord,
  type DocaScrapeLogEntry,
  type DocaScrapeStatus,
} from '../../lib/docaScraping';

function formatTimestamp(value: string): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function scrapeProgressPercent(status: DocaScrapeStatus | null): number {
  if (!status || status.totalPages <= 0) return 0;
  return Math.min(100, Math.round((status.currentPage / status.totalPages) * 100));
}

export const AdminDocaScraping: React.FC = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState<DocaCertificateRecord[]>([]);
  const [scrapeStatus, setScrapeStatus] = useState<DocaScrapeStatus | null>(null);
  const [logs, setLogs] = useState<DocaScrapeLogEntry[]>([]);
  const [remote, setRemote] = useState(DEFAULT_AUTOMATION_WORKER_REMOTE);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [listenerError, setListenerError] = useState('');

  const isRunning = scrapeStatus?.status === 'running';
  const isPaused = remote.scrapePause && isRunning;

  useEffect(() => {
    const onError = (err: Error) => setListenerError(err.message);
    const unsubscribers = [
      subscribeDocaCertificates(setRecords, onError),
      subscribeDocaScrapeStatus(setScrapeStatus, onError),
      subscribeDocaScrapeLogs(setLogs, onError),
      subscribeAutomationWorkerRemote(setRemote, onError),
    ];
    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    void ensureDocaScrapeRemoteDefaults(remote, user.uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize remote scrape fields once per session
  }, [user?.uid]);

  const filteredRecords = useMemo(() => {
    const queryText = search.trim().toLowerCase();
    if (!queryText) return records;
    return records.filter(record =>
      [
        record.generateCertificate,
        record.gatcCertificateNo,
        record.instrumentName,
        record.belongTo,
        record.validityDate,
        record.uploadDate,
      ]
        .join(' ')
        .toLowerCase()
        .includes(queryText),
    );
  }, [records, search]);

  const runRemoteAction = async (action: () => Promise<void>) => {
    if (!user?.uid) return;
    setError('');
    setSaving(true);
    try {
      await action();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not update scraper controls.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in page-content doca-scraping-page">
      <header className="doca-scraping-header">
        <div>
          <h1 className="doca-scraping-title">
            <Globe2 className="inline-icon" aria-hidden />
            DOCA Scraping
          </h1>
          <p className="text-muted text-sm mb-0">
            Bulk sync of GATC signed certificate PDFs and instrument photos from DOCA into Firebase — separate from verifications.
          </p>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}
      {listenerError && <p className="form-error">Live updates error: {listenerError}</p>}

      <section className="doca-scraping-controls panel glass">
        <div className="doca-scraping-controls-head">
          <div>
            <h2 className="doca-scraping-section-title">Scraper controls</h2>
            <p className="text-muted text-sm mb-0">
              Runs on the Certificate Worker in a second browser window (Chrome 2). Requires worker online and DOCA login.
            </p>
          </div>
          <div className="doca-scraping-control-buttons">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!user?.uid || saving || isRunning}
              onClick={() => void runRemoteAction(() => startDocaScrape(remote, user!.uid))}
            >
              <Play size={16} aria-hidden />
              Start full scrape
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!user?.uid || saving || !isRunning || remote.scrapePause}
              onClick={() => void runRemoteAction(() => pauseDocaScrape(remote, user!.uid))}
            >
              <Pause size={16} aria-hidden />
              Pause
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!user?.uid || saving || !remote.scrapePause}
              onClick={() => void runRemoteAction(() => resumeDocaScrape(remote, user!.uid))}
            >
              <RefreshCw size={16} aria-hidden />
              Resume
            </button>
          </div>
        </div>

        <div className="doca-scraping-progress">
          <div className="doca-scraping-progress-meta">
            <span className={`doca-scraping-status doca-scraping-status--${scrapeStatus?.status || 'idle'}`}>
              {(scrapeStatus?.status || 'idle').replace('_', ' ')}
              {isPaused ? ' (paused)' : ''}
            </span>
            <span className="text-muted text-sm">
              {scrapeStatus?.statusMessage || 'Waiting to start…'}
            </span>
          </div>
          <div className="doca-scraping-progress-bar" aria-hidden>
            <span style={{ width: `${scrapeProgressPercent(scrapeStatus)}%` }} />
          </div>
          <dl className="doca-scraping-stats">
            <div><dt>Page</dt><dd>{scrapeStatus?.currentPage ?? 0} / {scrapeStatus?.totalPages ?? 0}</dd></div>
            <div><dt>DOCA entries</dt><dd>{scrapeStatus?.totalEntries ?? 0}</dd></div>
            <div><dt>Processed</dt><dd>{scrapeStatus?.processedRows ?? 0}</dd></div>
            <div><dt>Uploaded</dt><dd>{scrapeStatus?.uploadedRows ?? 0}</dd></div>
            <div><dt>Skipped</dt><dd>{scrapeStatus?.skippedRows ?? 0}</dd></div>
            <div><dt>Failed</dt><dd>{scrapeStatus?.failedRows ?? 0}</dd></div>
            <div><dt>In Firebase</dt><dd>{records.length}</dd></div>
          </dl>
        </div>
      </section>

      <section className="doca-scraping-table panel glass panel--table">
        <div className="panel-header doca-scraping-table-header">
          <h2>Scraped certificates</h2>
          <label className="doca-scraping-search">
            <Search size={16} aria-hidden />
            <input
              className="input-field"
              placeholder="Search certificate, firm, instrument…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="panel-body doca-scraping-table-wrap">
          {filteredRecords.length === 0 ? (
            <p className="text-muted text-sm doca-scraping-empty">
              No scraped certificates yet. Start a scrape when the worker is online.
            </p>
          ) : (
            <table className="data-table doca-scraping-table">
              <thead>
                <tr>
                  <th>Certificate</th>
                  <th>Instrument</th>
                  <th>Belongs to</th>
                  <th>Validity</th>
                  <th>Upload date</th>
                  <th>Files</th>
                  <th>Scraped</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map(record => (
                  <tr key={record.id}>
                    <td>
                      <div className="doca-scraping-cert-cell">
                        <strong className="text-mono text-sm">{record.generateCertificate || '—'}</strong>
                        {record.gatcCertificateNo && (
                          <span className="text-muted text-sm">{record.gatcCertificateNo}</span>
                        )}
                      </div>
                    </td>
                    <td>{record.instrumentName || '—'}</td>
                    <td>{record.belongTo || '—'}</td>
                    <td className="text-mono text-sm">{record.validityDate || '—'}</td>
                    <td className="text-mono text-sm">{record.uploadDate || '—'}</td>
                    <td>
                      <div className="doca-scraping-file-links">
                        {record.certificatePdfUrl ? (
                          <a href={record.certificatePdfUrl} target="_blank" rel="noreferrer" className="doca-scraping-file-link">
                            <FileText size={14} aria-hidden />
                            PDF
                            <ExternalLink size={12} aria-hidden />
                          </a>
                        ) : (
                          <span className="text-muted text-sm">No PDF</span>
                        )}
                        {record.instrumentPhotoUrl ? (
                          <a href={record.instrumentPhotoUrl} target="_blank" rel="noreferrer" className="doca-scraping-file-link">
                            <ImageIcon size={14} aria-hidden />
                            Photo
                            <ExternalLink size={12} aria-hidden />
                          </a>
                        ) : (
                          <span className="text-muted text-sm">No photo</span>
                        )}
                      </div>
                    </td>
                    <td className="text-muted text-sm">{formatTimestamp(record.scrapedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="doca-scraping-logs panel glass">
        <div className="panel-header">
          <h2>Scrape activity</h2>
        </div>
        <div className="panel-body">
          {logs.length === 0 ? (
            <p className="text-muted text-sm mb-0">Scrape logs will appear here while the worker runs.</p>
          ) : (
            <ul className="doca-scraping-log-list">
              {logs.map(entry => (
                <li key={entry.id} className={`doca-scraping-log-item doca-scraping-log-item--${entry.level}`}>
                  <time>{formatTimestamp(entry.createdAt)}</time>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};
