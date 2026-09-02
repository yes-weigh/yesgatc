import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { Building2, X } from 'lucide-react';
import { FilterIcon } from '../../components/FilterIcon';
import { ContractorFeePayControl } from '../../components/ContractorFeePayControl';
import { TablePagination } from '../../components/TablePagination';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useSetReportsAppBar } from '../../context/ReportsAppBarContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useRcScope } from '../../lib/roleScope';
import { paginateItems, paginationRange, REPORTS_TABLE_PAGE_SIZE } from '../../lib/tablePagination';
import {
  formatReportInr,
  stampRcRevenueShare,
  stampRevenueShare,
} from '../../lib/reportRevenueShare';
import {
  carryForwardContractorFeeDues,
  subscribeContractorFeePayments,
  type ContractorFeePayment,
} from '../../lib/contractorFeePayment';
import { buildReportPdf, shareReportPdf } from '../../lib/reportPdf';
import {
  filterInwardBatchesForRc,
  formatInwardDate,
  formatInwardTime,
  inwardBatchesFromInboundEvents,
  inwardMonthKey,
  mergeWebhookInwardBatches,
  serialInwardBatchFromDoc,
  type SerialInwardBatch,
} from '../../lib/serialInwardReport';
import { verificationRecordsQuery } from '../../lib/verificationRecordsQuery';
import { getVerificationDisplayStatus } from '../../lib/verificationRequest';
import type { FirestoreUserDoc, Product, SiteCalibration } from '../../types';

type RcOption = { id: string; name: string; district: string; rcCode?: string };
type TypeFilter = 'all' | 'OV' | 'RV';
type ReportView = 'day_summary' | 'revenue_share' | 'serial_inward';

type DayRow = {
  dateKey: string;
  dateLabel: string;
  dateShort: string;
  rcName: string;
  verified: number;
  qtyUpto20: number;
  qtyAbove20: number;
};

