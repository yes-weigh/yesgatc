import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';
import type { YesonePushLog } from './yesoneWebhookSettings';

const FUNCTIONS_REGION = 'us-central1';

function functionsClient() {
  return getFunctions(app, FUNCTIONS_REGION);
}

export async function testYesoneWebhook(): Promise<YesonePushLog> {
  const fn = httpsCallable<Record<string, never>, YesonePushLog>(
    functionsClient(),
    'testYesoneWebhook',
    { timeout: 540_000 },
  );
  const result = await fn({});
  return result.data;
}
