import { yesonePlainLogsFromList, type YesonePlainLogRow } from './yesoneInboundData';

export type YesonePushError = {
  kind: string;
  id: string;
  event?: string;
  error: string;
};

export type YesonePushLog = {
  at: string;
  ok: boolean;
  phase?: string;
  rcTotal: number;
  rcSent: number;
  rcFailed: number;
  certTotal: number;
  certSent: number;
  certFailed: number;
  certSkipped: number;
  certLatestSequence?: number;
  incomplete: boolean;
  running?: boolean;
  errors: YesonePushError[];
};

export type YesoneInboundLog = {
  at: string;
  ok: boolean;
  event: string;
  count: number;
  error?: string;
};

export type YesoneWebhookSettings = {
  yesoneWebhookUrl: string;
  yesoneWebhookEnabled: boolean;
  yesoneLastPushAt: string;
  yesoneLastPushLog: YesonePushLog | null;
  yesonePushProgress: YesonePushLog | null;
  yesoneInboundToken: string;
  yesoneLastInboundAt: string;
  yesoneLastInboundLog: YesoneInboundLog | null;
  yesoneInboundLogs: YesonePlainLogRow[];
};

export const DEFAULT_YESONE_WEBHOOK_SETTINGS: YesoneWebhookSettings = {
  yesoneWebhookUrl: '',
  yesoneWebhookEnabled: false,
  yesoneLastPushAt: '',
  yesoneLastPushLog: null,
  yesonePushProgress: null,
  yesoneInboundToken: '',
  yesoneLastInboundAt: '',
  yesoneLastInboundLog: null,
  yesoneInboundLogs: [],
};

function asCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeYesonePushLog(raw: unknown): YesonePushLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const errors = Array.isArray(data.errors)
    ? data.errors.filter((item): item is YesonePushError => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as YesonePushError).kind === 'string'
      && typeof (item as YesonePushError).id === 'string'
      && typeof (item as YesonePushError).error === 'string'
    ))
    : [];
  return {
    at: String(data.at ?? ''),
    ok: data.ok === true,
    phase: String(data.phase ?? ''),
    rcTotal: asCount(data.rcTotal),
    rcSent: asCount(data.rcSent),
    rcFailed: asCount(data.rcFailed),
    certTotal: asCount(data.certTotal),
    certSent: asCount(data.certSent),
    certFailed: asCount(data.certFailed),
    certSkipped: asCount(data.certSkipped),
    certLatestSequence: asCount(data.certLatestSequence) || undefined,
    incomplete: data.incomplete === true,
    running: data.running === true,
    errors,
  };
}

export function yesonePushCounts(log: Pick<
  YesonePushLog,
  'rcSent' | 'rcFailed' | 'rcTotal' | 'certSent' | 'certFailed' | 'certTotal'
>) {
  const rcDone = log.rcSent + log.rcFailed;
  const certDone = log.certSent + log.certFailed;
  return {
    rcDone,
    certDone,
    done: rcDone + certDone,
    total: log.rcTotal + log.certTotal,
  };
}

export function normalizeYesoneWebhookUrl(value: unknown): string {
  return String(value ?? '').trim();
}

export function isAllowedYesoneWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (local) return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  return parsed.protocol === 'https:';
}

export function normalizeYesoneInboundLog(raw: unknown): YesoneInboundLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const event = String(data.event ?? '').trim();
  if (!event) return null;
  return {
    at: String(data.at ?? ''),
    ok: data.ok === true,
    event,
    count: asCount(data.count) || 1,
    error: String(data.error ?? '').trim() || undefined,
  };
}

export function normalizeYesoneWebhookSettings(
  data: Partial<YesoneWebhookSettings> | undefined,
): YesoneWebhookSettings {
  const yesoneWebhookUrl = normalizeYesoneWebhookUrl(data?.yesoneWebhookUrl);
  const explicitEnabled = data?.yesoneWebhookEnabled === true;
  const explicitDisabled = data?.yesoneWebhookEnabled === false;
  const yesoneWebhookEnabled = explicitDisabled
    ? false
    : explicitEnabled || isAllowedYesoneWebhookUrl(yesoneWebhookUrl);

  return {
    yesoneWebhookUrl,
    yesoneWebhookEnabled: yesoneWebhookEnabled && isAllowedYesoneWebhookUrl(yesoneWebhookUrl),
    yesoneLastPushAt: String(data?.yesoneLastPushAt ?? '').trim(),
    yesoneLastPushLog: normalizeYesonePushLog(data?.yesoneLastPushLog),
    yesonePushProgress: normalizeYesonePushLog(data?.yesonePushProgress),
    yesoneInboundToken: String(data?.yesoneInboundToken ?? '').trim(),
    yesoneLastInboundAt: String(data?.yesoneLastInboundAt ?? '').trim(),
    yesoneLastInboundLog: normalizeYesoneInboundLog(data?.yesoneLastInboundLog),
    yesoneInboundLogs: yesonePlainLogsFromList(data?.yesoneInboundLogs),
  };
}

export function validateYesoneWebhookUrlInput(raw: string): string | null {
  const url = normalizeYesoneWebhookUrl(raw);
  if (!url) return null;
  if (!isAllowedYesoneWebhookUrl(url)) {
    return 'Paste a full https URL (http allowed only for localhost).';
  }
  return null;
}
