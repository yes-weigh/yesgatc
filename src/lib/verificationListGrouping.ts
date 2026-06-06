import { isVerificationCertificateVoided } from './verificationCertificateVoid';
import {
  isCorruptedCertificateRecord,
  normalizeSerialKey,
} from './verificationResubmit';
import {
  canShowVerificationCertifiedActions,
  isVerificationCertifiedOnDoca,
  matchesVerificationStatusFilter,
  matchesVerificationTypeFilter,
  normalizeVerificationStatus,
  type VerificationStatusFilter,
  type VerificationTypeFilter,
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

/** Records visible in the list after applying all filters except those omitted (for chip/dropdown counts). */
export function verificationListRecordsForFilterCounts(
  allRecords: SiteCalibration[],
  filters: VerificationListActiveFilters,
  omit: VerificationListCountOmitFilter | VerificationListCountOmitFilter[],
): VerificationListDisplayRecord[] {
  const omitted = new Set(Array.isArray(omit) ? omit : [omit]);
  const filtered = allRecords.filter(record => {
    if (!omitted.has('search')) {
      const extras = filters.searchExtras?.(record) ?? {};
      if (!matchesVerificationSearch(record, filters.searchTerm ?? '', extras)) {
        return false;
      }
    }
    if (!omitted.has('status') && !matchesVerificationStatusFilter(record, filters.statusFilter)) {
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
  return collapseVerificationsForListDisplay(filtered, allRecords);
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
  if (isCorruptedCertificateRecord(record)) return 85;

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

    const visibleInFilter = fullGroup.some(member =>
      filtered.some(row => row.id === member.id),
    );
    if (!visibleInFilter) continue;

    const primary = pickPrimaryListRecord(fullGroup);
    collapsed.push({
      ...primary,
      serialVersionCount: fullGroup.length,
    });
  }

  return sortVerificationsByCertificateDesc(collapsed);
}
