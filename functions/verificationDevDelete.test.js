const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  callerMayDeleteSubmittedVerification,
  isDeletableSubmittedOriginalVerification,
  isSubmittedVerificationRecord,
} = require('./verificationDevDelete');

const submittedOv = {
  id: 'ov-1',
  verificationType: 'OV',
  status: 'submitted',
  serialNumber: 'X00366',
  rcId: 'rc-1',
  createdByUid: 'vct-1',
  vctId: 'vct-1',
};

test('submitted OV without a certificate is deletable', () => {
  assert.equal(isDeletableSubmittedOriginalVerification(submittedOv), true);
  assert.equal(isSubmittedVerificationRecord(submittedOv), true);
  assert.equal(
    isDeletableSubmittedOriginalVerification({ ...submittedOv, certificateNumber: 'IND/1' }),
    false,
  );
});

test('owning VCT and RC may delete submitted OV; Super Admin may delete OV or RV', () => {
  assert.equal(
    callerMayDeleteSubmittedVerification(submittedOv, { role: 'vct', rcId: 'rc-1' }, 'vct-1'),
    true,
  );
  assert.equal(
    callerMayDeleteSubmittedVerification(submittedOv, { role: 'rc_admin' }, 'rc-1'),
    true,
  );
  assert.equal(
    callerMayDeleteSubmittedVerification(submittedOv, { role: 'super_admin' }, 'admin-1'),
    true,
  );
  assert.equal(
    callerMayDeleteSubmittedVerification(submittedOv, { role: 'vct', rcId: 'rc-1' }, 'vct-2'),
    false,
  );

  const submittedRv = { ...submittedOv, verificationType: 'RV' };
  assert.equal(
    callerMayDeleteSubmittedVerification(submittedRv, { role: 'vct', rcId: 'rc-1' }, 'vct-1'),
    false,
  );
  assert.equal(
    callerMayDeleteSubmittedVerification(submittedRv, { role: 'super_admin' }, 'admin-1'),
    true,
  );
});
