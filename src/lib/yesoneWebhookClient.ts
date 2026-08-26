import { auth } from '../firebase';
import type { YesonePushLog } from './yesoneWebhookSettings';

const TEST_YESONE_URL = 'https://us-central1-yesgatc.cloudfunctions.net/testYesoneWebhook';
const TEST_TIMEOUT_MS = 540_000;

export async function testYesoneWebhook(): Promise<YesonePushLog> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in required.');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const response = await fetch(TEST_YESONE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | (YesonePushLog & { error?: string })
      | null;
    if (!response.ok) {
      throw new Error(payload?.error?.trim() || `Push failed (${response.status}).`);
    }
    if (!payload || typeof payload.rcTotal !== 'number') {
      throw new Error('Push returned an empty log.');
    }
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
