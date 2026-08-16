import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { Award, Download, Filter, Search, Upload, X } from 'lucide-react';
import { db } from '../../firebase';
import { TablePagination } from '../../components/TablePagination';
import { useHistoryOverlay } from '../../hooks/useHistoryOverlay';
import { useRcScope } from '../../lib/roleScope';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import { isVerificationCertifiedOnDoca } from '../../lib/verificationRequest';
import { inferVerificationSubject } from '../../lib/siteCalibrationProfileFields';
import { matchesVerificationSearch } from '../../lib/verificationListSearch';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import {
  certificateRequiresSignedUpload,
  certificateSignStatus,
  resolveCertificateDownloadUrl,
  uploadSignedCertificatePdf,
  type CertificateSignStatus,
} from '../../lib/signedCertificatePdf';
import type { Customer, FirestoreUserDoc, SiteCalibration } from '../../types';

type CertTypeFilter = 'all' | 'OV' | 'RV';
type CertStatusFilter = 'all' | CertificateSignStatus;

function certLocation(
  record: SiteCalibration,
  customersById: Map<string, Customer>,
  rcPlace: string,
): { place: string; district: string } {
  if (inferVerificationSubject(record) === 'self') {
    return { place: rcPlace, district: '' };
  }
  const customer = customersById.get(record.customerId?.trim() || '');
  return {
    place: customer?.address?.trim() || '',
    district: customer?.district?.trim() || '',
  };
}

function recordType(record: SiteCalibration): 'OV' | 'RV' {
  return record.verificationType === 'RV' ? 'RV' : 'OV';
}

