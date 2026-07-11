import { isVerificationCertificateVoided } from './verificationCertificateVoid';
import {
  isCorruptedCertificateRecord,
  normalizeSerialKey,
} from './verificationResubmit';
import {
  canShowVerificationCertifiedActions,
  isVerificationCertifiedOnDoca,
  isVerificationFailedAtCertification,
  isVerificationRejected,
  matchesVerificationStatusFilter,
  matchesVerificationTypeFilter,
  normalizeVerificationStatus,
  verificationStatusFilterBucket,
  type VerificationStatusFilter,
  type VerificationTypeFilter,
  type VerificationStatusFilterCounts,
} from './verificationRequest';
import { matchesVerificationSearch, type VerificationSearchExtras } from './verificationListSearch';
import { sortVerificationsByCertificateDesc } from './verificationListSort';
import type { SiteCalibration } from '../types';

export type VerificationListActiveFilters = {
  statusFilter: VerificationStatusFilter;
  typeFilter: VerificationTypeFilter;
  rcFilter?: string;
  searchTerm?: string;
  searchExtras?: (record: SiteCalibration) => VerificationSearchExtras;
};

export type VerificationListCountOmitFilter = 'status' | 'type' | 'rc' | 'search';

/** Records matching active filters except those omitted — raw Firestore rows (for chip/dropdown counts). */
export function verificationListRecordsForFilterCounts(
  allRecords: SiteCalibration[],
  filters: VerificationListActiveFilters,
  omit: VerificationListCountOmitFilter | VerificationListCountOmitFilter[],
): SiteCalibration[] {
  const omitted = new Set(Array.isArray(omit) ? omit : [omit]);
  const primaryIds = buildDuplicatePrimaryIdSet(allRecords);
  const groups = buildSerialGroupMap(allRecords);

  return allRecords.filter(record => {
    if (!omitted.has('search')) {
      const extras = filters.searchExtras?.(record) ?? {};
      if (!matchesVerificationSearch(record, filters.searchTerm ?? '', extras)) {
        return false;
      }
    }
    if (
      !omitted.has('status') &&
      !matchesVerificationListStatusFilter(record, filters.statusFilter, allRecords, primaryIds, groups)
    ) {
      return false;
    }
    if (!omitted.has('type') && !matchesVerificationTypeFilter(record, filters.typeFilter)) {
      return false;
    }
    if (
      !omitted.has('rc') &&
      filters.rcFilter &&
      filters.rcFilter !== 'all' &&
      (record.rcId || '') !== filters.rcFilter
    ) {
      return false;
    }
    return true;
  });
}

/** Collapsed list rows for chip/dropdown counts (one row per RC + serial). */
export function verificationListCollapsedForCounts(
  allRecords: SiteCalibration[],
  filters: VerificationListActiveFilters,
  omit: VerificationListCountOmitFilter | VerificationListCountOmitFilter[],
): VerificationListDisplayRecord[] {
  const filtered = verificationListRecordsForFilterCounts(allRecords, filters, omit);
  return buildVerificationListDisplay(filtered, allRecords, filters.statusFilter);
}

export type VerificationListDisplayRecord = SiteCalibration & {
  /** Total Firestore records for this RC + serial (including hidden duplicates). */
  serialVersionCount: number;
};

export function serialGroupKey(record: SiteCalibration): string | null {
  const rcId = record.rcId?.trim();
  const serial = normalizeSerialKey(record.serialNumber);
  if (!rcId || !serial) return null;
  return `${rcId}|${serial}`;
}

export function buildSerialGroupMap(
  allRecords: SiteCalibration[],
): Map<string, SiteCalibration[]> {
  const map = new Map<string, SiteCalibration[]>();

  for (const record of allRecords) {
    const key = serialGroupKey(record);
    if (!key) continue;
    const group = map.get(key) ?? [];
    group.push(record);
    map.set(key, group);
  }

  return map;
}

/** Lower score = preferred primary row in the verification list. */
function listRecordScore(record: SiteCalibration): number {
  if (isVerificationCertificateVoided(record)) return 100;
  if (isVerificationRejected(record)) return 55;
  if (isCorruptedCertificateRecord(record)) return 85;
  if (isVerificationFailedAtCertification(record)) return 80;

  const status = normalizeVerificationStatus(record);
  if (status === 'submitted' || status === 'approved') {
    return record.resubmittedFromId?.trim() ? 5 : 45;
  }

  if (canShowVerificationCertifiedActions(record) || isVerificationCertifiedOnDoca(record)) {
    return 0;
  }

  if (status === 'draft') return 60;
  return 70;
}

function recordRecencyKey(record: SiteCalibration): string {
  return (
    record.certifiedAt ||
    record.approvedAt ||
    record.submittedAt ||
    record.createdAt ||
    ''
  );
}

/** Primary row id per RC + serial group (and every record without a serial key). */
export function buildDuplicatePrimaryIdSet(allRecords: SiteCalibration[]): Set<string> {
  const primaryIds = new Set<string>();
  const groups = buildSerialGroupMap(allRecords);

  for (const group of groups.values()) {
    primaryIds.add(pickPrimaryListRecord(group).id);
  }

  for (const record of allRecords) {
    if (!serialGroupKey(record)) {
      primaryIds.add(record.id);
    }
  }

  return primaryIds;
}