type RevenueDayRow = {
  dateKey: string;
  dateLabel: string;
  rcName: string;
  qty: number;
  qtyUpto20: number;
  qtyAbove20: number;
  collected: number;
  interweighing: number;
  contractor: number;
  handling: number;
  rcShare: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function dayKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDayShort(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

function daysOfMonth(key: string): Date[] {
  if (key === LIFETIME_MONTH_KEY) {
    const [year, month] = GATC_START_MONTH_KEY.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const days: Date[] = [];
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      days.push(new Date(cursor));
    }
    return days;
  }
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return [];
  const last = new Date(year, month, 0).getDate();
  return Array.from({ length: last }, (_, i) => new Date(year, month - 1, i + 1));
}

const GATC_START_MONTH_KEY = '2026-02';
const LIFETIME_MONTH_KEY = 'lifetime';

function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthYear(key: string): string {
  if (key === LIFETIME_MONTH_KEY) return 'Lifetime';
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function recordReportDate(record: SiteCalibration): Date | null {
  const status = getVerificationDisplayStatus(record);
  const raw =
    status === 'certified'
      ? record.certifiedAt || record.approvedAt || record.createdAt
      : record.createdAt;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function recordType(record: SiteCalibration): 'OV' | 'RV' {
  return record.verificationType === 'RV' ? 'RV' : 'OV';
}

function buildMonthOptions(records: SiteCalibration[], now = new Date()): string[] {
  const keys = new Set<string>();
  keys.add(currentMonthKey(now));
  for (let i = 1; i < 24; i += 1) {
    keys.add(currentMonthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  for (const record of records) {
    const date = recordReportDate(record);
    if (date) keys.add(monthKeyFromDate(date));
  }
  return [...keys]
    .filter(key => key >= GATC_START_MONTH_KEY)
    .sort((a, b) => b.localeCompare(a));
}

export const Reports: React.FC = () => {
  const { user } = useAuth();
  const { rcUid, actorUid, isFieldStaff, isRcAdmin } = useRcScope();
  const { appSettings } = useAppSettings();
  const setReportsAppBar = useSetReportsAppBar();
  const isSuper = user?.role === 'super_admin';
  const isRcRevenue = !isSuper;
  const defaultReportView: ReportView = isSuper ? 'day_summary' : 'revenue_share';

  const [records, setRecords] = useState<SiteCalibration[]>([]);
  const [rcOptions, setRcOptions] = useState<RcOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [rcFilter, setRcFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [reportView, setReportView] = useState<ReportView>(defaultReportView);
  const [monthKey, setMonthKey] = useState(currentMonthKey);
  const [page, setPage] = useState(1);
  const [productsById, setProductsById] = useState<Map<string, Product>>(() => new Map());
  const [filterOpen, setFilterOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [draftView, setDraftView] = useState<ReportView>(defaultReportView);
  const [draftRc, setDraftRc] = useState('all');
  const [draftType, setDraftType] = useState<TypeFilter>('all');
  const [draftMonth, setDraftMonth] = useState(currentMonthKey);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filterSlots, setFilterSlots] = useState<{
    mobile: HTMLElement | null;
    desktop: HTMLElement | null;
  }>({ mobile: null, desktop: null });
  const [paymentsByDate, setPaymentsByDate] = useState<Map<string, ContractorFeePayment>>(
    () => new Map(),
  );
  const [inwardBatches, setInwardBatches] = useState<SerialInwardBatch[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const loadInward = async (scope?: { rcId?: string; rcCode?: string } | null) => {
        let stored: SerialInwardBatch[] = [];
        let fromEvents: SerialInwardBatch[] = [];

        try {
          const inwardQ = scope?.rcId
            ? query(collection(db, 'serialInwardBatches'), where('rcId', '==', scope.rcId))
            : collection(db, 'serialInwardBatches');
          const inwardSnap = await getDocs(inwardQ);
          stored = inwardSnap.docs.map(d => serialInwardBatchFromDoc(d.id, d.data()));
        } catch {
          stored = [];
        }

        // Webhook audit log — YesOne inbound events.
        try {
          const eventSnap = await getDocs(collection(db, 'yesoneInboundEvents'));
          fromEvents = inwardBatchesFromInboundEvents(
            eventSnap.docs.map(d => {
              const data = d.data() as { at?: string; payload?: unknown };
              return { id: d.id, at: data.at, payload: data.payload };
            }),
          );
        } catch {
          fromEvents = [];
        }

        const merged = mergeWebhookInwardBatches({ fromEvents, stored });
        setInwardBatches(filterInwardBatchesForRc(merged, scope));
      };

      if (isSuper) {
        const [calibrationSnap, userSnap, productSnap] = await Promise.all([
          getDocs(collection(db, 'siteCalibrations')),
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'products')),
        ]);
        setRecords(
          calibrationSnap.docs.map(d => ({
            id: d.id,
            ...(d.data() as Omit<SiteCalibration, 'id'>),
          })),
        );
        const products = new Map<string, Product>();
        productSnap.docs.forEach(d => {
          products.set(d.id, { id: d.id, ...(d.data() as Omit<Product, 'id'>) });
        });
        setProductsById(products);
        const rcs: RcOption[] = [];
        userSnap.docs.forEach(d => {
          const data = d.data() as FirestoreUserDoc;
          if (data.role !== 'rc_admin') return;
          rcs.push({
            id: d.id,
            name: data.companyName?.trim() || data.username?.trim() || 'GATC',
            district: data.place?.trim() || '',
            rcCode: data.rcCode?.trim() || '',
          });
        });
        setRcOptions(rcs);
        await loadInward(null);
        return;
      }

      if (!rcUid) {
        setRecords([]);
        setRcOptions([]);
        setProductsById(new Map());
        setInwardBatches([]);
        return;
      }

      const [snap, rcSnap, productSnap] = await Promise.all([
        getDocs(verificationRecordsQuery(db, rcUid, { isFieldStaff, actorUid })),
        getDoc(doc(db, 'users', rcUid)),
        getDocs(collection(db, 'products')),
      ]);
      setRecords(
        snap.docs.map(d => ({
          id: d.id,
          ...(d.data() as Omit<SiteCalibration, 'id'>),
        })),
      );
      const products = new Map<string, Product>();
      productSnap.docs.forEach(d => {
        products.set(d.id, { id: d.id, ...(d.data() as Omit<Product, 'id'>) });
      });
      setProductsById(products);
      const rcData = rcSnap.exists() ? (rcSnap.data() as FirestoreUserDoc) : null;
      const rcCode = rcData?.rcCode?.trim() || '';
      setRcOptions([
        {
          id: rcUid,
          name: rcData?.companyName?.trim() || rcData?.username?.trim() || 'GATC',
          district: rcData?.place?.trim() || '',
          rcCode,
        },
      ]);
      setRcFilter(rcUid);
      await loadInward({ rcId: rcUid, rcCode });
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : 'Failed to load report.');
      setRecords([]);
      setProductsById(new Map());
      setInwardBatches([]);
    } finally {
      setLoading(false);
    }
  }, [actorUid, isSuper, isFieldStaff, rcUid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isRcRevenue || !rcFilter || rcFilter === 'all') {
      setPaymentsByDate(new Map());
      return;
    }
    return subscribeContractorFeePayments(rcFilter, setPaymentsByDate);
  }, [isRcRevenue, rcFilter]);

  useLayoutEffect(() => {
    const syncSlots = () => {
      setFilterSlots({
        mobile: document.getElementById('verification-filter-slot-mobile'),
        desktop: document.getElementById('verification-filter-slot-desktop'),
      });
    };
    syncSlots();
    window.addEventListener('resize', syncSlots);
    return () => window.removeEventListener('resize', syncSlots);
  }, []);

  useEffect(() => {
    if (!filterOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (filterRef.current?.contains(event.target as Node)) return;
      if (event.target instanceof HTMLElement && event.target.closest('select')) return;
      setFilterOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  const monthOptions = useMemo(() => {
    const keys = new Set(buildMonthOptions(records));
    for (const row of inwardBatches) {
      const key = inwardMonthKey(row.at);
      if (key >= GATC_START_MONTH_KEY) keys.add(key);
    }
    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [inwardBatches, records]);

  const monthRecords = useMemo(
    () =>
      records.filter(record => {
        const date = recordReportDate(record);
        if (!date) return false;
        const key = monthKeyFromDate(date);
        if (key < GATC_START_MONTH_KEY) return false;
        if (monthKey === LIFETIME_MONTH_KEY) return true;
        return key === monthKey;
      }),
    [monthKey, records],
  );

  const typedMonthRecords = useMemo(() => {
    if (typeFilter === 'all') return monthRecords;
    return monthRecords.filter(record => recordType(record) === typeFilter);
  }, [monthRecords, typeFilter]);

  const sortedRcOptions = useMemo(() => {
    const certifiedByRc = new Map<string, number>();
    for (const record of typedMonthRecords) {
      if (getVerificationDisplayStatus(record) !== 'certified') continue;
      const id = record.rcId?.trim();
      if (!id) continue;
      certifiedByRc.set(id, (certifiedByRc.get(id) ?? 0) + 1);
    }
    return [...rcOptions].sort(
      (a, b) =>
        (certifiedByRc.get(b.id) ?? 0) - (certifiedByRc.get(a.id) ?? 0) || a.name.localeCompare(b.name),
    );
  }, [rcOptions, typedMonthRecords]);

  useEffect(() => {
    if (!isSuper || sortedRcOptions.length === 0) return;
    if (rcFilter === 'all' || !sortedRcOptions.some(rc => rc.id === rcFilter)) {
      setRcFilter(sortedRcOptions[0].id);
    }
  }, [isSuper, rcFilter, sortedRcOptions]);

  const scopedRecords = useMemo(() => {
    if (!rcFilter || rcFilter === 'all') return [];
    return typedMonthRecords.filter(record => (record.rcId || '') === rcFilter);
  }, [rcFilter, typedMonthRecords]);

  const selectedRcName =
    sortedRcOptions.find(rc => rc.id === rcFilter)?.name ||
    sortedRcOptions[0]?.name ||
    'Reports';

  const dayRows = useMemo<DayRow[]>(() => {
    if (!rcFilter || rcFilter === 'all') return [];
    const byDay = new Map<string, { verified: number; qtyUpto20: number; qtyAbove20: number }>();
    for (const record of scopedRecords) {
      if (getVerificationDisplayStatus(record) !== 'certified') continue;
      const date = recordReportDate(record);
      if (!date) continue;
      const key = dayKeyFromDate(date);
      const prev = byDay.get(key) ?? { verified: 0, qtyUpto20: 0, qtyAbove20: 0 };
      prev.verified += 1;
      const share = stampRevenueShare(record, productsById);
      if (share?.tier === 'upto20') prev.qtyUpto20 += 1;
      else if (share?.tier === 'above20') prev.qtyAbove20 += 1;
      byDay.set(key, prev);
    }
    return daysOfMonth(monthKey)
      .map(date => {
        const dateKey = dayKeyFromDate(date);
        const counts = byDay.get(dateKey);
        return {
          dateKey,
          dateLabel: formatDayLabel(date),
          dateShort: formatDayShort(date),
          rcName: selectedRcName,
          verified: counts?.verified ?? 0,
          qtyUpto20: counts?.qtyUpto20 ?? 0,
          qtyAbove20: counts?.qtyAbove20 ?? 0,
        };
      })
      .filter(row => row.verified > 0);
  }, [monthKey, productsById, rcFilter, scopedRecords, selectedRcName]);

  const dayVerifiedTotal = useMemo(
    () => dayRows.reduce((sum, row) => sum + row.verified, 0),
    [dayRows],
  );
  const dayUpto20Total = useMemo(
    () => dayRows.reduce((sum, row) => sum + row.qtyUpto20, 0),
    [dayRows],
  );
  const dayAbove20Total = useMemo(
    () => dayRows.reduce((sum, row) => sum + row.qtyAbove20, 0),
    [dayRows],
  );

  const revenueRows = useMemo<RevenueDayRow[]>(() => {
    if (!rcFilter || rcFilter === 'all') return [];
    const byDay = new Map<string, RevenueDayRow>();
    for (const record of scopedRecords) {
      if (getVerificationDisplayStatus(record) !== 'certified') continue;
      const date = recordReportDate(record);
      if (!date) continue;
      const dateKey = dayKeyFromDate(date);
      const share = isRcRevenue
        ? stampRcRevenueShare(
            record,
            productsById,
            dateKey,
            appSettings.contractorFeeSchedules,
          )
        : stampRevenueShare(record, productsById);
      if (!share) continue;
      const prev = byDay.get(dateKey) ?? {
        dateKey,
        dateLabel: formatDayLabel(date),
        rcName: selectedRcName,
        qty: 0,
        qtyUpto20: 0,
        qtyAbove20: 0,
        collected: 0,
        interweighing: 0,
        contractor: 0,
        handling: 0,
        rcShare: 0,
      };
      prev.qty += 1;
      if (share.tier === 'upto20') prev.qtyUpto20 += 1;
      else prev.qtyAbove20 += 1;
      prev.collected += share.collected;
      prev.interweighing += share.interweighing;
      prev.contractor += share.contractor;
      prev.handling += share.handling;
      prev.rcShare += share.rcShare;
      byDay.set(dateKey, prev);
    }
    return daysOfMonth(monthKey)
      .map(date => byDay.get(dayKeyFromDate(date)))
      .filter((row): row is RevenueDayRow => Boolean(row && row.qty > 0));
  }, [
    appSettings.contractorFeeSchedules,
    isRcRevenue,
    monthKey,
    productsById,
    rcFilter,
    scopedRecords,
    selectedRcName,
  ]);

  const revenueTotals = useMemo(
    () =>
      revenueRows.reduce(
        (sum, row) => ({
          qty: sum.qty + row.qty,
          qtyUpto20: sum.qtyUpto20 + row.qtyUpto20,
          qtyAbove20: sum.qtyAbove20 + row.qtyAbove20,
          collected: sum.collected + row.collected,
          interweighing: sum.interweighing + row.interweighing,
          contractor: sum.contractor + row.contractor,
          handling: sum.handling + row.handling,
          rcShare: sum.rcShare + row.rcShare,
        }),
        {
          qty: 0,
          qtyUpto20: 0,
          qtyAbove20: 0,
          collected: 0,
          interweighing: 0,
          contractor: 0,
          handling: 0,
          rcShare: 0,
        },
      ),
    [revenueRows],
  );

  const contractorDueByDate = useMemo(() => {
    if (!isRcRevenue || !rcFilter || rcFilter === 'all') return new Map<string, number>();
    const byDay = new Map<string, number>();
    for (const record of records) {
      if ((record.rcId || '') !== rcFilter) continue;
      if (typeFilter !== 'all' && recordType(record) !== typeFilter) continue;
      if (getVerificationDisplayStatus(record) !== 'certified') continue;
      const date = recordReportDate(record);
      if (!date) continue;
      if (monthKeyFromDate(date) < GATC_START_MONTH_KEY) continue;
      const dateKey = dayKeyFromDate(date);
      const share = stampRcRevenueShare(
        record,
        productsById,
        dateKey,
        appSettings.contractorFeeSchedules,
      );
      if (!share) continue;
      byDay.set(dateKey, (byDay.get(dateKey) ?? 0) + share.contractor + share.handling);
    }
    for (const dateKey of paymentsByDate.keys()) {
      if (!byDay.has(dateKey)) byDay.set(dateKey, 0);
    }
    const days = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, amountInr]) => ({ dateKey, amountInr }));
    return carryForwardContractorFeeDues(days, paymentsByDate);
  }, [
    appSettings.contractorFeeSchedules,
    isRcRevenue,
    paymentsByDate,
    productsById,
    rcFilter,
    records,
    typeFilter,
  ]);

  const outstandingDue = useMemo(() => {
    if (revenueRows.length === 0) return 0;
    const last = revenueRows[revenueRows.length - 1];
    return contractorDueByDate.get(last.dateKey) ?? 0;
  }, [contractorDueByDate, revenueRows]);

  const isRevenue = reportView === 'revenue_share';
  const isSerialInward = reportView === 'serial_inward';

  const selectedRcCode =
    sortedRcOptions.find(rc => rc.id === rcFilter)?.rcCode?.trim() || '';

  const inwardRows = useMemo(() => {
    const scopedToRc =
      rcFilter && rcFilter !== 'all'
        ? filterInwardBatchesForRc(inwardBatches, { rcId: rcFilter, rcCode: selectedRcCode })
        : inwardBatches;
    const scoped = scopedToRc.filter(row => {
      const key = inwardMonthKey(row.at);
      if (!key) return monthKey === LIFETIME_MONTH_KEY;
      if (key < GATC_START_MONTH_KEY) return false;
      if (monthKey === LIFETIME_MONTH_KEY) return true;
      return key === monthKey;
    });
    return [...scoped].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }, [inwardBatches, monthKey, rcFilter, selectedRcCode]);

  const inwardQtyTotal = useMemo(
    () => inwardRows.reduce((sum, row) => sum + (row.totalQty || 0), 0),
    [inwardRows],
  );

  const listLength = isSerialInward
    ? inwardRows.length
    : isRevenue
      ? revenueRows.length
      : dayRows.length;
  const showHandling = isRcRevenue && revenueTotals.handling > 0;

  useEffect(() => {
    setPage(1);
  }, [monthKey, rcFilter, reportView, typeFilter]);

  const pagedDayRows = useMemo(
    () => paginateItems(dayRows, page, REPORTS_TABLE_PAGE_SIZE),
    [dayRows, page],
  );
  const pagedRevenueRows = useMemo(
    () => paginateItems(revenueRows, page, REPORTS_TABLE_PAGE_SIZE),
    [page, revenueRows],
  );
  const pagedInwardRows = useMemo(
    () => paginateItems(inwardRows, page, REPORTS_TABLE_PAGE_SIZE),
    [inwardRows, page],
  );
  const pageStart = paginationRange(page, listLength, REPORTS_TABLE_PAGE_SIZE).start;

  const showRcSelect = isSuper && sortedRcOptions.length > 0;
  const defaultRcId = sortedRcOptions[0]?.id ?? '';

  useEffect(() => {
    if (!filterOpen) return;
    setDraftView(reportView);
    setDraftType(typeFilter);
    setDraftMonth(monthKey);
    setDraftRc(
      rcFilter !== 'all' && sortedRcOptions.some(rc => rc.id === rcFilter) ? rcFilter : defaultRcId,
    );
  }, [defaultRcId, filterOpen, monthKey, rcFilter, reportView, sortedRcOptions, typeFilter]);

  const applyFilters = () => {
    setReportView(draftView);
    setTypeFilter(draftType);
    setMonthKey(draftMonth);
    if (draftRc) setRcFilter(draftRc);
    setFilterOpen(false);
  };
  const filterActive =
    reportView !== defaultReportView ||
    typeFilter !== 'all' ||
    monthKey !== currentMonthKey() ||
    (showRcSelect && rcFilter !== sortedRcOptions[0]?.id);
  const filterSlot = filterSlots.mobile ?? filterSlots.desktop;
  const monthLabel = formatMonthYear(monthKey);
  const periodText = `${monthLabel}${
    isSerialInward
      ? ' · Serial inward (YesOne webhook)'
      : isRevenue
        ? isRcRevenue
          ? ' · Contractor fee'
          : ' · Revenue share'
        : ' · Day summary'
  }${isSerialInward || typeFilter === 'all' ? '' : ` · ${typeFilter}`}`;

  const shareReport = useCallback(() => {
    if (sharing || isSerialInward) return;
    setShareError('');
    setSharing(true);
    void (async () => {
      try {
        const file = isRevenue
          ? buildReportPdf({
              rcName: selectedRcName,
              period: periodText,
              view: 'revenue_share',
              layout: isRcRevenue ? 'rc' : 'admin',
              rows: revenueRows.map(row => ({
                dateLabel: row.dateLabel,
                qty: row.qty,
                qtyUpto20: row.qtyUpto20,
                qtyAbove20: row.qtyAbove20,
                collected: row.collected,
                interweighing: row.interweighing,
                contractor: row.contractor,
                handling: row.handling,
                rcShare: row.rcShare,
              })),
              totals: {
                qty: revenueTotals.qty,
                qtyUpto20: revenueTotals.qtyUpto20,
                qtyAbove20: revenueTotals.qtyAbove20,
                collected: revenueTotals.collected,
                interweighing: revenueTotals.interweighing,
                contractor: revenueTotals.contractor,
                handling: revenueTotals.handling,
                rcShare: revenueTotals.rcShare,
              },
            })
          : buildReportPdf({
              rcName: selectedRcName,
              period: periodText,
              view: 'day_summary',
              rows: dayRows.map(row => ({
                dateLabel: monthKey === LIFETIME_MONTH_KEY ? row.dateLabel : row.dateShort,
                verified: row.verified,
                qtyUpto20: row.qtyUpto20,
                qtyAbove20: row.qtyAbove20,
              })),
              totals: {
                verified: dayVerifiedTotal,
                qtyUpto20: dayUpto20Total,
                qtyAbove20: dayAbove20Total,
              },
            });
        await shareReportPdf(file, `${selectedRcName} ${periodText}`);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setShareError(err instanceof Error ? err.message : 'Could not share report PDF.');
      } finally {
        setSharing(false);
      }
    })();
  }, [
    dayAbove20Total,
    dayRows,
    dayUpto20Total,
    dayVerifiedTotal,
    isRcRevenue,
    isRevenue,
    isSerialInward,
    monthKey,
    periodText,
    revenueRows,
    revenueTotals,
    selectedRcName,
    sharing,
  ]);

  useLayoutEffect(() => {
    if (!setReportsAppBar) return;
    setReportsAppBar({
      title: selectedRcName,
      period: periodText,
      onShare: isSerialInward ? undefined : shareReport,
      sharing: sharing || loading,
    });
  }, [isSerialInward, loading, periodText, selectedRcName, setReportsAppBar, shareReport, sharing]);

  useLayoutEffect(() => {
    return () => setReportsAppBar?.(null);
  }, [setReportsAppBar]);

  const filterControl = (
    <div className="wl-cert-filter verification-app-filter reports-filter" ref={filterRef}>
      <button
        type="button"
        className={`wl-cert-filter-btn verification-app-filter__btn${
          filterOpen || filterActive ? ' wl-cert-filter-btn--on verification-app-filter__btn--on' : ''
        }`}
        aria-label="Filter report by view, RC, type, and month"
        aria-expanded={filterOpen}
        onClick={() => setFilterOpen(open => !open)}
      >
        <FilterIcon size={18} />
      </button>
      {filterOpen ? (
        <div
          className="verification-app-filter__pop reports-filter__pop"
          role="dialog"
          aria-label="Report filters"
        >
          <div className="verification-app-filter__head">
            <p className="verification-app-filter__title">Filters</p>
            <button
              type="button"
              className="verification-app-filter__close"
              onClick={() => setFilterOpen(false)}
              aria-label="Close filters"
            >
              <X size={16} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
          <div className="verification-app-filter__body">
            <label className="verification-app-filter__label" htmlFor="reports-filter-view">
              Report
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="reports-filter-view"
                className="verification-app-filter__select"
                value={draftView}
                onChange={event => setDraftView(event.target.value as ReportView)}
              >
                <option value="day_summary">Day summary</option>
                <option value="revenue_share">
                  {isSuper ? 'Revenue share' : 'Contractor fee'}
                </option>
                <option value="serial_inward">Serial inward (YesOne webhook)</option>
              </select>
            </div>
            {showRcSelect ? (
              <>
                <label className="verification-app-filter__label" htmlFor="reports-filter-rc">
                  RC
                </label>
                <div className="verification-app-filter__select-wrap">
                  <select
                    id="reports-filter-rc"
                    className="verification-app-filter__select"
                    value={
                      sortedRcOptions.some(rc => rc.id === draftRc) ? draftRc : defaultRcId
                    }
                    onChange={event => setDraftRc(event.target.value)}
                  >
                    {sortedRcOptions.map(rc => (
                      <option key={rc.id} value={rc.id} title={rc.name}>
                        {rc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
            {draftView !== 'serial_inward' ? (
              <>
            <label className="verification-app-filter__label" htmlFor="reports-filter-type">
              Type
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="reports-filter-type"
                className="verification-app-filter__select"
                value={draftType}
                onChange={event => setDraftType(event.target.value as TypeFilter)}
              >
                <option value="all">All</option>
                <option value="OV">OV</option>
                <option value="RV">RV</option>
              </select>
            </div>
              </>
            ) : null}
            <label className="verification-app-filter__label" htmlFor="reports-filter-month">
              Month year
            </label>
            <div className="verification-app-filter__select-wrap">
              <select
                id="reports-filter-month"
                className="verification-app-filter__select"
                value={draftMonth}
                onChange={event => setDraftMonth(event.target.value)}
              >
                {monthOptions.map(key => (
                  <option key={key} value={key}>
                    {formatMonthYear(key)}
                  </option>
                ))}
                <option value={LIFETIME_MONTH_KEY}>Lifetime</option>
              </select>
        </div>
          </div>
          <div className="verification-app-filter__foot reports-filter__foot">
            <button type="button" className="reports-filter__apply" onClick={applyFilters}>
              Apply
            </button>
            <button type="button" className="reports-filter__run" onClick={applyFilters}>
              Filter
            </button>
          </div>
        </div>
      ) : null}
      </div>
  );

  return (
    <div className="fade-in reports-page">
      {filterSlot ? createPortal(filterControl, filterSlot) : null}
      {!filterSlot ? <div className="reports-page__head">{filterControl}</div> : null}
      {listError ? (
        <p className="rc-vehicles-summary-error" role="alert">
          {listError}
        </p>
      ) : null}
      {shareError ? (
        <p className="rc-vehicles-summary-error" role="alert">
          {shareError}
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <span className="spinner-inline large" />
        </div>
      ) : (
        <>
          {listLength === 0 ? (
            <div className="reports-empty">
              <Building2 size={28} strokeWidth={1.6} aria-hidden />
              <p>
                {isSerialInward
                  ? `No YesOne webhook serial inward for ${monthLabel}. Try Lifetime.`
                  : isRevenue
                    ? isRcRevenue
                      ? `No contractor fee for ${monthLabel}.`
                      : `No revenue share for ${monthLabel}.`
                    : `No day summary for ${monthLabel}.`}
              </p>
            </div>
          ) : (
            <>
              <div className="reports-sticky">
                {isSerialInward ? (
                  <div className="reports-rev-totals reports-rev-totals--contractor" aria-label="Serial inward totals">
                    <div className="reports-rev-total reports-rev-total--qty" aria-label={`Total qty ${inwardQtyTotal}`}>
                      <span className="reports-rev-total__label">
                        <span className="reports-rev-total__full">Total qty</span>
                        <span className="reports-rev-total__abbr" aria-hidden>Qty</span>
                      </span>
                      <span className="reports-rev-total__value">{inwardQtyTotal}</span>
                    </div>
                  </div>
                ) : null}
                {isRevenue ? (
                  <div
                    className={`reports-rev-totals${isRcRevenue ? ' reports-rev-totals--contractor' : ''}${
                      showHandling ? ' reports-rev-totals--handling' : ''
                    }`}
                    aria-label={isRcRevenue ? 'Contractor fee totals' : 'Revenue share totals'}
                  >
                    <div className="reports-rev-total reports-rev-total--qty" aria-label={`Total qty ${revenueTotals.qty}`}>
                      <span className="reports-rev-total__label">
                        <span className="reports-rev-total__full">Total qty</span>
                        <span className="reports-rev-total__abbr" aria-hidden>Qty</span>
                      </span>
                      <span className="reports-rev-total__value">{revenueTotals.qty}</span>
                    </div>
                    {isRcRevenue ? (
                      <>
                        <div className="reports-rev-total reports-rev-total--due" aria-label={`Due ${formatReportInr(outstandingDue)}`}>
                          <span className="reports-rev-total__label">
                            <span className="reports-rev-total__full">Due</span>
                            <span className="reports-rev-total__abbr" aria-hidden>Due</span>
                          </span>
                          <span className="reports-rev-total__value">
                            {formatReportInr(outstandingDue)}
                          </span>
                        </div>
                        {showHandling ? (
                          <div className="reports-rev-total reports-rev-total--handling" aria-label={`Handling ${formatReportInr(revenueTotals.handling)}`}>
                            <span className="reports-rev-total__label">
                              <span className="reports-rev-total__full">Handling</span>
                              <span className="reports-rev-total__abbr" aria-hidden>Hand.</span>
                            </span>
                            <span className="reports-rev-total__value">
                              {formatReportInr(revenueTotals.handling)}
                            </span>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="reports-rev-total reports-rev-total--collected" aria-label={`Collected ${formatReportInr(revenueTotals.collected)}`}>
                          <span className="reports-rev-total__label">
                            <span className="reports-rev-total__full">Collected</span>
                            <span className="reports-rev-total__abbr" aria-hidden>Coll.</span>
                          </span>
                          <span className="reports-rev-total__value">
                            {formatReportInr(revenueTotals.collected)}
                          </span>
                        </div>
                        <div className="reports-rev-total reports-rev-total--iw" aria-label={`Interweighing ${formatReportInr(revenueTotals.interweighing)}`}>
                          <span className="reports-rev-total__label">
                            <span className="reports-rev-total__full">Interweighing</span>
                            <span className="reports-rev-total__abbr" aria-hidden>IW</span>
                          </span>
                          <span className="reports-rev-total__value">
                            {formatReportInr(revenueTotals.interweighing)}
                          </span>
                        </div>
                        <div className="reports-rev-total reports-rev-total--contractor" aria-label={`Contractor ${formatReportInr(revenueTotals.contractor)}`}>
                          <span className="reports-rev-total__label">
                            <span className="reports-rev-total__full">Contractor</span>
                            <span className="reports-rev-total__abbr" aria-hidden>Contr.</span>
                          </span>
                          <span className="reports-rev-total__value">
                            {formatReportInr(revenueTotals.contractor)}
                          </span>
                        </div>
                      </>
                    )}
          </div>
                ) : null}
                <div className={`reports-toolbar${isRevenue || isSerialInward ? ' reports-toolbar--pager' : ''}`}>
                  <TablePagination
                    page={page}
                    totalItems={listLength}
                    pageSize={REPORTS_TABLE_PAGE_SIZE}
                    onPageChange={setPage}
                    placement="top"
                  />
                  {!isRevenue && !isSerialInward ? (
                    <p className="reports-toolbar__stat">
                      <span>Total qty</span>
                      <strong>{dayVerifiedTotal}</strong>
                    </p>
                  ) : null}
          </div>
        </div>
              {isSerialInward ? (
                <>
                  <ul className="reports-rev-cards reports-inward-cards">
                    {pagedInwardRows.map((row, index) => (
                      <li key={row.id} className="reports-rev-card reports-inward-card">
                        <div className="reports-rev-card__head">
                          <span className="reports-rev-card__sl">{pageStart + index}</span>
                          <span className="reports-rev-card__date">{formatInwardDate(row.at)}</span>
                          <span className="reports-rev-card__qty">{row.totalQty} qty</span>
                        </div>
                        <div className="reports-rev-card__body">
                          <dl className="reports-rev-card__grid reports-inward-card__grid">
                            <div className="reports-inward-card__invoice">
                              <dt>Invoice no</dt>
                              <dd>{row.invoiceNo || '—'}</dd>
                            </div>
                            <div>
                              <dt>Date</dt>
                              <dd>{formatInwardDate(row.at)}</dd>
                            </div>
                            <div>
                              <dt>Time</dt>
                              <dd className="text-mono">{formatInwardTime(row.at)}</dd>
                            </div>
                            <div>
                              <dt>Qty</dt>
                              <dd className="text-mono">{row.totalQty}</dd>
                            </div>
                            <div>
                              <dt>Serial start</dt>
                              <dd className="text-mono">{row.serialStart || '—'}</dd>
                            </div>
                            <div>
                              <dt>Serial end</dt>
                              <dd className="text-mono">{row.serialEnd || '—'}</dd>
                            </div>
                          </dl>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="table-wrap reports-table-wrap">
                    <table className="data-table reports-table reports-inward-table">
                      <thead>
                        <tr>
                          <th className="reports-col-sl">Sl</th>
                          <th>Invoice no</th>
                          <th>Date</th>
                          <th>Time</th>
                          <th>Serial start</th>
                          <th>Serial end</th>
                          <th className="reports-col-qty">Total qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedInwardRows.map((row, index) => (
                          <tr key={row.id}>
                            <td className="reports-col-sl">{pageStart + index}</td>
                            <td>{row.invoiceNo || '—'}</td>
                            <td>{formatInwardDate(row.at)}</td>
                            <td className="text-mono">{formatInwardTime(row.at)}</td>
                            <td className="text-mono">{row.serialStart || '—'}</td>
                            <td className="text-mono">{row.serialEnd || '—'}</td>
                            <td className="reports-col-qty text-mono">{row.totalQty}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td className="reports-col-sl" />
                          <td colSpan={5}>Total</td>
                          <td className="reports-col-qty text-mono">{inwardQtyTotal}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              ) : isRevenue ? (
                <>
                  <ul className="reports-rev-cards">
                    {pagedRevenueRows.map((row, index) => (
                      <li key={row.dateKey} className="reports-rev-card">
                        <div className="reports-rev-card__head">
                          <span className="reports-rev-card__sl">{pageStart + index}</span>
                          <span className="reports-rev-card__date">{row.dateLabel}</span>
                          <span className="reports-rev-card__qty">{row.qty} qty</span>
          </div>
                        <div className="reports-rev-card__body">
                        <div className="reports-rev-card__main">
                        <dl
                          className={`reports-rev-card__grid${
                            isRcRevenue ? ' reports-rev-card__grid--contractor' : ''
                          }${row.handling > 0 ? ' reports-rev-card__grid--handling' : ''}`}
                        >
                          {isRcRevenue ? (
                            <>
                              <div className="reports-amt reports-amt--contractor">
                                <dt>Contractor</dt>
                                <dd>{formatReportInr(row.contractor)}</dd>
                              </div>
                              {row.handling > 0 ? (
                                <div className="reports-amt reports-amt--handling">
                                  <dt>Handling</dt>
                                  <dd>{formatReportInr(row.handling)}</dd>
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <div className="reports-amt reports-amt--collected">
                                <dt>Collected</dt>
                                <dd>{formatReportInr(row.collected)}</dd>
                              </div>
                              <div className="reports-amt reports-amt--iw">
                                <dt>Interweighing</dt>
                                <dd>{formatReportInr(row.interweighing)}</dd>
                              </div>
                              <div className="reports-amt reports-amt--contractor">
                                <dt>Contractor</dt>
                                <dd>{formatReportInr(row.contractor)}</dd>
                              </div>
                            </>
                          )}
                        </dl>
                        {row.qtyUpto20 > 0 || row.qtyAbove20 > 0 ? (
                          <p className="reports-rev-card__meta">
                            {row.qtyUpto20 > 0 ? (
                              <span className="reports-tier reports-tier--first">
                                upto 20kg {row.qtyUpto20}
                              </span>
                            ) : null}
                            {row.qtyAbove20 > 0 ? (
                              <span className="reports-tier reports-tier--above">
                                Above 20Kg {row.qtyAbove20}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                        </div>
                        {isRcRevenue ? (
                          <ContractorFeePayControl
                            rcId={rcFilter}
                            dateKey={row.dateKey}
                            dueInr={contractorDueByDate.get(row.dateKey) ?? row.contractor + row.handling}
                            qty={row.qty}
                            payment={paymentsByDate.get(row.dateKey) ?? null}
                            canPay={isRcAdmin}
                          />
                        ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="table-wrap reports-table-wrap reports-table-wrap--revenue">
                    <table className="data-table reports-table reports-table--revenue">
                      <thead>
                        <tr>
                          <th className="reports-col-sl">Sl</th>
                          <th className="reports-col-date">Date</th>
                          <th className="reports-col-rc">RC name</th>
                          <th className="reports-col-qty">Qty</th>
                          <th className="reports-col-tier">upto 20kg</th>
                          <th className="reports-col-tier">Above 20Kg</th>
                          {isRcRevenue ? (
                            <>
                              <th className="reports-col-inr">Contractor</th>
                              {showHandling ? <th className="reports-col-inr">Handling</th> : null}
                              <th className="reports-col-pay">Proof</th>
                            </>
                          ) : (
                            <>
                              <th className="reports-col-inr">Collected</th>
                              <th className="reports-col-inr">Interweighing</th>
                              <th className="reports-col-inr">Contractor</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRevenueRows.map((row, index) => (
                          <tr key={row.dateKey}>
                            <td className="reports-col-sl text-mono">{pageStart + index}</td>
                            <td className="reports-col-date">{row.dateLabel}</td>
                            <td className="reports-col-rc">{row.rcName}</td>
                            <td className="reports-col-qty text-mono">{row.qty}</td>
                            <td className="reports-col-tier reports-tier--first text-mono">
                              {row.qtyUpto20}
                            </td>
                            <td className="reports-col-tier reports-tier--above text-mono">
                              {row.qtyAbove20}
                            </td>
                            {isRcRevenue ? (
                              <>
                                <td className="reports-col-inr reports-amt--contractor text-mono">
                                  {formatReportInr(row.contractor)}
                                </td>
                                {showHandling ? (
                                  <td className="reports-col-inr reports-amt--handling text-mono">
                                    {row.handling > 0 ? formatReportInr(row.handling) : '—'}
                                  </td>
                                ) : null}
                                <td className="reports-col-pay">
                                  <ContractorFeePayControl
                                    rcId={rcFilter}
                                    dateKey={row.dateKey}
                                    dueInr={contractorDueByDate.get(row.dateKey) ?? row.contractor + row.handling}
                                    qty={row.qty}
                                    payment={paymentsByDate.get(row.dateKey) ?? null}
                                    canPay={isRcAdmin}
                                  />
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="reports-col-inr reports-amt--collected text-mono">
                                  {formatReportInr(row.collected)}
                                </td>
                                <td className="reports-col-inr reports-amt--iw text-mono">
                                  {formatReportInr(row.interweighing)}
                                </td>
                                <td className="reports-col-inr reports-amt--contractor text-mono">
                                  {formatReportInr(row.contractor)}
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td className="reports-col-sl" />
                          <td className="reports-col-date">Total</td>
                          <td className="reports-col-rc">{selectedRcName}</td>
                          <td className="reports-col-qty text-mono">{revenueTotals.qty}</td>
                          <td className="reports-col-tier reports-tier--first text-mono">
                            {revenueTotals.qtyUpto20}
                          </td>
                          <td className="reports-col-tier reports-tier--above text-mono">
                            {revenueTotals.qtyAbove20}
                          </td>
                          {isRcRevenue ? (
                            <>
                              <td className="reports-col-inr reports-amt--contractor text-mono">
                                {formatReportInr(outstandingDue)}
                              </td>
                              {showHandling ? (
                                <td className="reports-col-inr reports-amt--handling text-mono">
                                  {formatReportInr(revenueTotals.handling)}
                                </td>
                              ) : null}
                              <td className="reports-col-pay" />
                            </>
                          ) : (
                            <>
                              <td className="reports-col-inr reports-amt--collected text-mono">
                                {formatReportInr(revenueTotals.collected)}
                              </td>
                              <td className="reports-col-inr reports-amt--iw text-mono">
                                {formatReportInr(revenueTotals.interweighing)}
                              </td>
                              <td className="reports-col-inr reports-amt--contractor text-mono">
                                {formatReportInr(revenueTotals.contractor)}
                              </td>
                            </>
                          )}
                        </tr>
                      </tfoot>
                    </table>
          </div>
                </>
              ) : (
                <>
                  <ul className="reports-day-cards">
                    <li className="reports-day-card reports-day-card--head">
                      <span>Sl</span>
                      <span>Date</span>
                      <span className="reports-day-card__tier-h reports-tier--first">Upto 20kg</span>
                      <span className="reports-day-card__tier-h reports-tier--above">Above 20kg</span>
                      <span>Qty</span>
                    </li>
                    {pagedDayRows.map((row, index) => (
                      <li key={row.dateKey} className="reports-day-card">
                        <span className="reports-day-card__sl">{pageStart + index}</span>
                        <span className="reports-day-card__date">
                          {monthKey === LIFETIME_MONTH_KEY ? row.dateLabel : row.dateShort}
                        </span>
                        <span className="reports-day-card__tier reports-day-card__tier--upto">
                          {row.qtyUpto20 > 0 ? row.qtyUpto20 : ''}
                        </span>
                        <span className="reports-day-card__tier reports-day-card__tier--above">
                          {row.qtyAbove20 > 0 ? row.qtyAbove20 : ''}
                        </span>
                        <span className="reports-day-card__qty">{row.verified}</span>
                      </li>
                    ))}
                    <li className="reports-day-card reports-day-card--total">
                      <span />
                      <span>Total</span>
                      <span className="reports-day-card__tier reports-day-card__tier--upto">
                        {dayUpto20Total > 0 ? dayUpto20Total : ''}
                      </span>
                      <span className="reports-day-card__tier reports-day-card__tier--above">
                        {dayAbove20Total > 0 ? dayAbove20Total : ''}
                      </span>
                      <span>{dayVerifiedTotal}</span>
                    </li>
                  </ul>
                  <div className="table-wrap reports-table-wrap reports-table-wrap--day">
                    <table className="data-table reports-table">
                      <thead>
                        <tr>
                          <th className="reports-col-sl">Sl number</th>
                          <th className="reports-col-date">Date</th>
                          <th className="reports-col-tier reports-tier--first">Upto 20kg sum</th>
                          <th className="reports-col-tier reports-tier--above">Above 20 kg sum</th>
                          <th className="reports-col-qty">Total qty</th>
                          <th className="reports-col-rc">RC name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedDayRows.map((row, index) => (
                          <tr key={row.dateKey}>
                            <td className="reports-col-sl text-mono">{pageStart + index}</td>
                            <td className="reports-col-date">{row.dateLabel}</td>
                            <td className="reports-col-tier reports-tier--first text-mono">
                              {row.qtyUpto20 > 0 ? row.qtyUpto20 : ''}
                            </td>
                            <td className="reports-col-tier reports-tier--above text-mono">
                              {row.qtyAbove20 > 0 ? row.qtyAbove20 : ''}
                            </td>
                            <td className="reports-col-qty text-mono">{row.verified}</td>
                            <td className="reports-col-rc">{row.rcName}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td className="reports-col-sl" />
                          <td className="reports-col-date">Total</td>
                          <td className="reports-col-tier reports-tier--first text-mono">
                            {dayUpto20Total > 0 ? dayUpto20Total : ''}
                          </td>
                          <td className="reports-col-tier reports-tier--above text-mono">
                            {dayAbove20Total > 0 ? dayAbove20Total : ''}
                          </td>
                          <td className="reports-col-qty text-mono">{dayVerifiedTotal}</td>
                          <td className="reports-col-rc">{selectedRcName}</td>
                        </tr>
                      </tfoot>
                    </table>
        </div>
                </>
              )}
              <TablePagination
                page={page}
                totalItems={listLength}
                pageSize={REPORTS_TABLE_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </>
      )}
    </div>
  );
};
