import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Product } from '../types';
import {
  mergePasBankCounts,
  pasBankListedForProduct,
  pasBankMatchesProduct,
  serialInInclusiveRange,
  type PasBankDoc,
  type ProductSerialRow,
} from './pasSerialBankMatch.ts';

function product(partial: Pick<Product, 'id' | 'yesoneSku' | 'modelid'> & Partial<Product>): Product {
  return {
    name: partial.name || partial.id,
    modelNo: '',
    typeOfInstrument: '',
    manufacturerBrandSeries: '',
    accuracyClass: '',
    maximumCapacity: 0,
    minimumCapacity: 0,
    verificationScaleInterval: 0,
    unitOfMeasurement: 'kg',
    actualScaleInterval: 0,
    noOfVerificationIntervals: 0,
    maximumPermissibleError: 0,
    supplyVoltage: '',
    modelApprovalNo: 'IND/09/2006/47',
    pasPreAllotted: true,
    ...partial,
  };
}

const scale10 = product({
  id: 'scale10',
  name: 'Weighing Scale 10 kg',
  yesoneSku: 'KS10BAY',
  modelid: 'YSK10',
});
const scale5 = product({
  id: 'scale5',
  name: 'Weighing Scale 5 kg',
  yesoneSku: 'KS05BAY',
  modelid: 'YSK5',
});

function row(serial: string, status = 'available', extra: Partial<ProductSerialRow> = {}): ProductSerialRow {
  return { id: serial, serial, status, pool: 'pas', ...extra };
}

describe('pasBankMatchesProduct', () => {
  it('isolates KS10BAY and KS05BAY seats', () => {
    const ten: PasBankDoc = { serialNumber: 'YJ00001', yesoneSku: 'KS10BAY', sku: 'KS10BAY' };
    const five: PasBankDoc = { serialNumber: 'YJ00601', yesoneSku: 'KS05BAY', sku: 'KS05BAY' };
    assert.equal(pasBankMatchesProduct(ten, scale10), true);
    assert.equal(pasBankMatchesProduct(ten, scale5), false);
    assert.equal(pasBankMatchesProduct(five, scale5), true);
    assert.equal(pasBankMatchesProduct(five, scale10), false);
  });

  it('does not fail open on empty bank identity', () => {
    assert.equal(pasBankMatchesProduct({ serialNumber: 'YJ00001' }, scale10), false);
    assert.equal(pasBankMatchesProduct({ serialNumber: 'YJ00001' }, scale5), false);
  });

  it('does not match shared model approval or serial prefix', () => {
    const bank: PasBankDoc = {
      serialNumber: 'YJ00001',
      modelApprovalNo: scale10.modelApprovalNo,
      modelNo: 'YSK',
    };
    assert.equal(pasBankMatchesProduct(bank, scale10), false);
    assert.equal(pasBankMatchesProduct(bank, scale5), false);
  });

  it('does not treat all PAS seats as every PAS product', () => {
    const bank: PasBankDoc = { serialNumber: 'YJ00001', productId: 'scale10', yesoneSku: 'KS10BAY' };
    assert.equal(pasBankMatchesProduct(bank, scale5), false);
  });
});

describe('pasBankListedForProduct', () => {
  it('keeps untagged seats only inside that product range', () => {
    const untagged: PasBankDoc = { serialNumber: 'YJ00002' };
    const foreign: PasBankDoc = { serialNumber: 'YJ00602', sku: 'KS05BAY' };
    const range10 = { from: 'YJ00001', to: 'YJ00600' };
    const range5 = { from: 'YJ00601', to: 'YJ01000' };
    assert.equal(pasBankListedForProduct(untagged, scale10, range10), true);
    assert.equal(pasBankListedForProduct(untagged, scale5, range5), false);
    assert.equal(pasBankListedForProduct(foreign, scale10, range10), false);
    assert.equal(serialInInclusiveRange('YJ00600', 'YJ00001', 'YJ00600'), true);
    assert.equal(serialInInclusiveRange('YJ00601', 'YJ00001', 'YJ00600'), false);
  });
});

describe('mergePasBankCounts', () => {
  it('uses Yesone unused/linked when seats are all available', () => {
    const rows = Array.from({ length: 600 }, (_, i) =>
      row(`YJ${String(i + 1).padStart(5, '0')}`, 'available', {
        bankQty: 600,
        bankLinked: 31,
        bankUnused: 569,
      }),
    );
    const summary = mergePasBankCounts(rows, { qty: 600, linked: 31, unused: 569 });
    assert.equal(summary.qty, 600);
    assert.equal(summary.used, 31);
    assert.equal(summary.available, 569);
  });

  it('keeps extra local used above Yesone linked', () => {
    const rows = [
      ...Array.from({ length: 35 }, (_, i) => row(`YJ${String(i + 1).padStart(5, '0')}`, 'used')),
      ...Array.from({ length: 565 }, (_, i) => row(`YJ${String(i + 36).padStart(5, '0')}`)),
    ];
    const summary = mergePasBankCounts(rows, { qty: 600, linked: 31, unused: 569 });
    assert.equal(summary.qty, 600);
    assert.equal(summary.used, 35);
    assert.equal(summary.available, 565);
  });
});
