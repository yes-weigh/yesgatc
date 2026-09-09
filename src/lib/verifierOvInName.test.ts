import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OV_IN_NAME_RC_FALLBACK,
  OV_IN_NAME_VERIFIER_FALLBACK,
  VERIFIER_OV_IN_NAME_REQUIRED_MESSAGE,
  isVerifierOvInName,
  ovInNameToggleLabels,
  validateVerifierOvStart,
  verifierOvParty,
} from './verifierOvInName.ts';

describe('verifier OV in-name', () => {
  it('requires RC pick before OV', () => {
    assert.equal(isVerifierOvInName(undefined), false);
    assert.equal(validateVerifierOvStart(undefined), VERIFIER_OV_IN_NAME_REQUIRED_MESSAGE);
    assert.equal(validateVerifierOvStart(''), VERIFIER_OV_IN_NAME_REQUIRED_MESSAGE);
    assert.equal(validateVerifierOvStart('verifier'), null);
    assert.equal(validateVerifierOvStart('rc'), null);
  });

  it('toggle line 2 uses full names, not role words', () => {
    assert.deepEqual(ovInNameToggleLabels('Rasheed', { companyName: 'Meezan' }), {
      verifier: 'RASHEED',
      rc: 'MEEZAN',
    });
    assert.deepEqual(ovInNameToggleLabels('', { username: 'Kozhikode RC' }), {
      verifier: OV_IN_NAME_VERIFIER_FALLBACK,
      rc: 'KOZHIKODE RC',
    });
    assert.deepEqual(ovInNameToggleLabels(undefined, undefined), {
      verifier: OV_IN_NAME_VERIFIER_FALLBACK,
      rc: OV_IN_NAME_RC_FALLBACK,
    });
  });

  it('files OV Self under verifier or RC name', () => {
    assert.deepEqual(
      verifierOvParty(
        'verifier',
        { uid: 'vr-1', username: 'Rasheed' },
        { uid: 'rc-1', companyName: 'Meezan' },
      ),
      { customerId: 'vr-1', customerName: 'Rasheed' },
    );
    assert.deepEqual(
      verifierOvParty(
        'rc',
        { uid: 'vr-1', username: 'Rasheed' },
        { uid: 'rc-1', companyName: 'Meezan' },
      ),
      { customerId: 'rc-1', customerName: 'Meezan' },
    );
  });
});
