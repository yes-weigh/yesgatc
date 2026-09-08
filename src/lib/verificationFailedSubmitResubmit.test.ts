import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SiteCalibration } from '../types.ts';
import {
  FAILED_SUBMIT_AUTO_RESUBMIT_AFTER_MS,
  FAILED_SUBMIT_AUTO_RESUBMIT_MAX,
  canActorBulkResubmitFailedSubmit,
  canActorResubmitFailedSubmit,
  filterFailedSubmitResubmitTargets,
  isEligibleFailedSubmitAutoResubmit,
  isEligibleFailedSubmitManualResubmit,
  isUnsignedIssuedCertificate,
} from './verificationFailedSubmitResubmit.ts';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function rec(
  overrides: Partial<SiteCalibration> & Pick<SiteCalibration, 'id'>,
): SiteCalibration {
  return {
    serialNumber: 'SN-1',
    customerName: 'Acme',
    verificationType: 'OV',
    status: 'submitted',
    pipelineFailedPhase: 'submit',
    pipelineFailedAt: new Date(NOW - 13 * HOUR).toISOString(),
    rcId: 'rc-1',
    createdByUid: 'vct-1',
    vctId: 'vct-1',
    ...overrides,
  } as SiteCalibration;
}

describe('failed-at-submit resubmit eligibility', () => {
  it('allows a failed-at-submit job older than 12h for auto', () => {
    const record = rec({ id: 'a' });
    assert.equal(isEligibleFailedSubmitManualResubmit(record), true);
    assert.equal(isEligibleFailedSubmitAutoResubmit(record, NOW), true);
  });

  it('skips too-fresh fails for auto but still allows manual', () => {
    const record = rec({
      id: 'fresh',
      pipelineFailedAt: new Date(NOW - 2 * HOUR).toISOString(),
    });
    assert.equal(isEligibleFailedSubmitManualResubmit(record), true);
    assert.equal(isEligibleFailedSubmitAutoResubmit(record, NOW), false);
  });

  it('skips auto when last fail is exactly under 12h', () => {
    const record = rec({
      id: 'edge',
      pipelineFailedAt: new Date(NOW - FAILED_SUBMIT_AUTO_RESUBMIT_AFTER_MS + 1).toISOString(),
    });
    assert.equal(isEligibleFailedSubmitAutoResubmit(record, NOW), false);
  });

  it('does not resubmit rejected jobs', () => {
    const record = rec({ id: 'rej', status: 'rejected', pipelineFailedPhase: 'submit' });
    assert.equal(isEligibleFailedSubmitManualResubmit(record), false);
    assert.equal(isEligibleFailedSubmitAutoResubmit(record, NOW), false);
  });

  it('does not resubmit unsigned certified jobs', () => {
    const record = rec({
      id: 'unsigned',
      status: 'certified',
      pipelineFailedPhase: undefined,
      signedCertificatePdfUrl: '',
      certificateNumber: 'IND/GATC/KL/26/04/26/1',
    });
    assert.equal(isUnsignedIssuedCertificate(record), true);
    assert.equal(isEligibleFailedSubmitManualResubmit(record), false);
    assert.equal(isEligibleFailedSubmitAutoResubmit(record, NOW), false);
  });

  it('skips mid-submit jobs (no pipeline fail marker)', () => {
    const record = rec({
      id: 'mid',
      status: 'submitted',
      pipelineFailedPhase: undefined,
      pipelineFailedAt: undefined,
    });
    assert.equal(isEligibleFailedSubmitManualResubmit(record), false);
  });

  it('stops auto after the cap', () => {
    const record = rec({
      id: 'capped',
      autoResubmitCount: FAILED_SUBMIT_AUTO_RESUBMIT_MAX,
    });
    assert.equal(isEligibleFailedSubmitManualResubmit(record), true);
    assert.equal(isEligibleFailedSubmitAutoResubmit(record, NOW), false);
  });
});

describe('bulk failed-at-submit selection', () => {
  it('keeps only failed-at-submit rows', () => {
    const rows = [
      rec({ id: 'fail-1' }),
      rec({ id: 'rej', status: 'rejected' }),
      rec({
        id: 'unsigned',
        status: 'certified',
        pipelineFailedPhase: undefined,
        certificateNumber: 'IND/1',
      }),
      rec({ id: 'draft', status: 'draft', pipelineFailedPhase: undefined }),
      rec({ id: 'fail-2' }),
    ];
    assert.deepEqual(
      filterFailedSubmitResubmitTargets(rows).map(row => row.id),
      ['fail-1', 'fail-2'],
    );
  });
});

describe('who can resubmit', () => {
  const fail = rec({ id: 'own' });

  it('super admin any, RC admin own centre, VCT own jobs', () => {
    assert.equal(canActorResubmitFailedSubmit(fail, { role: 'super_admin', uid: 'sa' }), true);
    assert.equal(canActorResubmitFailedSubmit(fail, { role: 'rc_admin', uid: 'rc-1' }), true);
    assert.equal(canActorResubmitFailedSubmit(fail, { role: 'rc_admin', uid: 'rc-other' }), false);
    assert.equal(canActorResubmitFailedSubmit(fail, { role: 'vct', uid: 'vct-1' }), true);
    assert.equal(canActorResubmitFailedSubmit(fail, { role: 'vct', uid: 'vct-other' }), false);
    assert.equal(canActorResubmitFailedSubmit(fail, { role: 'verifier', uid: 'vct-1' }), false);
  });

  it('bulk is admin + RC admin only', () => {
    assert.equal(canActorBulkResubmitFailedSubmit('super_admin'), true);
    assert.equal(canActorBulkResubmitFailedSubmit('rc_admin'), true);
    assert.equal(canActorBulkResubmitFailedSubmit('vct'), false);
    assert.equal(canActorBulkResubmitFailedSubmit('verifier'), false);
  });
});
