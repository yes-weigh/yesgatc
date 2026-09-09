import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parentRcUid } from './parentRcUid.ts';

describe('parentRcUid', () => {
  it('RC admin is the allotment owner', () => {
    assert.equal(parentRcUid({ role: 'rc_admin', uid: 'meezan', rcId: 'meezan' }), 'meezan');
    assert.equal(parentRcUid({ role: 'rc_admin', uid: 'meezan' }), 'meezan');
  });

  it('VCT/verifier use parent rcId, never own uid', () => {
    assert.equal(
      parentRcUid({ role: 'verifier', uid: 'rasheed', rcId: 'meezan' }),
      'meezan',
    );
    assert.equal(parentRcUid({ role: 'vct', uid: 'hafiz', rcId: 'meezan' }), 'meezan');
  });

  it('does not query allotments by field-staff uid', () => {
    assert.equal(parentRcUid({ role: 'verifier', uid: 'rasheed', rcId: 'rasheed' }), null);
    assert.equal(parentRcUid({ role: 'verifier', uid: 'rasheed' }), null);
    assert.equal(parentRcUid({ role: 'vct', uid: 'hafiz', rcId: '' }), null);
  });
});
