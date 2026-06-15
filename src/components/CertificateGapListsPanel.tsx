import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { buildDocaCertificateViewUrl } from '../lib/docaCertificateUrl';
import {
  exportCertificateMissingListExcel,
  exportCertificatePresentListExcel,
} from '../lib/docaCertificateExport';
import {
  buildCertificateGapReport,
  DEFAULT_CERTIFICATE_SEQUENCE_MAX,
  type CertificateGapReport,
} from '../lib/certificateSequence';
import type { DocaCertificateRecord } from '../lib/docaScraping';
import { TablePagination } from './TablePagination';
import { paginateItems } from '../lib/tablePagination';

const GAP_LIST_PAGE_SIZE = 100;

type CertificateGapListsPanelProps = {
  records: DocaCertificateRecord[];
  verificationCertificateNumbers: ReadonlySet<string>;
};

type GapListTab = 'missing' | 'present';

export const CertificateGapListsPanel: React.FC<CertificateGapListsPanelProps> = ({
  records,
  verificationCertificateNumbers,
}) => {
  const [tab, setTab] = useState<GapListTab>('missing');
  const [page, setPage] = useState(1);
  const [exportingMissing, setExportingMissing] = useState(false);
  const [exportingPresent, setExportingPresent] = useState(false);

  const report = useMemo<CertificateGapReport>(
    () => buildCertificateGapReport(records, verificationCertificateNumbers),
    [records, verificationCertificateNumbers],
  );

  const activeRows = tab === 'missing' ? report.missing : report.present;
  const paginatedRows = useMemo(
    () => paginateItems(activeRows, page, GAP_LIST_PAGE_SIZE),
    [activeRows, page],
  );
  const rowOffset = (page - 1) * GAP_LIST_PAGE_SIZE;

  useEffect(() => {
    setPage(1);
  }, [tab]);

  const handleExportMissing = () => {
    setExportingMissing(true);
    try {
      exportCertificateMissingListExcel(records, verificationCertificateNumbers);
    } finally {
      setExportingMissing(false);
    }
  };

  const handleExportPresent = () => {
    setExportingPresent(true);
    try {
      exportCertificatePresentListExcel(records, verificationCertificateNumbers);
    } finally {
      setExportingPresent(false);
    }
  };

  if (report.presentCount === 0 && report.missingCount === report.maxSequence) {
    return null;
  }

  return (
    <section className="doca-scraping-cert-gap panel glass panel--table">
      <div className="panel-header doca-scraping-cert-gap-header">
        <div>
          <h2>Certificate numbers 1–{DEFAULT_CERTIFICATE_SEQUENCE_MAX}</h2>
          <p className="doca-scraping-filter-hint text-muted text-sm mb-0">
            {report.presentCount} present · {report.missingCount} missing · highest present{' '}
            {report.highestPresent ?? '—'}
          </p>
        </div>
        <div className="doca-scraping-cert-gap-downloads">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={exportingMissing || report.missingCount === 0}
            onClick={handleExportMissing}
          >
            <Download size={16} aria-hidden />
            {exportingMissing ? 'Exporting…' : `Missing list (${report.missingCount})`}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={exportingPresent || report.presentCount === 0}
            onClick={handleExportPresent}
          >
            <Download size={16} aria-hidden />
            {exportingPresent ? 'Exporting…' : `All present (${report.presentCount})`}
          </button>
        </div>
      </div>

      <div className="panel-body doca-scraping-cert-gap-body">
        <div className="doca-scraping-cert-gap-tabs" role="tablist" aria-label="Certificate number lists">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'missing'}
            className={`doca-scraping-cert-gap-tab${tab === 'missing' ? ' is-active' : ''}`}
            onClick={() => setTab('missing')}
          >
            Missing ({report.missingCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'present'}
            className={`doca-scraping-cert-gap-tab${tab === 'present' ? ' is-active' : ''}`}
            onClick={() => setTab('present')}
          >
            Present ({report.presentCount})
          </button>
        </div>

        <TablePagination
          page={page}
          totalItems={activeRows.length}
          pageSize={GAP_LIST_PAGE_SIZE}
          onPageChange={setPage}
          placement="top"
        />

        <div className="table-scroll-wrap">
          <table className="data-table doca-scraping-cert-gap-table">
            <thead>
              <tr>
                <th className="doca-scraping-col-sno">S.No</th>
                <th>Sequence</th>
                <th>Certificate number</th>
                {tab === 'present' && <th>Source</th>}
                <th>DOCA</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row, index) => {
                const docaUrl = buildDocaCertificateViewUrl(row.certificateNumber);
                return (
                  <tr key={`${tab}-${row.sequence}`}>
                    <td className="text-mono-muted">{rowOffset + index + 1}</td>
                    <td className="text-mono">{row.sequence}</td>
                    <td className="text-mono">{row.certificateNumber}</td>
                    {tab === 'present' && 'source' in row && (
                      <td>{row.source === 'verification' ? 'Verification' : 'Scrape'}</td>
                    )}
                    <td>
                      {docaUrl ? (
                        <a href={docaUrl} target="_blank" rel="noopener noreferrer" className="text-sm">
                          Open
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={page}
          totalItems={activeRows.length}
          pageSize={GAP_LIST_PAGE_SIZE}
          onPageChange={setPage}
        />
      </div>
    </section>
  );
};
