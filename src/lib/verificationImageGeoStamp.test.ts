import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allowsLiveGpsPhotoStamp,
  resolvePhotoStampCoordSource,
  resolveVerificationImageGeoStampCoords,
} from './verificationImageGeoStamp.ts';

const customerGps = { lat: 10.015, lng: 76.341 };
const rcGps = { lat: 9.931, lng: 76.267 };

describe('resolveVerificationImageGeoStampCoords', () => {
  it('RV + customer stamps customer GPS, not RC GPS', () => {
    const stamp = resolveVerificationImageGeoStampCoords({
      verificationType: 'RV',
      verificationSubject: 'customer',
      customerLocation: customerGps,
      rcLocation: rcGps,
    });
    assert.deepEqual(stamp, customerGps);
    assert.notDeepEqual(stamp, rcGps);
  });

  it('OV + customer stamps customer GPS, not RC GPS', () => {
    const stamp = resolveVerificationImageGeoStampCoords({
      verificationType: 'OV',
      verificationSubject: 'customer',
      customerLocation: customerGps,
      rcLocation: rcGps,
    });
    assert.deepEqual(stamp, customerGps);
    assert.notDeepEqual(stamp, rcGps);
  });

  it('customer job with no customer GPS does not fall back to RC GPS', () => {
    for (const verificationType of ['RV', 'OV'] as const) {
      const stamp = resolveVerificationImageGeoStampCoords({
        verificationType,
        verificationSubject: 'customer',
        customerLocation: null,
        rcLocation: rcGps,
      });
      assert.equal(stamp, null);
    }
  });

  it('uses GPS just entered on the customer form', () => {
    const updated = { lat: 11.258, lng: 75.78 };
    const stamp = resolveVerificationImageGeoStampCoords({
      verificationType: 'RV',
      verificationSubject: 'customer',
      customerLocation: updated,
      rcLocation: rcGps,
    });
    assert.deepEqual(stamp, updated);
  });

  it('OV Self still uses RC GPS', () => {
    const stamp = resolveVerificationImageGeoStampCoords({
      verificationType: 'OV',
      verificationSubject: 'self',
      customerLocation: customerGps,
      rcLocation: rcGps,
    });
    assert.deepEqual(stamp, rcGps);
  });
});

describe('allowsLiveGpsPhotoStamp', () => {
  it('blocks live / last-known device GPS on customer jobs', () => {
    assert.equal(allowsLiveGpsPhotoStamp('RV', 'customer'), false);
    assert.equal(allowsLiveGpsPhotoStamp('OV', 'customer'), false);
    assert.equal(allowsLiveGpsPhotoStamp('OV', 'self'), true);
  });
});

describe('resolvePhotoStampCoordSource', () => {
  it('forced customer coords win over live GPS', () => {
    assert.equal(
      resolvePhotoStampCoordSource({ forcedCoords: customerGps, allowLiveGps: true }),
      'forced',
    );
  });

  it('customer job without customer GPS stamps nothing — not live RC GPS', () => {
    assert.equal(
      resolvePhotoStampCoordSource({ forcedCoords: null, allowLiveGps: false }),
      'none',
    );
  });
});
