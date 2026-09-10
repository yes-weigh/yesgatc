import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SiteCalibration } from '../types.ts';
import {
  canActorBulkSubmitFailAndDraft,
  failDraftBulkHasWork,
  formatFailDraftBulkConfirmMessage,
  planFailAndDraftBulkSubmit,
} from './verificationFailAndDraftBulk.ts';
import {
  filterFailedSubmitResubmitTargets,
  isEligibleFailedSubmitManualResubmit,
} from './verificationFailedSubmitResubmit.ts';

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
    pipelineFailedAt: new Date(NOW - 13 * 60 * 60 * 1000).toISOString(),
    rcId: 'rc-1',
    createdByUid: 'vct-1',
    vctId: 'vct-1',
    ...overrides,
  } as SiteCalibration;
}

function blockById(blocks: Record<string, string | null>) {
  return (record: SiteCalibration) => blocks[record.id] ?? null;
}

describe('planFailAndDraftBulkSubmit', () => {
  it('resubmits only fail-at-submit; submits complete drafts; skips incomplete', () => {
    const rows = [
      rec({ id: 'fail-1' }),
      rec({
        id: 'draft-ok',
        status: 'draft',
        pipelineFailedPhase: undefined,
        serialNumber: 'SN-OK',
        applicationNumber: 'APP-OK',
      }),
      rec({
        id: 'draft-photos',
        status: 'draft',
        pipelineFailedPhase: undefined,
        serialNumber: 'SN-GAP',
        applicationNumber: 'APP-GAP',
      }),
      rec({
        id: 'draft-serial',
        status: 'draft',
        pipelineFailedPhase: undefined,
        serialNumber: '',
        applicationNumber: 'APP-NOSN',
      }),
    ];
    const plan = planFailAndDraftBulkSubmit(rows, {
      draftBlockReason: blockById({
        'draft-ok': null,
        'draft-photos': 'Instrument / scale photo is required.',
        'draft-serial': 'Serial number is required.',
      }),
    });

    assert.deepEqual(
      plan.failResubmit.map(row => row.id),
      ['fail-1'],
    );
    assert.deepEqual(
      plan.draftSubmit.map(row => row.id),
      ['draft-ok'],
    );
    assert.deepEqual(
      plan.draftSkip.map(row => ({ id: row.id, reason: row.reason })),
      [
        { id: 'draft-photos', reason: 'Instrument / scale photo is required.' },
        { id: 'draft-serial', reason: 'Serial number is required.' },
      ],
    );
    assert.equal(failDraftBulkHasWork(plan), true);
  });

  it('does not touch rejected, unsigned, certified, or mid-submit jobs', () => {
    const rows = [
      rec({ id: 'fail-1' }),
      rec({ id: 'rej', status: 'rejected', pipelineFailedPhase: 'submit' }),
      rec({
        id: 'unsigned',
        status: 'certified',
        pipelineFailedPhase: undefined,
        signedCertificatePdfUrl: '',
        certificateNumber: 'IND/1',
      }),
      rec({
        id: 'cert',
        status: 'certified',
        pipelineFailedPhase: undefined,
        signedCertificatePdfUrl: 'https://example.test/signed.pdf',
        certificateNumber: 'IND/2',
      }),
      rec({
        id: 'mid',
        status: 'submitted',
        pipelineFailedPhase: undefined,
        pipelineFailedAt: undefined,
      }),
      rec({
        id: 'draft-ok',
        status: 'draft',
        pipelineFailedPhase: undefined,
      }),
    ];
    const plan = planFailAndDraftBulkSubmit(rows, {
      draftBlockReason: () => null,
    });

    assert.deepEqual(
      plan.failResubmit.map(row => row.id),
      ['fail-1'],
    );
    assert.deepEqual(
      plan.draftSubmit.map(row => row.id),
      ['draft-ok'],
    );
    assert.deepEqual(
      plan.ignored.map(row => row.id).sort(),
      ['cert', 'mid', 'rej', 'unsigned'],
    );
    assert.equal(isEligibleFailedSubmitManualResubmit(rows[1]), false);
    assert.equal(isEligibleFailedSubmitManualResubmit(rows[2]), false);
    assert.equal(isEligibleFailedSubmitManualResubmit(rows[3]), false);
    assert.equal(isEligibleFailedSubmitManualResubmit(rows[4]), false);
    assert.deepEqual(
      filterFailedSubmitResubmitTargets(rows).map(row => row.id),
      ['fail-1'],
    );
  });

  it('draft validator is not a fail-at-submit resubmit', () => {
    const draft = rec({
      id: 'draft',
      status: 'draft',
      pipelineFailedPhase: 'submit',
    });
    const plan = planFailAndDraftBulkSubmit([draft], {
      draftBlockReason: () => null,
    });
    assert.deepEqual(plan.failResubmit.map(row => row.id), []);
    assert.deepEqual(plan.draftSubmit.map(row => row.id), ['draft']);
  });
});

describe('confirm copy and who can run combined bulk', () => {
  it('lists skipped drafts and says rejected/cert are untouched', () => {
    const plan = planFailAndDraftBulkSubmit(
      [
        rec({ id: 'fail-1' }),
        rec({
          id: 'draft-serial',
          status: 'draft',
          pipelineFailedPhase: undefined,
          serialNumber: '',
          applicationNumber: 'APP-NOSN',
        }),
      ],
      { draftBlockReason: blockById({ 'draft-serial': 'Serial number is required.' }) },
    );
    const message = formatFailDraftBulkConfirmMessage(plan);
    assert.match(message, /Re-queue 1 failed-at-submit job/);
    assert.match(message, /Skipped drafts/);
    assert.match(message, /APP-NOSN/);
    assert.match(message, /Serial number is required/);
    assert.match(message, /Does not touch rejected, unsigned, or certified/);
    assert.equal(message.includes('Submit 1 eligible draft'), false);
  });

  it('combined bulk is super admin only', () => {
    assert.equal(canActorBulkSubmitFailAndDraft('super_admin'), true);
    assert.equal(canActorBulkSubmitFailAndDraft('rc_admin'), false);
    assert.equal(canActorBulkSubmitFailAndDraft('vct'), false);
  });
});
