import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMPTY_VERIFIER_LOCATION,
  VERIFIER_GPS_REQUIRED_MESSAGE,
  parseVerifierLatLng,
  validateVerifierLocation,
  verifierLocationFromUser,
  verifierLocationPersistFields,
  verifierOwnGpsWrite,
} from './verifierProfileFields.ts';

describe('verifier location persist', () => {
  it('requires PIN district state and GPS', () => {
    assert.equal(validateVerifierLocation(EMPTY_VERIFIER_LOCATION), 'Address is required.');
    assert.equal(
      validateVerifierLocation({
        ...EMPTY_VERIFIER_LOCATION,
        address: 'Street',
        pincode: '682001',
        district: 'Ernakulam',
        state: 'Kerala',
      }),
      VERIFIER_GPS_REQUIRED_MESSAGE,
    );
    assert.equal(parseVerifierLatLng(EMPTY_VERIFIER_LOCATION), undefined);
  });

  it('writes { lat, lng } on the verifier user doc', () => {
    const location = {
      address: 'Street, locality',
      pincode: '682001',
      district: 'Ernakulam',
      state: 'Kerala',
      latitude: '10.015',
      longitude: '76.341',
    };
    assert.equal(validateVerifierLocation(location), null);
    assert.deepEqual(verifierLocationPersistFields(location), {
      address: 'Street, locality',
      pincode: '682001',
      state: 'Kerala',
      district: 'Ernakulam',
      location: { lat: 10.015, lng: 76.341 },
    });
  });

  it('round-trips stored verifier GPS', () => {
    const fromUser = verifierLocationFromUser({
      address: 'Street',
      pincode: '682001',
      state: 'Kerala',
      district: 'Ernakulam',
      location: { lat: 10.015, lng: 76.341 },
    });
    assert.equal(fromUser.latitude, '10.015');
    assert.equal(fromUser.longitude, '76.341');
    assert.deepEqual(parseVerifierLatLng(fromUser), { lat: 10.015, lng: 76.341 });
  });

  it('own GPS write is location only', () => {
    assert.deepEqual(verifierOwnGpsWrite(10.015, 76.341), {
      location: { lat: 10.015, lng: 76.341 },
    });
    assert.equal(verifierOwnGpsWrite(91, 76), null);
  });
});
