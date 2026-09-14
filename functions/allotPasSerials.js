const { HttpsError } = require('firebase-functions/v2/https');

const PAS_SERIAL_COLLECTION = 'pasSerialBank';

function asString(value) {
  return value == null ? '' : String(value).trim();
}

function serialDocId(serial) {
  const trimmed = asString(serial);
  if (!trimmed) return null;
  return trimmed.toUpperCase().replace(/[/\\]/g, '_').slice(0, 700);
}

function uniqueSerials(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const serial = asString(value);
    if (!serial) continue;
    const key = serial.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(serial);
  }
  return out;
}

function isPasStickerSerial(serial) {
  return asString(serial).toUpperCase().startsWith('YJ');
}

function isGasStickerSerial(serial) {
  const key = asString(serial).toUpperCase();
  if (!key || isPasStickerSerial(key)) return false;
  return key.startsWith('G') || key.startsWith('X');
}

function compactIdent(value) {
  return asString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pasMatchesProduct(bank, product) {
  const bankSku = compactIdent(bank.yesoneSku || bank.sku);
  const productSku = compactIdent(product.yesoneSku);
  if (bankSku && productSku) return bankSku === productSku;
  const bankProductId = compactIdent(bank.productId);
  const productId = compactIdent(product.id);
  if (bankProductId && productId && bankProductId === productId) return true;
  if (bankSku || productSku) return false;
  const bankModel = compactIdent(bank.modelid || bank.modelId);
  const productModel = compactIdent(product.modelid);
  return Boolean(bankModel && productModel && bankModel === productModel);
}

function stripUndefined(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * RC admin writes PAS serials onto pasSerialBank for a verifier + exact product.
 * Never writes G/X. Never touches Yesone GAS reserved / allotted maps.
 */
async function allotPasSerialsHandler(request, db) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const callerUid = request.auth.uid;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const caller = callerSnap.exists ? callerSnap.data() || {} : {};
  if (caller.role !== 'rc_admin') {
    throw new HttpsError('permission-denied', 'RC admin only.');
  }

  const data = request.data || {};
  const verifierUid = asString(data.verifierUid);
  const invoiceNo = asString(data.invoiceNo);
  const source = asString(data.source) === 'rcQuota' ? 'rcQuota' : 'interweighingDirect';
  const createIfMissing = source === 'interweighingDirect';
  const serials = uniqueSerials(data.serials);
  const product = data.product && typeof data.product === 'object' ? data.product : {};
  const productId = asString(product.id);
  const productName = asString(product.name);
  const yesoneSku = asString(product.yesoneSku);
  const modelid = asString(product.modelid);
  const modelNo = asString(product.modelNo);
  const modelApprovalNo = asString(product.modelApprovalNo);

  if (!verifierUid || serials.length === 0) {
    throw new HttpsError('invalid-argument', 'Verifier and serials are required.');
  }
  if (!productId || !modelid && !yesoneSku) {
    throw new HttpsError('invalid-argument', 'Select a PAS product.');
  }
  if (serials.some(isGasStickerSerial)) {
    throw new HttpsError('invalid-argument', 'PAS allotment cannot use GAS X/G serials.');
  }

  const verifierSnap = await db.doc(`users/${verifierUid}`).get();
  if (!verifierSnap.exists) {
    throw new HttpsError('failed-precondition', 'Verifier is required.');
  }
  const verifier = verifierSnap.data() || {};
  if (verifier.role !== 'verifier' || asString(verifier.rcId) !== callerUid) {
    throw new HttpsError('permission-denied', 'Verifier must belong to this RC.');
  }

  const productIdent = {
    id: productId,
    yesoneSku,
    modelid,
  };
  const now = new Date().toISOString();
  const written = [];

  for (const serial of serials) {
    const id = serialDocId(serial);
    if (!id) continue;
    const ref = db.doc(`${PAS_SERIAL_COLLECTION}/${id}`);
    const snap = await ref.get();
    const prev = snap.exists ? snap.data() || {} : null;
    if (!prev && !createIfMissing) {
      throw new HttpsError(
        'failed-precondition',
        `Must be unused PAS seats for this product.`,
      );
    }
    if (prev && !pasMatchesProduct(prev, productIdent)) {
      throw new HttpsError(
        'failed-precondition',
        `Serial ${serial} is not allotted to this PAS product.`,
      );
    }
    const status = asString(prev?.status).toLowerCase();
    if (status === 'used') {
      throw new HttpsError('failed-precondition', `Serial ${serial} is already used.`);
    }
    if (status === 'cancelled' || status === 'replaced') {
      throw new HttpsError('failed-precondition', `Serial ${serial} is not available.`);
    }
    await ref.set(
      stripUndefined({
        serialNumber: serial,
        pool: 'pas',
        status: 'allotted',
        productId,
        productName: productName || prev?.productName || null,
        yesoneSku: yesoneSku || prev?.yesoneSku || null,
        sku: yesoneSku || prev?.sku || null,
        modelid: modelid || prev?.modelid || null,
        modelNo: modelNo || prev?.modelNo || null,
        modelApprovalNo: modelApprovalNo || prev?.modelApprovalNo || null,
        invoiceNo: invoiceNo || prev?.invoiceNo || null,
        qty: 1,
        allottedToUid: verifierUid,
        allottedByRcId: callerUid,
        allottedAt: now,
        source: source === 'rcQuota' ? 'rcAllotment' : 'interweighingDirect',
        updatedAt: now,
        ...(prev ? {} : { createdAt: now }),
      }),
      { merge: true },
    );
    written.push(serial);
  }

  return { ok: true, serials: written, qty: written.length };
}

module.exports = {
  allotPasSerialsHandler,
  serialDocId,
  isGasStickerSerial,
  isPasStickerSerial,
  pasMatchesProduct,
};
