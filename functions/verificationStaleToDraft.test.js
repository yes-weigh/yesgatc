const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  STALE_AGE_MS,
  isEligibleStaleCandidate,
} = require('./verificationStaleToDraft');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

test('stale-to-draft still takes old rejected jobs', () => {
  assert.equal(
    isEligibleStaleCandidate(
      {
        status: 'rejected',
        rejectedAt: new Date(NOW - 13 * HOUR).toISOString(),
      },
      NOW,
    ),
    true,
  );
  assert.ok(STALE_AGE_MS === 12 * HOUR);
});

test('stale-to-draft does not take failed-at-submit (auto-resubmit owns that path)', () => {
  assert.equal(
    isEligibleStaleCandidate(
      {
        status: 'submitted',
        pipelineFailedPhase: 'submit',
        pipelineFailedAt: new Date(NOW - 13 * HOUR).toISOString(),
      },
      NOW,
    ),
    false,
  );
});
