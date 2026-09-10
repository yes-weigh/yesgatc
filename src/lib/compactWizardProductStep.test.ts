import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compactWizardWorkingDevices,
  devicesForVerificationCustomerSelect,
  productStepBlockReason,
  type CompactWizardDevice,
} from './compactWizardProductStep.ts';

function device(
  partial: Partial<CompactWizardDevice> & { localId: string },
): CompactWizardDevice {
  return {
    included: true,
    isNewDevice: true,
    productId: '',
    productName: '',
    productSpecificationId: '',
    serialNumber: '',
    sealIdentificationNumber: 'SEAL-1',
    ...partial,
  };
}

const billPrinting = {
  id: 'bill',
  specifications: [{ id: 'spec-10' }, { id: 'spec-20' }],
};

describe('compactWizardWorkingDevices', () => {
  it('keeps the included row that already has a product', () => {
    const [working] = compactWizardWorkingDevices([
      device({
        localId: 'd1',
        productId: 'bill',
        productName: 'Bill printing scale',
        productSpecificationId: 'spec-20',
      }),
      device({ localId: 'd2', productId: '' }),
    ]);
    assert.equal(working.localId, 'd1');
    assert.equal(working.included, true);
  });

  it('falls back to the first included seat when none have a product', () => {
    const [working] = compactWizardWorkingDevices([
      device({ localId: 'a', productId: '' }),
      device({ localId: 'b', productId: '' }),
    ]);
    assert.equal(working.localId, 'a');
  });
});

describe('devicesForVerificationCustomerSelect', () => {
  it('compact RV keeps one working row and drops customer leftovers plus the empty seed', () => {
    const seed = device({ localId: 'seed', productId: '', isNewDevice: true });
    const next = devicesForVerificationCustomerSelect({
      compact: true,
      lockedSerial: '',
      currentDevices: [seed],
      customerRows: [device({ localId: 'reg-1', productId: 'other', isNewDevice: false })],
      createEmpty: () => device({ localId: 'empty' }),
    });
    assert.equal(next.length, 1);
    assert.equal(next[0].localId, 'seed');
  });

  it('classic customer pick still appends the empty new-device seed', () => {
    const seed = device({ localId: 'seed', productId: '', isNewDevice: true });
    const next = devicesForVerificationCustomerSelect({
      compact: false,
      lockedSerial: '',
      currentDevices: [seed],
      customerRows: [device({ localId: 'reg-1', productId: 'other', isNewDevice: false })],
      createEmpty: () => device({ localId: 'empty' }),
    });
    assert.equal(next.length, 2);
    assert.equal(next[1].localId, 'seed');
  });
});

describe('productStepBlockReason Serial enable', () => {
  it('compact RV: extra empty Device 2 does not block Serial after Device 1 has product+spec', () => {
    const reason = productStepBlockReason(
      [
        device({
          localId: 'd1',
          productId: 'bill',
          productName: 'Bill printing scale',
          productSpecificationId: 'spec-20',
        }),
        device({ localId: 'd2', productId: '' }),
      ],
      { compact: true, products: [billPrinting] },
    );
    assert.equal(reason, null);
  });

  it('compact RV: still requires a product on the working row', () => {
    const reason = productStepBlockReason(
      [device({ localId: 'd1', productId: '' }), device({ localId: 'd2', productId: '' })],
      { compact: true, products: [billPrinting] },
    );
    assert.equal(reason, 'Device 1: select a product.');
  });

  it('compact RV: multi-spec product needs a committed capacity', () => {
    const reason = productStepBlockReason(
      [
        device({
          localId: 'd1',
          productId: 'bill',
          productName: 'Bill printing scale',
          productSpecificationId: '',
        }),
      ],
      { compact: true, products: [billPrinting] },
    );
    assert.equal(reason, 'Device 1: select a capacity specification.');
  });

  it('non-compact product step still reports an empty extra seat', () => {
    const reason = productStepBlockReason(
      [
        device({
          localId: 'd1',
          productId: 'bill',
          productName: 'Bill printing scale',
          productSpecificationId: 'spec-20',
        }),
        device({ localId: 'd2', productId: '' }),
      ],
      { compact: false, products: [billPrinting] },
    );
    assert.equal(reason, 'Device 2: select a product.');
  });

  it('empty GAS allotted list is not part of product-step enable', () => {
    const reason = productStepBlockReason(
      [
        device({
          localId: 'd1',
          productId: 'bill',
          productName: 'Bill printing scale',
          productSpecificationId: 'spec-20',
        }),
      ],
      { compact: true, products: [billPrinting] },
    );
    assert.equal(reason, null);
  });
});
