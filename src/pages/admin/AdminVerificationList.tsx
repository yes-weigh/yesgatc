import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { Send } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import {
  buildVerificationStatusFilterOptions,
  buildVerificationTypeFilterOptions,
  canDeleteVerification,
  canSubmitVerification,
  matchesVerificationTypeFilter,
  normalizeVerificationStatus,
  tallyVerificationStatusFilters,
  tallyVerificationTypeFilters,
} from '../../lib/verificationRequest';
import { matchesVerificationSearch } from '../../lib/verificationListSearch';
import {
  matchesVerificationDurationFilter,
  parseVerificationDurationParam,
  type VerificationDurationFilter,
} from '../../lib/verificationListDuration';
import { rewriteOutOfKeralaJobsToRcName } from '../../lib/verificationRcFiling';
import { formatVerificationListDate } from '../../lib/verificationListFormat';
import {
  buildDuplicatePrimaryIdSet,
  buildSerialGroupMap,
  buildVerificationListDisplay,
  matchesVerificationListStatusFilter,
  tallyVerificationStatusFiltersCollapsed,
  verificationListCollapsedForCounts,
} from '../../lib/verificationListGrouping';
import { paginateItems, VERIFICATION_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import { VerificationListFilters,
  type VerificationStatusFilter,
  type VerificationTypeFilter,
  type VerificationPaymentDueFilter,
} from '../../components/VerificationListFilters';
import { VerificationListStatusDash } from '../../components/VerificationListStatusDash';
import { TablePagination } from '../../components/TablePagination';
import { VerificationDetailPanel } from '../../components/VerificationDetailPanel';
import { VerificationListTable } from '../../components/VerificationListTable';
import { isVerificationCertificateVoided } from '../../lib/verificationCertificateVoid';
import {
  matchesSignedPdfFilter,
  tallySignedPdfFilters,
  type VerificationSignedPdfFilter,
} from '../../lib/signedCertificatePdf';
import { enrichVerificationListRecords } from '../../lib/verificationListPartyPhoto';
import { isRvWalletPaymentOutstanding } from '../../lib/rvPaymentAmount';
import { ensureRvWalletDebitedForRecords } from '../../lib/rvWalletAdvancePay';
import { resolveRcFeesStructure } from '../../lib/rcProfileFields';
import {
  buildDevDeleteSubmittedMessage,
  canDevDeleteSubmittedVerification,
  collectSubmittedDeleteBatchForDisplay,
  devDeleteSubmittedVerification,
} from '../../lib/verificationDevDelete';
import {
  canMoveFailedSubmitToDraft,
  moveFailedSubmitVerificationToDraft,
} from '../../lib/verificationPipelineRepair';
import {
  isSiteCalibrationSubmittable,
  siteCalibrationSubmitBlockReason,
} from '../../lib/siteCalibrationProfileFields';
import {
  submitVerificationRecord,
  submitVerificationRecords,
  type VerificationSubmitOptions,
} from '../../lib/verificationSubmit';
import { formatZohoInvoiceGateError, isZohoInvoiceGateError } from '../../lib/zohoRvInvoice';
import { isZohoRvInvoicingEnabled } from '../../lib/zohoRvSubmit';
import { useAppContext } from '../../context/AppContext';
import type { Customer, FirestoreUserDoc, SiteCalibration } from '../../types';

type RcListProfile = Pick<
  FirestoreUserDoc,
  | 'profilePhotoUrl'
  | 'profilePhotoPath'
  | 'contactPerson'
  | 'pincode'
  | 'zohoId'
  | 'address'
  | 'place'
  | 'phone'
  | 'companyName'
>;

interface VerificationRow extends SiteCalibration {
  rcCenterName: string;
}

export const AdminVerificationList: React.FC = () => {
  const { user } = useAuth();
  const { products } = useAppContext();
  const confirm = useConfirm();
  const { appSettings } = useAppSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSuperAdmin = user?.role === 'super_admin';
  const pendingStatusFilter = searchParams.get('status');
  const pendingTypeFilter = searchParams.get('type');
  const pendingDurationFilter = parseVerificationDurationParam(searchParams.get('duration'));
  const pendingRcFilter = searchParams.get('rc');
  const pendingVoidFilter = searchParams.get('void') === '1';
  const pendingOpenId = searchParams.get('open');
  const [records, setRecords] = useState<VerificationRow[]>([]);
  const [customersById, setCustomersById] = useState<Map<string, Customer>>(() => new Map());
  const [rcUsersById, setRcUsersById] = useState<Map<string, RcListProfile>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<VerificationStatusFilter>('all');
  const [voidOnly, setVoidOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<VerificationTypeFilter>('all');
  const [durationFilter, setDurationFilter] = useState<VerificationDurationFilter>('all');
  const [rcFilter, setRcFilter] = useState<string>('all');
  const [paymentDueFilter, setPaymentDueFilter] = useState<VerificationPaymentDueFilter>('all');
  const [signedPdfFilter, setSignedPdfFilter] = useState<VerificationSignedPdfFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [viewingRecord, setViewingRecord] = useState<VerificationRow | null>(null);
  const [lastViewedVerificationId, setLastViewedVerificationId] = useState<string | null>(null);
  const [rowHighlightFlashId, setRowHighlightFlashId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingToDraftId, setMovingToDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(() => new Set());
  const [listError, setListError] = useState('');
  const selectAllDraftsRef = useRef<HTMLInputElement | null>(null);

  const submitOptions = useMemo<VerificationSubmitOptions>(
    () => ({
      zohoRvInvoicingEnabled: isZohoRvInvoicingEnabled(appSettings),
      lookupRecords: records,
    }),
    [appSettings, records],
  );

  const fetchRecords = useCallback(async (): Promise<VerificationRow[]> => {
    setLoading(true);
    setListError('');
    try {
      const [calibrationSnap, userSnap, customerSnap] = await Promise.all([
        getDocs(collection(db, 'siteCalibrations')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'customers')),
      ]);

      const rcByUid = new Map<string, string>();
      const rcProfiles = new Map<string, RcListProfile>();
      userSnap.docs.forEach(d => {
        const data = d.data() as FirestoreUserDoc;
        if (data.role === 'rc_admin') {
          rcByUid.set(d.id, data.companyName || data.username || '—');
          rcProfiles.set(d.id, {
            profilePhotoUrl: data.profilePhotoUrl,
            profilePhotoPath: data.profilePhotoPath,
            contactPerson: data.contactPerson,
            pincode: data.pincode,
            zohoId: data.zohoId,
            address: data.address,
            place: data.place,
            phone: data.phone,
            companyName: data.companyName,
          });
        }
      });

      const customerMap = new Map<string, Customer>();
      customerSnap.docs.forEach(d => {
        customerMap.set(d.id, { id: d.id, ...(d.data() as Omit<Customer, 'id'>) });
      });
      setCustomersById(customerMap);
      setRcUsersById(rcProfiles);

      const toRows = (docs: typeof calibrationSnap.docs): VerificationRow[] =>
        docs
          .map(d => {
            const data = d.data() as Omit<SiteCalibration, 'id'>;
            return {
              id: d.id,
              ...data,
              rcCenterName: (data.rcId && rcByUid.get(data.rcId)) || '—',
            };
          })
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      const rows = toRows(calibrationSnap.docs);
      setRecords(rows);

      if (isSuperAdmin) {
        void rewriteOutOfKeralaJobsToRcName({
          records: rows,
          customersById: customerMap,
          rcNameByUid: rcByUid,
        })
          .then(async rewritten => {
            if (rewritten <= 0) return;
            const refreshed = await getDocs(collection(db, 'siteCalibrations'));
            setRecords(toRows(refreshed.docs));
          })
          .catch(() => undefined);
      }
      return rows;
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load verifications.');
      setRecords([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    if (!pendingStatusFilter) return;
    const allowed: VerificationStatusFilter[] = [
      'all',
      'draft',
      'submitted',
      'certified',
      'failed_submit',
      'rejected',
      'duplicates',
    ];
    const raw = pendingStatusFilter as VerificationStatusFilter;
    if (allowed.includes(raw)) {
      setStatusFilter(raw);
      setVoidOnly(false);
    } else if (raw === 'approved' || raw === 'failed_certification') {
      setStatusFilter(raw === 'failed_certification' ? 'failed_submit' : 'submitted');
      setVoidOnly(false);
    }
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('status');
        return next;
      },
      { replace: true },
    );
  }, [pendingStatusFilter, setSearchParams]);

  useEffect(() => {
    if (!pendingVoidFilter) return;
    setVoidOnly(true);
    setStatusFilter('all');
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('void');
        return next;
      },
      { replace: true },
    );
  }, [pendingVoidFilter, setSearchParams]);

  useEffect(() => {
    if (pendingTypeFilter !== 'OV' && pendingTypeFilter !== 'RV' && pendingTypeFilter !== 'all') {
      return;
    }
    setTypeFilter(pendingTypeFilter);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('type');
        return next;
      },
      { replace: true },
    );
  }, [pendingTypeFilter, setSearchParams]);

  useEffect(() => {
    if (!pendingDurationFilter) return;
    setDurationFilter(pendingDurationFilter);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('duration');
        return next;
      },
      { replace: true },
    );
  }, [pendingDurationFilter, setSearchParams]);

  useEffect(() => {
    if (!pendingRcFilter) return;
    setRcFilter(pendingRcFilter);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('rc');
        return next;
      },
      { replace: true },
    );
  }, [pendingRcFilter, setSearchParams]);

  useEffect(() => {
    if (!pendingOpenId || loading) return;
    const record = records.find(entry => entry.id === pendingOpenId);
    if (!record) return;
    setViewingRecord(record);
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('open');
        return next;
      },
      { replace: true },
    );
  }, [pendingOpenId, loading, records, setSearchParams]);

  useEffect(() => {
    if (!viewingRecord) return;
    const fresh = records.find(r => r.id === viewingRecord.id);
    if (fresh) {
      setViewingRecord(fresh);
    }
  }, [records, viewingRecord?.id]);

  const duplicatePrimaryIds = useMemo(() => buildDuplicatePrimaryIdSet(records), [records]);
  const serialGroups = useMemo(() => buildSerialGroupMap(records), [records]);

  const durationScoped = useMemo(
    () => records.filter(record => matchesVerificationDurationFilter(record, durationFilter)),
    [records, durationFilter],
  );

  const filteredRecords = useMemo(() => {
    const filtered = durationScoped.filter(record => {
      if (voidOnly && !isVerificationCertificateVoided(record)) {
        return false;
      }
      if (paymentDueFilter === 'due' && !isRvWalletPaymentOutstanding(record)) {
        return false;
      }
      if (!matchesVerificationSearch(record, searchTerm, { rcCenterName: record.rcCenterName })) {
        return false;
      }
      if (
        !matchesVerificationListStatusFilter(
          record,
          statusFilter,
          durationScoped,
          duplicatePrimaryIds,
          serialGroups,
        )
      ) {
        return false;
      }
      if (!matchesVerificationTypeFilter(record, typeFilter)) {
        return false;
      }
      if (rcFilter !== 'all' && (record.rcId || '') !== rcFilter) {
        return false;
      }
      if (!matchesSignedPdfFilter(record, signedPdfFilter)) {
        return false;
      }
      return true;
    });
    return buildVerificationListDisplay(filtered, durationScoped, statusFilter);
  }, [durationScoped, statusFilter, voidOnly, paymentDueFilter, typeFilter, rcFilter, signedPdfFilter, searchTerm, duplicatePrimaryIds, serialGroups]);

  const paginatedRecords = useMemo(
    () => paginateItems(filteredRecords, page, VERIFICATION_TABLE_PAGE_SIZE),
    [filteredRecords, page],
  );

  const paginatedRecordsWithPhotos = useMemo(
    () =>
      enrichVerificationListRecords(paginatedRecords, {
        rcUsersById,
        customersById,
      }),
    [paginatedRecords, rcUsersById, customersById],
  );

  useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter, rcFilter, searchTerm, durationFilter, paymentDueFilter, signedPdfFilter]);

  useEffect(() => {
    if (viewingRecord || !rowHighlightFlashId) return;

    const scrollTarget = document.querySelector(
      `[data-verification-row-id="${rowHighlightFlashId}"]`,
    );
    scrollTarget?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const timer = window.setTimeout(() => setRowHighlightFlashId(null), 1400);
    return () => clearTimeout(timer);
  }, [viewingRecord, rowHighlightFlashId]);

  const closeVerificationDetails = () => {
    const closingId = viewingRecord?.id ?? null;
    if (closingId) {
      setLastViewedVerificationId(closingId);
      setRowHighlightFlashId(closingId);
    }
    setViewingRecord(null);
  };

  const rcCenterNameByRcId = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of records) {
      const rcId = record.rcId?.trim() || 'unknown';
      if (!map.has(rcId)) {
        map.set(rcId, record.rcCenterName?.trim() || 'Unknown RC');
      }
    }
    return map;
  }, [records]);

  const listFilters = useMemo(
    () => ({
      statusFilter,
      typeFilter,
      rcFilter,
      searchTerm,
      searchExtras: (record: SiteCalibration) => ({
        rcCenterName: rcCenterNameByRcId.get(record.rcId?.trim() || 'unknown'),
      }),
    }),
    [statusFilter, typeFilter, rcFilter, searchTerm, rcCenterNameByRcId],
  );

  const counts = useMemo(
    () => tallyVerificationStatusFiltersCollapsed(durationScoped, listFilters),
    [durationScoped, listFilters],
  );
  const dashCounts = useMemo(
    () => tallyVerificationStatusFilters(durationScoped),
    [durationScoped],
  );
  const dashOvCount = useMemo(
    () => tallyVerificationTypeFilters(durationScoped).OV,
    [durationScoped],
  );
  const dashRvCount = useMemo(
    () => tallyVerificationTypeFilters(durationScoped).RV,
    [durationScoped],
  );
  const typeCounts = useMemo(
    () =>
      tallyVerificationTypeFilters(
        verificationListCollapsedForCounts(durationScoped, listFilters, 'type'),
      ),
    [durationScoped, listFilters],
  );
  const typeFilterOptions = buildVerificationTypeFilterOptions(typeCounts);

  const rcFilterOptions = useMemo(() => {
    const collapsed = verificationListCollapsedForCounts(durationScoped, listFilters, 'rc');
    const byRc = new Map<string, { label: string; count: number }>();
    for (const record of collapsed) {
      const rcId = record.rcId?.trim() || 'unknown';
      const label = rcCenterNameByRcId.get(rcId) || 'Unknown RC';
      const existing = byRc.get(rcId);
      if (existing) {
        existing.count += 1;
      } else {
        byRc.set(rcId, { label, count: 1 });
      }
    }

    const centres = [...byRc.entries()]
      .map(([value, { label, count }]) => ({ value, label, count }))
      .filter(row => row.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return [
      { value: 'all', label: 'All RC', count: collapsed.length },
      ...centres,
    ];
  }, [durationScoped, listFilters, rcCenterNameByRcId]);

  const handleDelete = async (record: VerificationRow) => {
    const isDevSubmittedDelete = canDevDeleteSubmittedVerification(record, isSuperAdmin);
    if (!canDeleteVerification(record) && !isDevSubmittedDelete) return;

    const label = `${record.customerName} · ${record.serialNumber || 'no serial'}`;

    if (isDevSubmittedDelete) {
      const batch = collectSubmittedDeleteBatchForDisplay(record, records);
      const ok = await confirm({
        title: 'Delete submitted verification? (dev only)',
        message: buildDevDeleteSubmittedMessage(batch, record.rcCenterName || 'Regional Center'),
        messageFormat: 'preline',
        confirmLabel: 'Delete from Firebase',
        destructive: true,
      });
      if (!ok) return;

      setDeletingId(record.id);
      try {
        await devDeleteSubmittedVerification(record.id);
        if (viewingRecord?.id === record.id) {
          setViewingRecord(null);
        }
        if (lastViewedVerificationId === record.id) {
          setLastViewedVerificationId(null);
          setRowHighlightFlashId(null);
        }
        await fetchRecords();
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'Failed to delete submitted verification.');
      } finally {
        setDeletingId(null);
      }
      return;
    }

    const ok = await confirm({
      title: 'Remove draft verification?',
      message: `Remove draft verification "${label}"?\n\nThis cannot be undone.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    setDeletingId(record.id);
    try {
      await deleteDoc(doc(db, 'siteCalibrations', record.id));
      if (viewingRecord?.id === record.id) {
        setViewingRecord(null);
      }
      if (lastViewedVerificationId === record.id) {
        setLastViewedVerificationId(null);
        setRowHighlightFlashId(null);
      }
      await fetchRecords();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to remove verification.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleMoveToDraft = async (record: VerificationRow) => {
    if (!canMoveFailedSubmitToDraft(record, isSuperAdmin)) return;

    const appNo = record.applicationNumber?.trim() || '—';
    const serial = record.serialNumber?.trim() || '—';
    const ok = await confirm({
      title: 'Move to draft?',
      message: [
        `Move App ${appNo} (serial ${serial}) back to draft?`,
        '',
        'RC/VCT can then open it, fix photos or pincode, and submit again.',
        'Application number is kept. Worker will not process it until resubmitted.',
      ].join('\n'),
      messageFormat: 'preline',
      confirmLabel: 'Move to draft',
    });
    if (!ok) return;

    setMovingToDraftId(record.id);
    setListError('');
    try {
      await moveFailedSubmitVerificationToDraft(record.id);
      if (viewingRecord?.id === record.id) {
        setViewingRecord(null);
      }
      await fetchRecords();
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to move verification to draft.');
    } finally {
      setMovingToDraftId(null);
    }
  };

  const recordSubmitOptions = useCallback(
    (record: SiteCalibration) => {
      const listedCustomer = record.customerId
        ? customersById.get(record.customerId) ?? null
        : null;
      const rcProfile = record.rcId ? rcUsersById.get(record.rcId) ?? null : null;
      return {
        customerPincode: listedCustomer?.pincode ?? null,
        rcPincode: rcProfile?.pincode ?? null,
        rcZohoId: rcProfile?.zohoId,
        zohoRvInvoicingEnabled: isZohoRvInvoicingEnabled(appSettings),
        requireUploadedImages: true,
      };
    },
    [customersById, rcUsersById, appSettings],
  );

  const draftSubmitMeta = useMemo(() => {
    const meta = new Map<string, { submittable: boolean; blockReason: string | null }>();
    for (const record of filteredRecords) {
      if (normalizeVerificationStatus(record) !== 'draft') continue;
      const blockReason = siteCalibrationSubmitBlockReason(record, recordSubmitOptions(record));
      meta.set(record.id, { submittable: !blockReason, blockReason });
    }
    return meta;
  }, [filteredRecords, recordSubmitOptions]);

  const selectableDraftIds = useMemo(
    () => [...draftSubmitMeta.entries()].filter(([, value]) => value.submittable).map(([id]) => id),
    [draftSubmitMeta],
  );

  const allSelectableDraftsSelected =
    selectableDraftIds.length > 0 && selectableDraftIds.every(id => selectedDraftIds.has(id));

  const someSelectableDraftsSelected =
    selectableDraftIds.some(id => selectedDraftIds.has(id)) && !allSelectableDraftsSelected;

  useEffect(() => {
    setSelectedDraftIds(new Set());
  }, [statusFilter, typeFilter, rcFilter, searchTerm, durationFilter, paymentDueFilter, signedPdfFilter]);

  useEffect(() => {
    if (selectAllDraftsRef.current) {
      selectAllDraftsRef.current.indeterminate = someSelectableDraftsSelected;
    }
  }, [someSelectableDraftsSelected, selectableDraftIds.length]);

  const toggleDraftSelection = (id: string, submittable: boolean) => {
    if (!submittable) return;
    setSelectedDraftIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllDrafts = () => {
    setSelectedDraftIds(prev => {
      if (allSelectableDraftsSelected) {
        const next = new Set(prev);
        selectableDraftIds.forEach(id => next.delete(id));
        return next;
      }
      return new Set([...prev, ...selectableDraftIds]);
    });
  };

  const handleSubmitRecord = async (record: SiteCalibration) => {
    if (!isSuperAdmin || !canSubmitVerification(record)) return;

    const validationError = siteCalibrationSubmitBlockReason(record, recordSubmitOptions(record));
    if (validationError) {
      setListError(validationError);
      return;
    }

    setSubmitting(true);
    setListError('');
    try {
      await ensureRvWalletDebitedForRecords({
        records: [record],
        products,
        feeSettings: appSettings,
        feesForRc: () => resolveRcFeesStructure(null),
      });
      await submitVerificationRecord(
        {
          id: record.id,
          verificationType: record.verificationType,
        },
        db,
        submitOptions,
      );
      setSelectedDraftIds(prev => {
        if (!prev.has(record.id)) return prev;
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
      await fetchRecords();
    } catch (err: unknown) {
      setListError(
        isZohoInvoiceGateError(err)
          ? formatZohoInvoiceGateError(err)
          : err instanceof Error
            ? err.message
            : 'Failed to submit verification.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmitRecords = async () => {
    if (!isSuperAdmin) return;

    const selectedRecords = filteredRecords.filter(
      r => selectedDraftIds.has(r.id) && isSiteCalibrationSubmittable(r, recordSubmitOptions(r)),
    );

    if (selectedRecords.length === 0) {
      setListError('None of the selected drafts are ready to submit. Complete required fields and images first.');
      return;
    }

    setSubmitting(true);
    setListError('');
    try {
      await ensureRvWalletDebitedForRecords({
        records: selectedRecords,
        products,
        feeSettings: appSettings,
        feesForRc: () => resolveRcFeesStructure(null),
      });
      await submitVerificationRecords(
        selectedRecords.map(record => ({
          id: record.id,
          verificationType: record.verificationType,
        })),
        db,
        submitOptions,
      );
      setSelectedDraftIds(new Set());
      await fetchRecords();
    } catch (err: unknown) {
      setListError(
        isZohoInvoiceGateError(err)
          ? formatZohoInvoiceGateError(err)
          : err instanceof Error
            ? err.message
            : 'Failed to submit selected verifications.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const filterOptions = buildVerificationStatusFilterOptions(counts);
  const rowOffset = (page - 1) * VERIFICATION_TABLE_PAGE_SIZE;
  const walletPaymentDueRecordIds = useMemo(() => {
    return new Set(
      records
        .filter(record => isRvWalletPaymentOutstanding(record))
        .map(record => record.id),
    );
  }, [records]);
  const paymentDueCount = useMemo(
    () => durationScoped.filter(record => isRvWalletPaymentOutstanding(record)).length,
    [durationScoped],
  );
  const signedPdfCounts = useMemo(() => tallySignedPdfFilters(durationScoped), [durationScoped]);
  return (
    <div className="fade-in page-content">
      {viewingRecord ? (
        <VerificationDetailPanel
          record={viewingRecord}
          allRecords={records}
          rcCenterName={viewingRecord.rcCenterName}
          rcContactPerson={
            viewingRecord.rcId
              ? rcUsersById.get(viewingRecord.rcId)?.contactPerson
              : null
          }
          customer={
            viewingRecord.customerId
              ? customersById.get(viewingRecord.customerId) ?? null
              : null
          }
          product={products.find(item => item.id === viewingRecord.productId) ?? null}
          rcProfile={
            viewingRecord.rcId ? rcUsersById.get(viewingRecord.rcId) ?? null : null
          }
          onClose={closeVerificationDetails}
          onRecordsChanged={async newRecordId => {
            const rows = await fetchRecords();
            if (!newRecordId) return;
            const next = rows.find(r => r.id === newRecordId);
            if (next) setViewingRecord(next);
          }}
        />
      ) : (
        <div className="verification-list-page fade-in">
          {listError && (
            <p className="verification-list-error rc-form-topbar-error text-sm" role="alert">
              {listError}
            </p>
          )}

          <VerificationListStatusDash
            counts={dashCounts}
            ovCount={dashOvCount}
            rvCount={dashRvCount}
            notSignedCount={signedPdfCounts.notSigned}
            statusFilter={statusFilter}
            onStatusFilterChange={value => {
              setVoidOnly(false);
              setStatusFilter(value);
            }}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            signedPdfFilter={signedPdfFilter}
            onSignedPdfFilterChange={setSignedPdfFilter}
            loading={loading}
          />
          <VerificationListFilters
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            searchPlaceholder="Search verification…"
            statusFilter={statusFilter}
            onStatusFilterChange={value => {
              setVoidOnly(false);
              setStatusFilter(value);
            }}
            statusOptions={filterOptions}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            typeOptions={typeFilterOptions}
            durationFilter={durationFilter}
            onDurationFilterChange={setDurationFilter}
            rcFilter={rcFilter}
            onRcFilterChange={setRcFilter}
            rcOptions={rcFilterOptions}
            paymentDueFilter={paymentDueFilter}
            onPaymentDueFilterChange={setPaymentDueFilter}
            paymentDueCount={paymentDueCount}
            paymentDueAllCount={durationScoped.length}
            signedPdfFilter={signedPdfFilter}
            onSignedPdfFilterChange={setSignedPdfFilter}
            signedPdfCount={signedPdfCounts.signed}
            notSignedPdfCount={signedPdfCounts.notSigned}
            onRefresh={() => void fetchRecords()}
            refreshing={loading}
          />

          {isSuperAdmin && selectedDraftIds.size > 0 && (
            <div className="verification-bulk-bar">
              <span className="verification-bulk-bar-count">
                {selectedDraftIds.size} draft{selectedDraftIds.size !== 1 ? 's' : ''} selected
              </span>
              <button
                type="button"
                className="btn btn-primary text-sm py-1.5 px-3 flex items-center gap-1.5"
                onClick={() => void handleBulkSubmitRecords()}
                disabled={submitting}
              >
                {submitting ? (
                  <span className="spinner-inline" />
                ) : (
                  <>
                    <Send size={16} /> Submit for certification
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn btn-secondary text-sm py-1.5 px-3"
                onClick={() => setSelectedDraftIds(new Set())}
                disabled={submitting}
              >
                Clear selection
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <span className="spinner-inline large" />
            </div>
          ) : (
            <>
              <TablePagination
                page={page}
                totalItems={filteredRecords.length}
                pageSize={VERIFICATION_TABLE_PAGE_SIZE}
                onPageChange={setPage}
                placement="top"
              />
              <VerificationListTable
                mode="admin"
                records={paginatedRecordsWithPhotos}
                rowOffset={rowOffset}
                formatDate={formatVerificationListDate}
                emptyMessage="No verifications match the current filters."
                onView={record => {
                  setLastViewedVerificationId(record.id);
                  setViewingRecord(record as VerificationRow);
                }}
                lastViewedRecordId={lastViewedVerificationId}
                flashRecordId={rowHighlightFlashId}
                walletPaymentDueRecordIds={walletPaymentDueRecordIds}
                adminDevDeleteEnabled={isSuperAdmin}
                adminMoveFailedSubmitEnabled={isSuperAdmin}
                onDelete={record => void handleDelete(record as VerificationRow)}
                onMoveToDraft={record => void handleMoveToDraft(record as VerificationRow)}
                onSubmit={
                  isSuperAdmin
                    ? record => void handleSubmitRecord(record)
                    : undefined
                }
                deletingId={deletingId}
                movingToDraftId={movingToDraftId}
                submitting={submitting}
                bulkSelect={
                  isSuperAdmin
                    ? {
                        selectedDraftIds,
                        draftSubmitMeta,
                        selectAllDraftsRef,
                        selectableDraftIds,
                        allSelectableDraftsSelected,
                        onToggleDraftSelection: toggleDraftSelection,
                        onToggleSelectAllDrafts: toggleSelectAllDrafts,
                      }
                    : undefined
                }
              />
              <TablePagination
                page={page}
                totalItems={filteredRecords.length}
                pageSize={VERIFICATION_TABLE_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};
