const { FieldValue } = require('firebase-admin/firestore');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';

/**
 * Auto-resubmit cap for failed-at-submit:
 * every 12h after pipelineFailedAt, at most AUTO_RESUBMIT_MAX (3) times,
 * same document (no clone). Stops on success / rejected / draft / void / superseded / cap.
 * Manual resubmit is a separate client path and is not capped here.
 * Distinct from moveStaleFailedVerificationsToDraft (rejected → draft only).
 */
const AUTO_RESUBMIT_AFTER_MS = 12 * 60 * 60 * 1000;
const AUTO_RESUBMIT_MAX = 3;
const QUERY_LIMIT = 150;
const BATCH_LIMIT = 50;

async function isFailedSubmitAutoResubmitEnabled(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  if (!snap.exists) return true;
  return snap.data().failedSubmitAutoResubmitEnabled !== false;
}

function parseIsoMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isFailedAtSubmit(data) {
  return data?.status === 'submitted' && data?.pipelineFailedPhase === 'submit';
}

function isRejected(data) {
  return data?.status === 'rejected';
}

function isUnsignedIssued(data) {
  const status = data?.status;
  if (status !== 'certified' && status !== 'approved') return false;
  const signed = typeof data?.signedCertificatePdfUrl === 'string' ? data.signedCertificatePdfUrl.trim() : '';
  return !signed;
}

function autoResubmitCount(data) {
  const n = Number(data?.autoResubmitCount);
  return Number.isFinite(n) ? n : 0;
}

function isEligibleFailedSubmitAutoResubmit(data, nowMs) {
  if (!data) return false;
  if (isRejected(data) || isUnsignedIssued(data)) return false;
  if (data.status === 'certified' || data.status === 'approved' || data.status === 'draft') {
    return false;
  }
  if (typeof data.supersededByResubmissionId === 'string' && data.supersededByResubmissionId.trim()) {
    return false;
  }
  if (typeof data.certificateVoidedAt === 'string' && data.certificateVoidedAt.trim()) {
    return false;
  }
  if (!isFailedAtSubmit(data)) return false;
  if (autoResubmitCount(data) >= AUTO_RESUBMIT_MAX) return false;
  const failedAt = parseIsoMs(data.pipelineFailedAt);
  if (failedAt == null) return false;
  return nowMs - failedAt >= AUTO_RESUBMIT_AFTER_MS;
}

function autoResubmitPatch(nowIso) {
  return {
    status: 'submitted',
    submittedAt: nowIso,
    updatedAt: nowIso,
    pipelineFailedPhase: FieldValue.delete(),
    pipelineFailureMessage: FieldValue.delete(),
    pipelineFailedAt: FieldValue.delete(),
    certificationLastError: FieldValue.delete(),
    lastFailedSubmitResubmitAt: nowIso,
    lastAutoResubmitAt: nowIso,
    autoResubmitCount: FieldValue.increment(1),
    failedSubmitResubmitSource: 'auto',
  };
}

async function collectAutoResubmitCandidates(db, nowMs, limit) {
  const seen = new Set();
  const candidates = [];

  const snap = await db
    .collection('siteCalibrations')
    .where('pipelineFailedPhase', '==', 'submit')
    .limit(QUERY_LIMIT)
    .get();

  for (const doc of snap.docs) {
    if (candidates.length >= limit) break;
    if (seen.has(doc.id)) continue;
    const data = doc.data();
    if (!isEligibleFailedSubmitAutoResubmit(data, nowMs)) continue;
    seen.add(doc.id);
    candidates.push({ id: doc.id, data });
  }

  return candidates.slice(0, limit);
}

async function autoResubmitFailedSubmitVerificationsHandler(db) {
  if (!(await isFailedSubmitAutoResubmitEnabled(db))) {
    console.log('failedSubmitAutoResubmit: disabled via appSettings/global');
    return { enabled: false, resubmitted: 0, scanned: 0 };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const candidates = await collectAutoResubmitCandidates(db, nowMs, BATCH_LIMIT);

  let resubmitted = 0;
  const errors = [];

  for (const { id } of candidates) {
    try {
      await db.collection('siteCalibrations').doc(id).update(autoResubmitPatch(nowIso));
      resubmitted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ id, message });
      console.error(`failedSubmitAutoResubmit: failed ${id}: ${message}`);
    }
  }

  console.log(
    `failedSubmitAutoResubmit: resubmitted=${resubmitted} candidates=${candidates.length} errors=${errors.length}`,
  );

  return {
    enabled: true,
    resubmitted,
    scanned: candidates.length,
    errors,
  };
}

module.exports = {
  AUTO_RESUBMIT_AFTER_MS,
  AUTO_RESUBMIT_MAX,
  isEligibleFailedSubmitAutoResubmit,
  autoResubmitFailedSubmitVerificationsHandler,
};
