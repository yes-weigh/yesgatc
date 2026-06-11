import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  FileSearch,
  FileText,
  Filter,
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
  ensureDocaEnrichRemoteDefaults,
  ensureDocaScrapeRemoteDefaults,
  listDocaCertificateNumbersMissingPdf,
  listDocaCertificatesMissingPdf,
  pauseDocaEnrich,
  pauseDocaScrape,
  resumeDocaEnrich,
  resumeDocaScrape,
  startDocaEnrich,
  startDocaScrape,
  subscribeDocaCertificates,
  subscribeDocaEnrichLogs,
  subscribeDocaEnrichStatus,
  subscribeDocaScrapeLogs,
  subscribeDocaScrapeStatus,
  subscribeVerificationCertificateNumbers,
  type DocaCertificateRecord,
  type DocaEnrichStatus,
  type DocaScrapeLogEntry,
  type DocaScrapeStatus,
} from '../../lib/docaScraping';
import {
  countDocaCertificatesInVerifications,
  isDocaCertificateInVerifications,
} from '../../lib/docaCertificateMatch';
import { TablePagination } from '../../components/TablePagination';
import {
  DOCA_SCRAPING_TABLE_PAGE_SIZE,
  paginateItems,
} from '../../lib/tablePagination';

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

function enrichProgressPercent(status: DocaEnrichStatus | null): number {
  if (!status || status.totalRows <= 0) return 0;
  return Math.min(100, Math.round((status.processedRows / status.totalRows) * 100));
}

