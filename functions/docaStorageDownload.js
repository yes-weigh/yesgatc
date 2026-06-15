const { HttpsError } = require('firebase-functions/v2/https');
const { getStorage } = require('firebase-admin/storage');

const STORAGE_BUCKETS = ['yesgatc.firebasestorage.app', 'yesgatc.appspot.com'];

async function downloadStorageFileBytesHandler(request, getCallerRole) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }

  const role = await getCallerRole(request.auth.uid);
  if (role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super Admin only.');
  }

  const storagePath = String(request.data?.storagePath ?? '').trim();
  if (!storagePath) {
    throw new HttpsError('invalid-argument', 'storagePath is required.');
  }

  const storage = getStorage();
  let lastError = null;

  for (const bucketName of STORAGE_BUCKETS) {
    try {
      const [buffer] = await storage.bucket(bucketName).file(storagePath).download();
      return { base64: buffer.toString('base64'), bucket: bucketName };
    } catch (error) {
      lastError = error;
      if (error?.code === 404) continue;
    }
  }

  throw new HttpsError(
    'not-found',
    lastError?.message ?? `Storage object not found: ${storagePath}`,
  );
}

module.exports = { downloadStorageFileBytesHandler };
