import { auth } from '../firebase';
import type { YesonePushError, YesonePushLog } from './yesoneWebhookSettings';

const TEST_YESONE_URL = 'https://us-central1-yesgatc.cloudfunctions.net/testYesoneWebhook';
const SYNC_USED_URL = 'https://us-central1-yesgatc.cloudfunctions.net/syncYesoneOvUsed';
const TEST_TIMEOUT_MS = 540_000;
const SYNC_TIMEOUT_MS = 120_000;

export type YesoneOvUsedSyncLog = {
  at: string;
  ok: boolean;
  rcTotal: number;
  rcSent: number;
  rcFailed: number;
  errors: YesonePushError[];
};

async function postYesoneAdmin(
  url: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in required.');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | (Record<string, unknown> & { error?: string })
      | null;
    if (!response.ok) {
      throw new Error(payload?.error?.trim() || `Push failed (${response.status}).`);
    }
    if (!payload) throw new Error('Push returned an empty log.');
    return payload;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Push timed out.');
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function testYesoneWebhook(): Promise<YesonePushLog> {
  const payload = await postYesoneAdmin(TEST_YESONE_URL, TEST_TIMEOUT_MS);
  if (typeof payload.rcTotal !== 'number') {
    throw new Error('Push returned an empty log.');
  }
  return payload as YesonePushLog;
}

export async function syncYesoneOvUsed(): Promise<YesoneOvUsedSyncLog> {
  const payload = await postYesoneAdmin(SYNC_USED_URL, SYNC_TIMEOUT_MS);
  if (typeof payload.rcTotal !== 'number') {
    throw new Error('Syn returned an empty log.');
  }
  const errors = Array.isArray(payload.errors)
    ? payload.errors.filter((item): item is YesonePushError => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as YesonePushError).kind === 'string'
      && typeof (item as YesonePushError).id === 'string'
      && typeof (item as YesonePushError).error === 'string'
    ))
    : [];
  return {
    at: String(payload.at ?? ''),
    ok: payload.ok === true,
    rcTotal: Number(payload.rcTotal) || 0,
    rcSent: Number(payload.rcSent) || 0,
    rcFailed: Number(payload.rcFailed) || 0,
    errors,
  };
}
