export type YesonePushError = {
  kind: string;
  id: string;
  event?: string;
  error: string;
};

export type YesonePushLog = {
  at: string;
  ok: boolean;
  rcTotal: number;
  rcSent: number;
  rcFailed: number;
  certTotal: number;
  certSent: number;
  certFailed: number;
  certSkipped: number;
  incomplete: boolean;
  errors: YesonePushError[];
};

export type YesoneWebhookSettings = {
  yesoneWebhookUrl: string;
  yesoneWebhookEnabled: boolean;
  yesoneLastPushAt: string;
  yesoneLastPushLog: YesonePushLog | null;
};

export const DEFAULT_YESONE_WEBHOOK_SETTINGS: YesoneWebhookSettings = {
  yesoneWebhookUrl: '',
  yesoneWebhookEnabled: false,
  yesoneLastPushAt: '',
  yesoneLastPushLog: null,
};

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
    yesoneLastPushLog:
      data?.yesoneLastPushLog && typeof data.yesoneLastPushLog === 'object'
        ? (data.yesoneLastPushLog as YesonePushLog)
        : null,
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
