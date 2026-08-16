import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { Award, Filter, Search, Share2 } from 'lucide-react';
import { db } from '../../firebase';
import { TablePagination } from '../../components/TablePagination';
import { CertificatePdfShareViewer } from '../../components/CertificatePdfShareViewer';
import { useRcScope, useRoleBasePath } from '../../lib/roleScope';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import { isVerificationCertifiedOnDoca } from '../../lib/verificationRequest';
import { inferVerificationSubject } from '../../lib/siteCalibrationProfileFields';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import {
  certificateSignStatus,
  resolveCertificateDownloadUrl,
  resolveCertificatePdfFileUrl,
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

function compactSearchToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s/-]+/g, '');
}

/** RC certificates search: full certificate number or machine serial only. */
function matchesCertificateOrMachine(record: SiteCalibration, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const qCompact = compactSearchToken(q);
  const cert = record.certificateNumber?.trim().toLowerCase() ?? '';
  const certTail = cert.split('/').pop() ?? '';
  const serial = record.serialNumber?.trim().toLowerCase() ?? '';

  if (cert.includes(q) || compactSearchToken(cert).includes(qCompact)) return true;
  if (certTail === q || certTail.startsWith(q)) return true;
  if (serial.includes(q) || compactSearchToken(serial).includes(qCompact)) return true;
  return false;
}

export const Certificates: React.FC = () => {
  const { rcUid, actorUid, isVct } = useRcScope();
  const basePath = useRoleBasePath();
  const navigate = useNavigate();
  const filterRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  const [viewingRecord, setViewingRecord] = useState<SiteCalibration | null>(null);

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
    return issued.filter(record => {
      if (typeFilter !== 'all' && recordType(record) !== typeFilter) return false;
      const signStatus = certificateSignStatus(record);
      if (statusFilter !== 'all' && signStatus !== statusFilter) return false;
      return matchesCertificateOrMachine(record, searchTerm);
    });
  }, [issued, searchTerm, typeFilter, statusFilter]);

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

  const openSignPage = (record: SiteCalibration) => {
    navigate(`${basePath}/certificates/${record.id}`);
  };

  const handlePhoneShare = (record: SiteCalibration, event: React.MouseEvent) => {
    event.stopPropagation();
    const href = resolveCertificateDownloadUrl(record);
    if (!href) return;
    setViewingRecord(record);
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
              placeholder="Certificate no or machine no"
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
            <ul className="wl-cert-cards wl-cert-phone">
                {pageRows.map((record, index) => {
                  const href = resolveCertificateDownloadUrl(record);
                  const certNo = record.certificateNumber?.trim() || '—';
                  const loc = certLocation(record, customersById, rcPlace);
                  const signStatus = certificateSignStatus(record);
                  const placeLine = [loc.place, loc.district].filter(Boolean).join(', ');
                  return (
                    <li key={record.id}>
                      <article className="wl-cert-card">
                        <button
                          type="button"
                          className="wl-cert-card__main"
                          onClick={() => openSignPage(record)}
                        >
                          <span className="wl-cert-card__sl">{rowOffset + index + 1}</span>
                          <span className="wl-cert-card__body">
                            <span className="wl-cert-card__no">{certNo}</span>
                            <span className="wl-cert-card__name">
                              {record.customerName?.trim() || '—'}
                            </span>
                            <span className="wl-cert-card__sub">
                              {formatVerificationListDate(record.certifiedAt || record.approvedAt)}
                              {record.serialNumber?.trim() ? ` · ${record.serialNumber.trim()}` : ''}
                              {placeLine ? ` · ${placeLine}` : ''}
                            </span>
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
                                  : 'Not signed'}
                            </span>
                          </span>
                        </button>
                        {href ? (
                          <button
                            type="button"
                            className="wl-recent__download"
                            onClick={event => handlePhoneShare(record, event)}
                            aria-label={`Share certificate ${certNo}`}
                            title="Share"
                          >
                            <Share2 size={18} strokeWidth={2} aria-hidden />
                          </button>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ul>
            <div className="table-scroll-wrap wl-cert-desktop">
              <table className="wl-cert-table">
                <colgroup>
                  <col className="wl-cert-col-sl" />
                  <col className="wl-cert-col-cert" />
                  <col className="wl-cert-col-serial" />
                  <col className="wl-cert-col-type" />
                  <col className="wl-cert-col-name" />
                  <col className="wl-cert-col-date" />
                  <col className="wl-cert-col-status" />
                  <col className="wl-cert-col-dl" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Sl</th>
                    <th>Certificate No.</th>
                    <th className="wl-cert-col-hide-phone">Serial</th>
                    <th className="wl-cert-col-hide-phone">Type</th>
                    <th>Name</th>
                    <th className="wl-cert-col-hide-phone">Date</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Download</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((record, index) => {
                    const certNo = record.certificateNumber?.trim() || '—';
                    const loc = certLocation(record, customersById, rcPlace);
                    const signStatus = certificateSignStatus(record);
                    const placeLine = [loc.place, loc.district].filter(Boolean).join(', ');
                    const type = recordType(record);
                    return (
                      <tr
                        key={record.id}
                        className="wl-cert-table__row"
                        onClick={() => openSignPage(record)}
                      >
                        <td className="wl-cert-table__sl">{rowOffset + index + 1}</td>
                        <td className="wl-cert-table__cert">
                          <span className="wl-cert-table__no">{certNo}</span>
                        </td>
                        <td className="wl-cert-col-hide-phone wl-cert-table__mono">
                          {record.serialNumber?.trim() || '—'}
                        </td>
                        <td className="wl-cert-col-hide-phone">
                          <span className={`wl-cert-sign-type wl-cert-sign-type--${type.toLowerCase()}`}>
                            {type}
                          </span>
                        </td>
                        <td className="wl-cert-table__name">
                          <span className="wl-cert-table__primary">
                            {record.customerName?.trim() || '—'}
                          </span>
                          {placeLine ? <span className="wl-cert-table__sub">{placeLine}</span> : null}
                        </td>
                        <td className="wl-cert-col-hide-phone">
                          {formatVerificationListDate(record.certifiedAt || record.approvedAt)}
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
                                : 'Not signed'}
                          </span>
                        </td>
                        <td className="wl-cert-table__dl" />
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
      <CertificatePdfShareViewer
        open={Boolean(viewingRecord)}
        record={viewingRecord}
        url={viewingRecord ? resolveCertificatePdfFileUrl(viewingRecord) : null}
        onClose={() => setViewingRecord(null)}
      />
    </div>
  );
};
