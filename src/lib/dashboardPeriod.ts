export type DashboardPeriod = 'today' | 'month' | 'quarter' | 'year' | 'lifetime' | 'custom';

export const DASHBOARD_PERIODS: { key: DashboardPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'lifetime', label: 'Lifetime' },
  { key: 'custom', label: 'Custom' },
];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function toInputDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfQuarter(date: Date): Date {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
}

export function dashboardPeriodBounds(
  period: DashboardPeriod,
  customFrom: string,
  customTo: string,
): { from: number | null; to: number | null } {
  const now = new Date();
  const end = now.getTime();
  if (period === 'lifetime') return { from: null, to: null };
  if (period === 'today') {
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), to: end };
  }
  if (period === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: end };
  }
  if (period === 'quarter') {
    return { from: startOfQuarter(now).getTime(), to: end };
  }
  if (period === 'year') {
    return { from: new Date(now.getFullYear(), 0, 1).getTime(), to: end };
  }
  const from = customFrom ? Date.parse(`${customFrom}T00:00:00`) : null;
  const to = customTo ? Date.parse(`${customTo}T23:59:59.999`) : null;
  return {
    from: from != null && Number.isFinite(from) ? from : null,
    to: to != null && Number.isFinite(to) ? to : null,
  };
}

export function stampInDashboardPeriod(
  stamp: number,
  period: DashboardPeriod,
  customFrom: string,
  customTo: string,
): boolean {
  if (!Number.isFinite(stamp)) return period === 'lifetime';
  const { from, to } = dashboardPeriodBounds(period, customFrom, customTo);
  if (from != null && stamp < from) return false;
  if (to != null && stamp > to) return false;
  return true;
}

export function recordInDashboardPeriod(
  record: { createdAt?: string; certifiedAt?: string; approvedAt?: string },
  period: DashboardPeriod,
  customFrom: string,
  customTo: string,
): boolean {
  const raw = record.createdAt || record.certifiedAt || record.approvedAt || '';
  return stampInDashboardPeriod(Date.parse(raw), period, customFrom, customTo);
}