function truncateAddress(value: string, maxLength = 48): string {
  if (!value) return '—';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export const AdminDocaScraping: React.FC = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState<DocaCertificateRecord[]>([]);
  const [scrapeStatus, setScrapeStatus] = useState<DocaScrapeStatus | null>(null);
  const [enrichStatus, setEnrichStatus] = useState<DocaEnrichStatus | null>(null);
  const [logs, setLogs] = useState<DocaScrapeLogEntry[]>([]);
  const [enrichLogs, setEnrichLogs] = useState<DocaScrapeLogEntry[]>([]);
  const [remote, setRemote] = useState(DEFAULT_AUTOMATION_WORKER_REMOTE);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [hideVerificationDuplicates, setHideVerificationDuplicates] = useState(false);
  const [scrapeStartPage, setScrapeStartPage] = useState('');
  const [verificationCertificateNumbers, setVerificationCertificateNumbers] = useState<Set<string>>(
    () => new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [listenerError, setListenerError] = useState('');

  const isRunning = scrapeStatus?.status === 'running';
  const isPaused = remote.scrapePause && isRunning;
  const isEnrichRunning = enrichStatus?.status === 'running';
  const isEnrichPaused = remote.enrichPause && isEnrichRunning;

  const parsedCount = useMemo(
    () => records.filter(record => record.pdfExtract?.parseStatus === 'ok').length,
    [records],
  );

  const missingPdfRecords = useMemo(() => listDocaCertificatesMissingPdf(records), [records]);
  const missingPdfNumbers = useMemo(() => listDocaCertificateNumbersMissingPdf(records), [records]);
  const docaReportedTotal = scrapeStatus?.totalEntries ?? 0;
  const estimatedNotInFirebase = Math.max(0, docaReportedTotal - records.length);

  useEffect(() => {
    const onError = (err: Error) => setListenerError(err.message);
    const unsubscribers = [
      subscribeDocaCertificates(setRecords, onError),
      subscribeDocaScrapeStatus(setScrapeStatus, onError),
      subscribeDocaEnrichStatus(setEnrichStatus, onError),
      subscribeDocaScrapeLogs(setLogs, onError),
      subscribeDocaEnrichLogs(setEnrichLogs, onError),
      subscribeAutomationWorkerRemote(setRemote, onError),
      subscribeVerificationCertificateNumbers(setVerificationCertificateNumbers, onError),
    ];
    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    void ensureDocaScrapeRemoteDefaults(user.uid);
    void ensureDocaEnrichRemoteDefaults(user.uid);
  }, [user?.uid]);

  const searchFilteredRecords = useMemo(() => {
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
        record.pdfExtract?.serialNumber,
        record.pdfExtract?.maxCapacity,
        record.pdfExtract?.verificationScaleIntervalE,
        record.pdfExtract?.ownerAddress,
        record.pdfExtract?.ownerName,
      ]
        .join(' ')
        .toLowerCase()
        .includes(queryText),
    );
  }, [records, search]);

  const verificationDuplicateCount = useMemo(
    () => countDocaCertificatesInVerifications(searchFilteredRecords, verificationCertificateNumbers),
    [searchFilteredRecords, verificationCertificateNumbers],
  );

  const filteredRecords = useMemo(() => {
    if (!hideVerificationDuplicates) {
      return searchFilteredRecords;
    }

    return searchFilteredRecords.filter(
      record => !isDocaCertificateInVerifications(record, verificationCertificateNumbers),
    );
  }, [hideVerificationDuplicates, searchFilteredRecords, verificationCertificateNumbers]);

  const paginatedRecords = useMemo(
    () => paginateItems(filteredRecords, page, DOCA_SCRAPING_TABLE_PAGE_SIZE),
    [filteredRecords, page],
  );

  const rowOffset = (page - 1) * DOCA_SCRAPING_TABLE_PAGE_SIZE;

  useEffect(() => {
    setPage(1);
  }, [search, hideVerificationDuplicates]);

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
            <label className="doca-scraping-start-page">
              <span className="text-muted text-sm">Start page</span>
              <input
                className="input-field"
                type="number"
                min={1}
                max={100}
                placeholder="1"
                value={scrapeStartPage}
                onChange={e => setScrapeStartPage(e.target.value)}
                disabled={isRunning}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!user?.uid || saving || isRunning}
              onClick={() => {
                const parsed = Number.parseInt(scrapeStartPage.trim(), 10);
                const startPage = Number.isFinite(parsed) && parsed > 1 ? parsed : undefined;
                void runRemoteAction(() => startDocaScrape(remote, user!.uid, { startPage }));
              }}
            >
              <Play size={16} aria-hidden />
              Start full scrape
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!user?.uid || saving || isRunning}
              onClick={() => {
                setScrapeStartPage('10');
                void runRemoteAction(() => startDocaScrape(remote, user!.uid, { startPage: 10 }));
              }}
              title="Skip pages 1–9 and scrape only the last page (entries 901–1000)"
            >
              <Play size={16} aria-hidden />
              Scrape page 10 only
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
            <div><dt>Missing PDF in Firebase</dt><dd>{missingPdfRecords.length}</dd></div>
            <div><dt>Not in Firebase (est.)</dt><dd>{docaReportedTotal > 0 ? estimatedNotInFirebase : '—'}</dd></div>
          </dl>
        </div>
      </section>

      {(records.length > 0 || docaReportedTotal > 0) && (
        <section className="doca-scraping-controls panel glass">
          <div className="panel-header">
            <h2>Sync gaps</h2>
          </div>
          <div className="panel-body">
            {docaReportedTotal > 0 && estimatedNotInFirebase > 0 && (
              <p className="text-muted text-sm">
                DOCA reports <strong>{docaReportedTotal}</strong> entries but Firebase has{' '}
                <strong>{records.length}</strong>. About <strong>{estimatedNotInFirebase}</strong> certificate
                {estimatedNotInFirebase === 1 ? '' : 's'} were never scraped — likely page 10 (entries 901–1000).
                Their numbers are not in Firebase yet, so they cannot be listed here.
              </p>
            )}
            {missingPdfNumbers.length > 0 ? (
              <>
                <p className="text-muted text-sm mb-0">
                  These {missingPdfNumbers.length} Firebase record{missingPdfNumbers.length === 1 ? '' : 's'} exist
                  but have no PDF uploaded:
                </p>
                <ul className="doca-scraping-gap-list">
                  {missingPdfNumbers.map(number => (
                    <li key={number} className="text-mono text-sm">{number}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted text-sm mb-0">
                All {records.length} Firebase records have a certificate PDF. The gap vs DOCA is unscrape rows, not
                missing PDFs within Firebase.
              </p>
            )}
          </div>
        </section>
      )}

      <section className="doca-scraping-controls panel glass">
        <div className="doca-scraping-controls-head">
          <div>
            <h2 className="doca-scraping-section-title">PDF enrich</h2>
            <p className="text-muted text-sm mb-0">
              Parse stored certificate PDFs for serial number, capacity, scale interval (e), and owner address. Runs on the worker without a browser.
            </p>
          </div>
          <div className="doca-scraping-control-buttons">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!user?.uid || saving || isEnrichRunning}
              onClick={() => void runRemoteAction(() => startDocaEnrich(remote, user!.uid))}
            >
              <FileSearch size={16} aria-hidden />
              Parse PDF details
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!user?.uid || saving || !isEnrichRunning || remote.enrichPause}
              onClick={() => void runRemoteAction(() => pauseDocaEnrich(remote, user!.uid))}
            >
              <Pause size={16} aria-hidden />
              Pause
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!user?.uid || saving || !remote.enrichPause}
              onClick={() => void runRemoteAction(() => resumeDocaEnrich(remote, user!.uid))}
            >
              <RefreshCw size={16} aria-hidden />
              Resume
            </button>
          </div>
        </div>

        <div className="doca-scraping-progress">
          <div className="doca-scraping-progress-meta">
            <span className={`doca-scraping-status doca-scraping-status--${enrichStatus?.status || 'idle'}`}>
              {(enrichStatus?.status || 'idle').replace('_', ' ')}
              {isEnrichPaused ? ' (paused)' : ''}
            </span>
            <span className="text-muted text-sm">
              {enrichStatus?.statusMessage || 'Waiting to start…'}
            </span>
          </div>
          <div className="doca-scraping-progress-bar" aria-hidden>
            <span style={{ width: `${enrichProgressPercent(enrichStatus)}%` }} />
          </div>
          <dl className="doca-scraping-stats">
            <div><dt>Total</dt><dd>{enrichStatus?.totalRows ?? 0}</dd></div>
            <div><dt>Processed</dt><dd>{enrichStatus?.processedRows ?? 0}</dd></div>
            <div><dt>Parsed</dt><dd>{enrichStatus?.parsedRows ?? 0}</dd></div>
            <div><dt>Skipped</dt><dd>{enrichStatus?.skippedRows ?? 0}</dd></div>
            <div><dt>Failed</dt><dd>{enrichStatus?.failedRows ?? 0}</dd></div>
            <div><dt>Parsed in Firebase</dt><dd>{parsedCount}</dd></div>
          </dl>
        </div>
      </section>

      <section className="doca-scraping-table panel glass panel--table">
        <div className="panel-header doca-scraping-table-header">
          <div>
            <h2>Scraped certificates</h2>
            {hideVerificationDuplicates && (
              <p className="doca-scraping-filter-hint text-muted text-sm mb-0">
                Showing {filteredRecords.length} not in site verifications
                {verificationDuplicateCount > 0
                  ? ` (${verificationDuplicateCount} hidden duplicate${verificationDuplicateCount === 1 ? '' : 's'})`
                  : ''}
              </p>
            )}
          </div>
          <div className="doca-scraping-table-toolbar">
            <button
              type="button"
              className={`btn btn-sm doca-scraping-filter-btn${hideVerificationDuplicates ? ' is-active' : ''}`}
              aria-pressed={hideVerificationDuplicates}
              onClick={() => setHideVerificationDuplicates(active => !active)}
            >
              <Filter size={16} aria-hidden />
              Hide duplicates from verification
            </button>
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
        </div>
        <div className="panel-body doca-scraping-table-wrap">
          {records.length === 0 ? (
            <p className="text-muted text-sm doca-scraping-empty">
              No scraped certificates yet. Start a scrape when the worker is online.
            </p>
          ) : filteredRecords.length === 0 ? (
            <p className="text-muted text-sm doca-scraping-empty">
              {hideVerificationDuplicates
                ? 'Every scraped certificate already has a matching certificate number in site verifications.'
                : 'No certificates match your search.'}
            </p>
          ) : (
            <>
              <TablePagination
                page={page}
                totalItems={filteredRecords.length}
                pageSize={DOCA_SCRAPING_TABLE_PAGE_SIZE}
                onPageChange={setPage}
                placement="top"
              />
              <table className="data-table doca-scraping-table">
                <thead>
                  <tr>
                    <th className="doca-scraping-col-sno">S.No</th>
                    <th>Certificate</th>
                    <th>Instrument</th>
                    <th>Belongs to</th>
                    <th>Serial</th>
                    <th>Max</th>
                    <th>e</th>
                    <th>Owner address</th>
                    <th>Parse</th>
                    <th>Validity</th>
                    <th>Upload date</th>
                    <th>Files</th>
                    <th>Scraped</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRecords.map((record, index) => (
                    <tr key={record.id}>
                      <td className="doca-scraping-col-sno text-muted text-sm">{rowOffset + index + 1}</td>
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
                      <td className="text-mono text-sm">{record.pdfExtract?.serialNumber || '—'}</td>
                      <td className="text-mono text-sm">{record.pdfExtract?.maxCapacity || '—'}</td>
                      <td className="text-mono text-sm">{record.pdfExtract?.verificationScaleIntervalE || '—'}</td>
                      <td className="text-sm" title={record.pdfExtract?.ownerAddress || undefined}>
                        {truncateAddress(record.pdfExtract?.ownerAddress || '')}
                      </td>
                      <td>
                        <span
                          className={`doca-scraping-parse-status doca-scraping-parse-status--${record.pdfExtract?.parseStatus || 'pending'}`}
                          title={record.pdfExtract?.parseError || undefined}
                        >
                          {record.pdfExtract?.parseStatus || 'pending'}
                        </span>
                      </td>
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
              <TablePagination
                page={page}
                totalItems={filteredRecords.length}
                pageSize={DOCA_SCRAPING_TABLE_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </section>

      <section className="doca-scraping-logs panel glass">
        <div className="panel-header">
          <h2>Enrich activity</h2>
        </div>
        <div className="panel-body">
          {enrichLogs.length === 0 ? (
            <p className="text-muted text-sm mb-0">Enrich logs will appear here while the worker parses PDFs.</p>
          ) : (
            <ul className="doca-scraping-log-list">
              {enrichLogs.map(entry => (
                <li key={entry.id} className={`doca-scraping-log-item doca-scraping-log-item--${entry.level}`}>
                  <time>{formatTimestamp(entry.createdAt)}</time>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ul>
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
