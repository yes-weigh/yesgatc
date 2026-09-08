import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CUSTOMER_GPS_REQUIRED_MESSAGE,
  customerGpsRequiredError,
  customerPartyGpsBlockReason,
  parseCustomerLatLng,
} from './customerGps.ts';

describe('customer GPS required', () => {
  it('blocks save without customer GPS', () => {
    assert.equal(customerGpsRequiredError('', ''), CUSTOMER_GPS_REQUIRED_MESSAGE);
    assert.equal(parseCustomerLatLng('', ''), undefined);
  });

  it('accepts a captured customer GPS pin', () => {
    assert.equal(customerGpsRequiredError('10.015', '76.341'), null);
    assert.deepEqual(parseCustomerLatLng('10.015', '76.341'), { lat: 10.015, lng: 76.341 });
  });

  it('does not invent coordinates when GPS is empty', () => {
    assert.equal(parseCustomerLatLng('10.015', ''), undefined);
    assert.equal(parseCustomerLatLng('', '76.341'), undefined);
  });

  it('RC party form can still omit GPS', () => {
    assert.equal(customerGpsRequiredError('', '', false), null);
  });
});

describe('customer party GPS gate', () => {
  it('requires GPS on new RV and OV customer jobs', () => {
    assert.equal(
      customerPartyGpsBlockReason({
        verificationType: 'RV',
        verificationSubject: 'customer',
        isNewJob: true,
      }),
      CUSTOMER_GPS_REQUIRED_MESSAGE,
    );
    assert.equal(
      customerPartyGpsBlockReason({
        verificationType: 'OV',
        verificationSubject: 'customer',
        isNewJob: true,
      }),
      CUSTOMER_GPS_REQUIRED_MESSAGE,
    );
  });

  it('proceeds once customer GPS is set', () => {
    assert.equal(
      customerPartyGpsBlockReason({
        verificationType: 'RV',
        verificationSubject: 'customer',
        isNewJob: true,
        latitude: '10.015',
        longitude: '76.341',
      }),
      null,
    );
  });

  it('does not gate OV Self', () => {
    assert.equal(
      customerPartyGpsBlockReason({
        verificationType: 'OV',
        verificationSubject: 'self',
        isNewJob: true,
      }),
      null,
    );
  });
});
