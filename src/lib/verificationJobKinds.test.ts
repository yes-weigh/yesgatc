import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verificationJobKindsForActor } from './verificationJobKinds.ts';

describe('verificationJobKindsForActor', () => {
  it('verifier sees OV Self only', () => {
    assert.deepEqual(verificationJobKindsForActor(true), ['ov_self']);
  });

  it('RC / VCT see OV Self, OV Customer, RV Customer', () => {
    assert.deepEqual(verificationJobKindsForActor(false), [
      'ov_self',
      'ov_customer',
      'rv_customer',
    ]);
  });
});
