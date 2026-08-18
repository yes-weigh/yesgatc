import type { SiteCalibration } from '../types';
import { recordActivityStamp, type DashboardPeriod } from './dashboardPeriod';

export type VerificationDurationFilter =
  | 'all'
  | 'month'
  | 'prevMonth'
  | 'quarter'
  | 'prevQuarter'
  | 'year'
  | 'prevYear';

export const VERIFICATION_DURATION_OPTIONS: { id: VerificationDurationFilter; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'month', label: 'This month' },
  { id: 'prevMonth', label: 'Last month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'prevQuarter', label: 'Last quarter' },
  { id: 'year', label: 'This year' },
  { id: 'prevYear', label: 'Last year' },
];

function startOfQuarter(date: Date): Date {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

function recordDate(record: SiteCalibration): Date | null {
  const stamp = recordActivityStamp(record);
  if (!Number.isFinite(stamp)) return null;
  return new Date(stamp);
}

export function parseVerificationDurationParam(
  raw: string | null,
): VerificationDurationFilter | null {
  if (!raw) return null;
  return VERIFICATION_DURATION_OPTIONS.some(option => option.id === raw)
    ? (raw as VerificationDurationFilter)
    : null;
}

export function dashboardPeriodToListDuration(
  period: DashboardPeriod,
): VerificationDurationFilter {
  if (period === 'month' || period === 'quarter' || period === 'year') return period;
  return 'all';
}

export function verificationListPath(
  basePath: string,
  query?: {
    status?: string | null;
    type?: string | null;
    duration?: VerificationDurationFilter | null;
    rc?: string | null;
  },
): string {
  const params = new URLSearchParams();
  if (query?.status && query.status !== 'all') params.set('status', query.status);
  if (query?.type && query.type !== 'all') params.set('type', query.type);
  if (query?.duration && query.duration !== 'all') params.set('duration', query.duration);
  if (query?.rc) params.set('rc', query.rc);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function matchesVerificationDurationFilter(
  record: SiteCalibration,
  duration: VerificationDurationFilter,
): boolean {
  if (duration === 'all') return true;
  const created = recordDate(record);
  if (!created) return false;
  const now = new Date();
  if (duration === 'month') {
    return created >= new Date(now.getFullYear(), now.getMonth(), 1) && created <= now;
  }
  if (duration === 'prevMonth') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return created >= from && created <= to;
  }
  if (duration === 'quarter') {
    return created >= startOfQuarter(now) && created <= now;
  }
  if (duration === 'prevQuarter') {
    const thisQ = startOfQuarter(now);
    const from = startOfQuarter(new Date(thisQ.getFullYear(), thisQ.getMonth() - 3, 1));
    const to = new Date(thisQ.getTime() - 1);
    return created >= from && created <= to;
  }
  if (duration === 'year') {
    return created >= new Date(now.getFullYear(), 0, 1) && created <= now;
  }
  const from = new Date(now.getFullYear() - 1, 0, 1);
  const to = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
  return created >= from && created <= to;
}
