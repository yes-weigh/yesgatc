import React, { useCallback, useRef, useState } from 'react';
import { Download, FileSearch, Pause, RefreshCw } from 'lucide-react';
import type { DocaCertificateRecord } from '../lib/docaScraping';
import {
  runBrowserPdfEnrich,
  type BrowserPdfEnrichProgress,
} from '../lib/docaCertificateEnrichClient';

function formatTimestamp(value: string): string {
  if (!value) return '—';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

function enrichProgressPercent(status: BrowserPdfEnrichProgress | null): number {
  if (!status || status.totalRows <= 0) return 0;
  return Math.min(100, Math.round((status.processedRows / status.totalRows) * 100));
}

type DocaBrowserEnrichPanelProps = {
  records: DocaCertificateRecord[];
  parsedCount: number;
  onExportExcel?: () => void;
  exportDisabled?: boolean;
};

export const DocaBrowserEnrichPanel: React.FC<DocaBrowserEnrichPanelProps> = ({
  records,
  parsedCount,
  onExportExcel,
  exportDisabled = false,
}) => {
  const [progress, setProgress] = useState<BrowserPdfEnrichProgress | null>(null);
  const [includeAlreadyParsed, setIncludeAlreadyParsed] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef(false);
  const runningRef = useRef(false);

  const isRunning = progress?.status === 'running';
  const isPaused = progress?.status === 'paused';

  const handleStart = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    setError('');

    try {
      await runBrowserPdfEnrich({
        records,
        includeAlreadyParsed,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Browser PDF parse failed.');
    } finally {
      runningRef.current = false;
    }
  }, [records, includeAlreadyParsed]);

  const handlePause = () => {
    cancelRef.current = true;
  };

  const handleResume = () => {
    void handleStart();
  };

  const pdfReadyCount = records.filter(
    record => record.certificatePdfPath.trim() || record.certificatePdfUrl.trim(),
  ).length;

  return (
    <section className="doca-scraping-controls panel glass">
      <div className="doca-scraping-controls-head">
        <div>
          <h2 className="doca-scraping-section-title">PDF parse (browser)</h2>
          <p className="text-muted text-sm mb-0">
            Download stored certificate PDFs and extract serial, capacity, e, and owner fields.
            Runs in this browser — no remote worker.
          </p>
        </div>
        <div className="doca-scraping-control-buttons">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pdfReadyCount === 0 || isRunning}
            onClick={() => void handleStart()}
          >
            <FileSearch size={16} aria-hidden />
            Parse PDF details
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!isRunning}
            onClick={handlePause}
          >
            <Pause size={16} aria-hidden />
            Pause
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!isPaused}
            onClick={handleResume}
          >
            <RefreshCw size={16} aria-hidden />
            Resume
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={exportDisabled || !onExportExcel}
            onClick={onExportExcel}
            title="Download all certificate details and PDF URLs as Excel"
          >
            <Download size={16} aria-hidden />
            Download Excel
          </button>
        </div>
      </div>

      <label className="doca-browser-enrich-option text-sm">
        <input
          type="checkbox"
          checked={includeAlreadyParsed}
          disabled={isRunning}
          onChange={event => setIncludeAlreadyParsed(event.target.checked)}
        />
        Re-parse certificates already marked ok at current parser version
      </label>

      {error && <p className="doca-scraping-error text-sm">{error}</p>}

      <div className="doca-scraping-progress">
        <div className="doca-scraping-progress-meta">
          <span className={`doca-scraping-status doca-scraping-status--${progress?.status || 'idle'}`}>
            {(progress?.status || 'idle').replace('_', ' ')}
            {isPaused ? ' (paused)' : ''}
          </span>
          <span className="text-muted text-sm">
            {progress?.statusMessage || `Ready — ${pdfReadyCount} PDF${pdfReadyCount === 1 ? '' : 's'} available`}
          </span>
        </div>
        <div className="doca-scraping-progress-bar" aria-hidden>
          <span style={{ width: `${enrichProgressPercent(progress)}%` }} />
        </div>
        <dl className="doca-scraping-stats">
          <div><dt>Total</dt><dd>{progress?.totalRows ?? 0}</dd></div>
          <div><dt>Processed</dt><dd>{progress?.processedRows ?? 0}</dd></div>
          <div><dt>Parsed</dt><dd>{progress?.parsedRows ?? 0}</dd></div>
          <div><dt>Skipped</dt><dd>{progress?.skippedRows ?? 0}</dd></div>
          <div><dt>Failed</dt><dd>{progress?.failedRows ?? 0}</dd></div>
          <div><dt>Parsed in Firebase</dt><dd>{parsedCount}</dd></div>
        </dl>

        {progress?.lastProcessed?.certificate && (
          <div className="doca-enrich-last-processed">
            <div className="doca-enrich-last-processed-head">
              <h3 className="doca-enrich-last-processed-title">Last processed PDF</h3>
              <span
                className={`doca-enrich-last-action doca-enrich-last-action--${progress.lastProcessed.action || 'parsed'}`}
              >
                {progress.lastProcessed.action || 'parsed'}
              </span>
            </div>
            <p className="doca-enrich-last-cert text-mono text-sm">
              {progress.lastProcessed.certificate}
            </p>
            {progress.lastProcessed.processedAt && (
              <p className="text-muted text-sm mb-0">
                {formatTimestamp(progress.lastProcessed.processedAt)}
              </p>
            )}
            {progress.lastProcessed.action === 'skipped' ? (
              <p className="text-muted text-sm doca-enrich-last-note mb-0">
                Already parsed at the current parser version — no new fields written.
              </p>
            ) : progress.lastProcessed.pdfExtract ? (
              <dl className="doca-enrich-last-fields">
                <div>
                  <dt>Parse</dt>
                  <dd>
                    <span
                      className={`doca-scraping-parse-status doca-scraping-parse-status--${progress.lastProcessed.pdfExtract.parseStatus || 'pending'}`}
                    >
                      {progress.lastProcessed.pdfExtract.parseStatus || 'pending'}
                    </span>
                  </dd>
                </div>
                <div><dt>Serial</dt><dd className="text-mono">{progress.lastProcessed.pdfExtract.serialNumber || '—'}</dd></div>
                <div><dt>Max</dt><dd className="text-mono">{progress.lastProcessed.pdfExtract.maxCapacity || '—'}</dd></div>
                <div><dt>e</dt><dd className="text-mono">{progress.lastProcessed.pdfExtract.verificationScaleIntervalE || '—'}</dd></div>
                <div><dt>Model</dt><dd>{progress.lastProcessed.pdfExtract.manufacturerModel || '—'}</dd></div>
                <div><dt>Owner</dt><dd>{progress.lastProcessed.pdfExtract.ownerName || '—'}</dd></div>
                <div className="doca-enrich-last-field-wide">
                  <dt>Address</dt>
                  <dd>{progress.lastProcessed.pdfExtract.ownerAddress || '—'}</dd>
                </div>
                <div><dt>Phone</dt><dd className="text-mono">{progress.lastProcessed.pdfExtract.ownerPhone || '—'}</dd></div>
                <div><dt>Verified</dt><dd className="text-mono">{progress.lastProcessed.pdfExtract.verificationDate || '—'}</dd></div>
                <div><dt>Next due</dt><dd className="text-mono">{progress.lastProcessed.pdfExtract.nextVerificationDue || '—'}</dd></div>
                {progress.lastProcessed.pdfExtract.parseError && (
                  <div className="doca-enrich-last-field-wide">
                    <dt>Error</dt>
                    <dd className="doca-enrich-last-error">{progress.lastProcessed.pdfExtract.parseError}</dd>
                  </div>
                )}
              </dl>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
};
