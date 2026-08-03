const { FieldValue } = require('firebase-admin/firestore');

const APP_SETTINGS_COLLECTION = 'appSettings';
const APP_SETTINGS_GLOBAL_DOC = 'global';

/** Age before failed-at-submit / rejected records are reopened as draft. */
const STALE_AGE_MS = 12 * 60 * 60 * 1000;
const QUERY_LIMIT = 150;
const BATCH_LIMIT = 50;

async function isStaleVerificationToDraftEnabled(db) {
  const snap = await db.doc(`${APP_SETTINGS_COLLECTION}/${APP_SETTINGS_GLOBAL_DOC}`).get();
  if (!snap.exists) return true;
  return snap.data().staleVerificationToDraftEnabled !== false;
}

function parseIsoMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Prefer pipelineFailedAt; rejected also has rejectedAt. */
function failureTimestampMs(data) {
  return parseIsoMs(data?.pipelineFailedAt) ?? parseIsoMs(data?.rejectedAt);
}

function isFailedAtSubmit(data) {
  return data?.status === 'submitted' && data?.pipelineFailedPhase === 'submit';
}

function isRejected(data) {
  return data?.status === 'rejected';
}

function isEligibleStaleCandidate(data, nowMs) {
  if (!data) return false;
  if (typeof data.supersededByResubmissionId === 'string' && data.supersededByResubmissionId.trim()) {
    return false;
  }
  if (!isRejected(data) && !isFailedAtSubmit(data)) return false;
  const failedAt = failureTimestampMs(data);
  if (failedAt == null) return false;
  return nowMs - failedAt >= STALE_AGE_MS;
}

function draftReopenPatch(nowIso) {
  return {
    status: 'draft',
    updatedAt: nowIso,
    submittedAt: FieldValue.delete(),
    approvedAt: FieldValue.delete(),
    certifiedAt: FieldValue.delete(),
    pipelineFailedPhase: FieldValue.delete(),
    pipelineFailureMessage: FieldValue.delete(),
    pipelineFailedAt: FieldValue.delete(),
    certificationLastError: FieldValue.delete(),
    rejectedAt: FieldValue.delete(),
  };
}

async function collectStaleCandidates(db, nowMs, limit) {
  const seen = new Set();
  const candidates = [];

  const tryAdd = (id, data) => {
    if (seen.has(id) || candidates.length >= limit) return;
    if (!isEligibleStaleCandidate(data, nowMs)) return;
    seen.add(id);
    candidates.push({ id, data });
  };

  const rejectedSnap = await db
    .collection('siteCalibrations')
    .where('status', '==', 'rejected')
    .limit(QUERY_LIMIT)
    .get();
  for (const doc of rejectedSnap.docs) {
    tryAdd(doc.id, doc.data());
  }

  if (candidates.length < limit) {
    const failedPhaseSnap = await db
      .collection('siteCalibrations')
      .where('pipelineFailedPhase', '==', 'submit')
      .limit(QUERY_LIMIT)
      .get();
    for (const doc of failedPhaseSnap.docs) {
      tryAdd(doc.id, doc.data());
    }
  }

  return candidates.slice(0, limit);
}

/**
 * Moves rejected + failed-at-submit verifications older than 12h back to draft
 * so RC/VCT can fix and submit again.
 */
async function moveStaleFailedVerificationsToDraftHandler(db) {
  if (!(await isStaleVerificationToDraftEnabled(db))) {
    console.log('staleVerificationToDraft: disabled via appSettings/global');
    return { enabled: false, moved: 0, scanned: 0 };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const candidates = await collectStaleCandidates(db, nowMs, BATCH_LIMIT);

  let moved = 0;
  const errors = [];

  for (const { id } of candidates) {
    try {
      await db.collection('siteCalibrations').doc(id).update(draftReopenPatch(nowIso));
      moved += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ id, message });
      console.error(`staleVerificationToDraft: failed ${id}: ${message}`);
    }
  }

  console.log(
    `staleVerificationToDraft: moved=${moved} candidates=${candidates.length} errors=${errors.length}`,
  );

  return {
    enabled: true,
    moved,
    scanned: candidates.length,
    errors,
  };
}

module.exports = {
  STALE_AGE_MS,
  moveStaleFailedVerificationsToDraftHandler,
  isEligibleStaleCandidate,
  failureTimestampMs,
};