export function isVerificationListDuplicate(
  record: SiteCalibration,
  primaryIds: Set<string>,
): boolean {
  const key = serialGroupKey(record);
  return Boolean(key && !primaryIds.has(record.id));
}

export function matchesVerificationListStatusFilter(
  record: SiteCalibration,
  filter: VerificationStatusFilter,
  _allRecords: SiteCalibration[],
  primaryIds: Set<string>,
  _groups: Map<string, SiteCalibration[]> = new Map(),
): boolean {
  if (filter === 'duplicates') {
    return isVerificationListDuplicate(record, primaryIds);
  }
  if (filter === 'all') return true;

  // Match this row's own stage — not the serial-group primary — so Draft/Submitted/etc.
  // chips stay aligned with rows that actually appear after collapse.
  return matchesVerificationStatusFilter(record, filter);
}

export function countVerificationDuplicates(
  filteredRecords: SiteCalibration[],
  allRecords: SiteCalibration[],
): number {
  const primaryIds = buildDuplicatePrimaryIdSet(allRecords);
  let duplicates = 0;
  for (const record of filteredRecords) {
    if (isVerificationListDuplicate(record, primaryIds)) {
      duplicates += 1;
    }
  }
  return duplicates;
}

/** Collapse to unique serials for all stages except Duplicates. */
export function buildVerificationListDisplay(
  filtered: SiteCalibration[],
  allRecords: SiteCalibration[],
  statusFilter: VerificationStatusFilter,
): VerificationListDisplayRecord[] {
  if (statusFilter === 'duplicates') {
    const groups = buildSerialGroupMap(allRecords);
    return sortVerificationsByCertificateDesc(
      filtered.map(record => {
        const key = serialGroupKey(record);
        return {
          ...record,
          serialVersionCount: key ? (groups.get(key)?.length ?? 1) : 1,
        };
      }),
    );
  }

  return collapseVerificationsForListDisplay(filtered, allRecords);
}

/** Best row to represent a serial in list views (active cert first, void copies last). */
export function pickPrimaryListRecord(group: SiteCalibration[]): SiteCalibration {
  return [...group].sort((a, b) => {
    const scoreDiff = listRecordScore(a) - listRecordScore(b);
    if (scoreDiff !== 0) return scoreDiff;
    return recordRecencyKey(b).localeCompare(recordRecencyKey(a));
  })[0];
}

/**
 * One table row per RC + serial. Opening the row still loads every version via
 * getVerificationSerialGroup(allRecords, primary).
 */
export function collapseVerificationsForListDisplay(
  filtered: SiteCalibration[],
  allRecords: SiteCalibration[],
): VerificationListDisplayRecord[] {
  const groups = buildSerialGroupMap(allRecords);
  const keysInFiltered = new Set<string>();
  const withoutSerialKey: SiteCalibration[] = [];

  for (const record of filtered) {
    const key = serialGroupKey(record);
    if (!key) {
      withoutSerialKey.push(record);
      continue;
    }
    keysInFiltered.add(key);
  }

  const collapsed: VerificationListDisplayRecord[] = withoutSerialKey.map(record => ({
    ...record,
    serialVersionCount: 1,
  }));

  for (const key of keysInFiltered) {
    const fullGroup = groups.get(key);
    if (!fullGroup?.length) continue;

    const membersInFilter = fullGroup.filter(member =>
      filtered.some(row => row.id === member.id),
    );
    if (!membersInFilter.length) continue;

    const primary = pickPrimaryListRecord(membersInFilter);
    collapsed.push({
      ...primary,
      serialVersionCount: fullGroup.length,
    });
  }

  return sortVerificationsByCertificateDesc(collapsed);
}

/** Status dropdown counts — one row per RC + serial; stage buckets partition All. */
export function tallyVerificationStatusFiltersCollapsed(
  allRecords: SiteCalibration[],
  filters: VerificationListActiveFilters,
): VerificationStatusFilterCounts {
  const collapsed = verificationListCollapsedForCounts(
    allRecords,
    { ...filters, statusFilter: 'all' },
    'status',
  );
  const groups = buildSerialGroupMap(allRecords);

  const tally: VerificationStatusFilterCounts = {
    all: collapsed.length,
    draft: 0,
    submitted: 0,
    approved: 0,
    certified: 0,
    failed_submit: 0,
    failed_certification: 0,
    rejected: 0,
    duplicates: 0,
  };

  for (const row of collapsed) {
    const key = serialGroupKey(row);
    const group = key ? groups.get(key) : null;
    // Same row the All-stages list shows for this serial.
    const primary = group?.length ? pickPrimaryListRecord(group) : row;
    tally[verificationStatusFilterBucket(primary)] += 1;
  }

  const duplicateRecords = verificationListRecordsForFilterCounts(
    allRecords,
    { ...filters, statusFilter: 'duplicates' },
    'status',
  );
  tally.duplicates = countVerificationDuplicates(duplicateRecords, allRecords);

  return tally;
}
