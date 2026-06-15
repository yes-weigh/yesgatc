import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

const FUNCTIONS_REGION = 'us-central1';

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function downloadStorageFileBytes(storagePath: string): Promise<Uint8Array> {
  const fn = httpsCallable<{ storagePath: string }, { base64: string }>(
    getFunctions(app, FUNCTIONS_REGION),
    'downloadStorageFileBytes',
  );
  const result = await fn({ storagePath: storagePath.trim() });
  return base64ToUint8Array(result.data.base64);
}