export const Certificates: React.FC = () => {
  const { rcUid, actorUid, isVct, isRcAdmin } = useRcScope();
  const filterRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const signedInputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [customersById, setCustomersById] = useState<Map<string, Customer>>(() => new Map());
  const [rcPlace, setRcPlace] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<CertTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<CertStatusFilter>('all');
  const [signingRecord, setSigningRecord] = useState<SiteCalibration | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');

  const fetchRecords = useCallback(async () => {
    if (!rcUid) {
      setRecords([]);
      setCustomersById(new Map());
      setRcPlace('');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [calibSnap, customerSnap, rcSnap] = await Promise.all([
        getDocs(verificationRecordsQuery(db, rcUid, { isVct, actorUid })),
        getDocs(query(collection(db, 'customers'), where('rcId', '==', rcUid))),
        getDoc(doc(db, 'users', rcUid)),
      ]);
      setRecords(calibSnap.docs.map(d => ({ id: d.id, ...d.data() } as SiteCalibration)));
      setCustomersById(
        new Map(customerSnap.docs.map(d => [d.id, { id: d.id, ...d.data() } as Customer])),
      );
      const rc = rcSnap.data() as FirestoreUserDoc | undefined;
      setRcPlace(rc?.place?.trim() || '');
    } finally {
      setLoading(false);
    }
  }, [rcUid, isVct, actorUid]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (filterRef.current?.contains(event.target as Node)) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const issued = useMemo(
    () =>
      records
        .filter(isVerificationCertifiedOnDoca)
        .sort((a, b) => (b.certifiedAt || b.approvedAt || '').localeCompare(a.certifiedAt || a.approvedAt || '')),
    [records],
  );

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return issued.filter(record => {
      if (typeFilter !== 'all' && recordType(record) !== typeFilter) return false;
      const signStatus = certificateSignStatus(record);
      if (statusFilter !== 'all' && signStatus !== statusFilter) return false;
      if (!q) return true;
      if (matchesVerificationSearch(record, searchTerm)) return true;
      const loc = certLocation(record, customersById, rcPlace);
      return [loc.place, loc.district].join(' ').toLowerCase().includes(q);
    });
  }, [issued, searchTerm, typeFilter, statusFilter, customersById, rcPlace]);

  useEffect(() => {
    setPage(1);
  }, [filtered.length, searchTerm, typeFilter, statusFilter]);

  const pageRows = useMemo(
    () => paginateItems(filtered, page, VERIFICATION_TABLE_PAGE_SIZE),
    [filtered, page],
  );
  const rowOffset = (page - 1) * VERIFICATION_TABLE_PAGE_SIZE;
  const filterActive = typeFilter !== 'all' || statusFilter !== 'all';
  const searchVisible = searchOpen || Boolean(searchTerm.trim());

  const closeSigning = useCallback(() => {
    if (uploading) return;
    setSigningRecord(null);
    setUploadError('');
    setUploadProgress(0);
  }, [uploading]);

  useHistoryOverlay(Boolean(signingRecord), closeSigning);

  const handleDownload = (record: SiteCalibration) => {
    const href = resolveCertificateDownloadUrl(record);
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
    if (isRcAdmin && certificateRequiresSignedUpload(record)) {
      setUploadError('');
      setSigningRecord(record);
    }
  };

  const handleSignedFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !signingRecord) return;
    setUploading(true);
    setUploadError('');
    setUploadProgress(0);
    try {
      const patch = await uploadSignedCertificatePdf(signingRecord.id, file, setUploadProgress);
      setRecords(prev =>
        prev.map(row => (row.id === signingRecord.id ? { ...row, ...patch } : row)),
      );
      setSigningRecord(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="fade-in wl-cert-page">
      <section className="wl-section" aria-label="Certificates">
        <div className="wl-cert-toolbar">
          <div className="wl-cert-toolbar__pager">
            {!loading && filtered.length > 0 ? (
              <TablePagination
                page={page}
                totalItems={filtered.length}
                pageSize={VERIFICATION_TABLE_PAGE_SIZE}
                onPageChange={setPage}
                placement="top"
              />
            ) : null}
          </div>
          <div className="wl-cert-toolbar__actions">
            <button
              type="button"
              className={`wl-cert-icon-btn${searchVisible ? ' wl-cert-icon-btn--on' : ''}`}
              aria-label="Search certificates"
              aria-pressed={searchVisible}
              onClick={() => {
                setSearchOpen(open => !open);
                setFilterOpen(false);
              }}
            >
              <Search size={18} strokeWidth={2} aria-hidden />
            </button>
            <div className="wl-cert-filter" ref={filterRef}>
              <button
                type="button"
                className={`wl-cert-filter-btn${filterOpen || filterActive ? ' wl-cert-filter-btn--on' : ''}`}
                aria-label="Filter certificates"
                aria-expanded={filterOpen}
                onClick={() => {
                  setFilterOpen(open => !open);
                  setSearchOpen(false);
                }}
              >
                <Filter size={16} strokeWidth={2} aria-hidden />
                Filter
              </button>
              {filterOpen ? (
                <div className="wl-cert-filter__pop" role="dialog" aria-label="Certificate filters">
                  <label className="wl-cert-filter__label" htmlFor="wl-cert-type">
                    Type
                  </label>
                  <select
                    id="wl-cert-type"
                    className="wl-cert-filter__select"
                    value={typeFilter}
                    onChange={event => setTypeFilter(event.target.value as CertTypeFilter)}
                  >
                    <option value="all">All</option>
                    <option value="OV">OV</option>
                    <option value="RV">RV</option>
                  </select>
                  <label className="wl-cert-filter__label" htmlFor="wl-cert-status">
                    Status
                  </label>
                  <select
                    id="wl-cert-status"
                    className="wl-cert-filter__select"
                    value={statusFilter}
                    onChange={event => setStatusFilter(event.target.value as CertStatusFilter)}
                  >
                    <option value="all">All</option>
                    <option value="signed">Signed</option>
                    <option value="not_signed">Not signed</option>
                    <option value="voided">Voided</option>
                  </select>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {searchVisible ? (
          <div className="search-wrap wl-cert-search">
            <Search size={16} className="search-icon" aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              className="search-input"
              placeholder="Search certificate no, name, place…"
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              aria-label="Search certificates"
            />
          </div>
        ) : null}
        {loading ? (
          <div className="wl-recent__loading">
            <span className="spinner-inline" aria-hidden />
          </div>
        ) : issued.length === 0 ? (
          <div className="wl-recent__empty">
            <Award size={28} strokeWidth={1.6} aria-hidden />
            <p>No certificates issued yet.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="wl-recent__empty">
            <p>No certificates match search or filter.</p>
          </div>
        ) : (
          <>
            <div className="table-scroll-wrap">
              <table className="wl-cert-table">
                <colgroup>
                  <col className="wl-cert-col-sl" />
                  <col className="wl-cert-col-cert" />
                  <col className="wl-cert-col-name" />
                  <col className="wl-cert-col-status" />
                  <col className="wl-cert-col-dl" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Sl</th>
                    <th>Certificate No.</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Download</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((record, index) => {
                    const href = resolveCertificateDownloadUrl(record);
                    const certNo = record.certificateNumber?.trim() || '—';
                    const loc = certLocation(record, customersById, rcPlace);
                    const signStatus = certificateSignStatus(record);
                    const placeLine = [loc.place, loc.district].filter(Boolean).join(', ');
                    return (
                      <tr key={record.id}>
                        <td className="wl-cert-table__sl">{rowOffset + index + 1}</td>
                        <td className="wl-cert-table__cert">
                          <span className="wl-cert-table__no">{certNo}</span>
                          <span className="wl-cert-table__sub">
                            {formatVerificationListDate(record.certifiedAt || record.approvedAt)}
                            {record.serialNumber?.trim() ? (
                              <>
                                <span className="wl-cert-table__sep" aria-hidden>
                                  ·
                                </span>
                                {record.serialNumber.trim()}
                              </>
                            ) : null}
                          </span>
                        </td>
                        <td className="wl-cert-table__name">
                          <span className="wl-cert-table__primary">
                            {record.customerName?.trim() || '—'}
                          </span>
                          {placeLine ? <span className="wl-cert-table__sub">{placeLine}</span> : null}
                        </td>
                        <td>
                          <span
                            className={`wl-cert-table__badge${
                              signStatus === 'voided'
                                ? ' wl-cert-table__badge--void'
                                : signStatus === 'not_signed'
                                  ? ' wl-cert-table__badge--unsigned'
                                  : ''
                            }`}
                          >
                            {signStatus === 'voided'
                              ? 'Voided'
                              : signStatus === 'signed'
                                ? 'Signed'
                                : (
                                  <>
                                    Not
                                    <br />
                                    signed
                                  </>
                                )}
                          </span>
                        </td>
                        <td className="wl-cert-table__dl">
                          {href ? (
                            <button
                              type="button"
                              className="wl-recent__download"
                              onClick={() => handleDownload(record)}
                              aria-label={`Download certificate ${certNo}`}
                              title="Download PDF"
                            >
                              <Download size={18} strokeWidth={2} aria-hidden />
                            </button>
                          ) : (
                            <span
                              className="wl-recent__download wl-recent__download--disabled"
                              aria-hidden
                            >
                              <Download size={18} strokeWidth={2} />
                            </span>
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
              totalItems={filtered.length}
              pageSize={VERIFICATION_TABLE_PAGE_SIZE}
              onPageChange={setPage}
            />
          </>
        )}
      </section>
      {signingRecord && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="modal-overlay"
              onClick={() => closeSigning()}
            >
              <div
                className="modal-dialog wl-cert-sign-dialog glass"
                role="dialog"
                aria-labelledby="wl-cert-sign-title"
                onClick={event => event.stopPropagation()}
              >
                <div className="wl-cert-sign-dialog__head">
                  <h2 id="wl-cert-sign-title">Upload signed PDF</h2>
                  <button
                    type="button"
                    className="wl-cert-icon-btn"
                    onClick={closeSigning}
                    disabled={uploading}
                    aria-label="Close"
                  >
                    <X size={18} strokeWidth={2} />
                  </button>
                </div>
                <p className="wl-cert-sign-dialog__copy">
                  Download the certificate, apply your Digital Signature (DSC), then upload the
                  signed PDF. Status changes to Signed only after upload.
                </p>
                <p className="wl-cert-sign-dialog__cert">
                  {signingRecord.certificateNumber?.trim() || '—'}
                </p>
                {uploadError ? <p className="form-error mb-3">{uploadError}</p> : null}
                <input
                  ref={signedInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  onChange={event => void handleSignedFile(event)}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={uploading}
                  onClick={() => signedInputRef.current?.click()}
                >
                  <Upload size={16} aria-hidden />
                  {uploading ? `Uploading ${uploadProgress}%` : 'Upload signed PDF'}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
