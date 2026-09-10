const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FieldValue } = require('firebase-admin/firestore');
const {
  AUTO_RESUBMIT_AFTER_MS,
  AUTO_RESUBMIT_MAX,
  isEligibleFailedSubmitAutoResubmit,
  autoResubmitFailedSubmitVerificationsHandler,
} = require('./verificationFailedSubmitAutoResubmit');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function failDoc(overrides = {}) {
  return {
    status: 'submitted',
    pipelineFailedPhase: 'submit',
    pipelineFailedAt: new Date(NOW - 13 * HOUR).toISOString(),
    ...overrides,
  };
}

test('auto eligibility: 12h fail is eligible', () => {
  assert.equal(isEligibleFailedSubmitAutoResubmit(failDoc(), NOW), true);
});

test('auto eligibility: skips too-fresh fails', () => {
  assert.equal(
    isEligibleFailedSubmitAutoResubmit(
      failDoc({ pipelineFailedAt: new Date(NOW - 3 * HOUR).toISOString() }),
      NOW,
    ),
    false,
  );
});

test('auto eligibility: skips rejected and unsigned certified', () => {
  assert.equal(isEligibleFailedSubmitAutoResubmit(failDoc({ status: 'rejected' }), NOW), false);
  assert.equal(
    isEligibleFailedSubmitAutoResubmit(
      failDoc({
        status: 'certified',
        pipelineFailedPhase: 'submit',
        signedCertificatePdfUrl: '',
      }),
      NOW,
    ),
    false,
  );
});

test('auto eligibility: skips mid-submit and cap', () => {
  assert.equal(
    isEligibleFailedSubmitAutoResubmit(failDoc({ pipelineFailedPhase: undefined }), NOW),
    false,
  );
  assert.equal(
    isEligibleFailedSubmitAutoResubmit(failDoc({ autoResubmitCount: AUTO_RESUBMIT_MAX }), NOW),
    false,
  );
  assert.ok(AUTO_RESUBMIT_AFTER_MS === 12 * HOUR);
});

function createFakeDb({ settings = {}, docs = [] } = {}) {
  const updates = [];
  return {
    updates,
    doc(path) {
      return {
        async get() {
          if (path === 'appSettings/global') {
            return { exists: true, data: () => settings };
          }
          return { exists: false, data: () => ({}) };
        },
      };
    },
    collection() {
      return {
        where(field, op, value) {
          return {
            limit(n) {
              return {
                async get() {
                  const matched = docs
                    .filter(d => d.data[field] === value)
                    .slice(0, n)
                    .map(d => ({
                      id: d.id,
                      data: () => d.data,
                    }));
                  return { docs: matched };
                },
              };
            },
          };
        },
        doc(id) {
          return {
            async update(patch) {
              updates.push({ id, patch });
            },
          };
        },
      };
    },
  };
}

test('handler resubmits only stale failed-at-submit, not rejected/fresh', async () => {
  const originalNow = Date.now;
  Date.now = () => NOW;
  try {
    const db = createFakeDb({
      settings: { failedSubmitAutoResubmitEnabled: true },
      docs: [
        { id: 'old-fail', data: failDoc() },
        {
          id: 'fresh-fail',
          data: failDoc({ pipelineFailedAt: new Date(NOW - HOUR).toISOString() }),
        },
        { id: 'rejected', data: failDoc({ status: 'rejected' }) },
        {
          id: 'unsigned',
          data: failDoc({ status: 'certified', signedCertificatePdfUrl: '' }),
        },
      ],
    });
    const result = await autoResubmitFailedSubmitVerificationsHandler(db);
    assert.equal(result.enabled, true);
    assert.equal(result.resubmitted, 1);
    assert.equal(db.updates.length, 1);
    assert.equal(db.updates[0].id, 'old-fail');
    assert.equal(db.updates[0].patch.status, 'submitted');
    assert.equal(db.updates[0].patch.failedSubmitResubmitSource, 'auto');
    assert.ok(db.updates[0].patch.autoResubmitCount);
    assert.equal(typeof FieldValue.increment, 'function');
  } finally {
    Date.now = originalNow;
  }
});
