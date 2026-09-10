import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SiteCalibration } from '../types.ts';
import {
  parseVerificationListStatusParam,
  verificationListKeepsUncollapsedRows,
} from './verificationListStatusQuery.ts';
import {
  canActorBulkSubmitPendingRc,
  filterPendingRcSubmitTargets,
  formatPendingRcBulkConfirmMessage,
  pendingRcBulkHasWork,
  planPendingRcBulkSubmit,
} from './verificationPendingRcBulk.ts';

function rec(
  overrides: Partial<SiteCalibration> & Pick<SiteCalibration, 'id'>,
): SiteCalibration {
  return {
    serialNumber: `SN-${overrides.id}`,
    customerName: 'Meezan',
    verificationType: 'OV',
    status: 'pending_rc',
    performedBy: 'verifier',
    requestSource: 'verifier_manual',
    rcId: 'rc-1',
    createdByUid: 'ver-1',
    vctId: 'ver-1',
    ...overrides,
  } as SiteCalibration;
}

describe('parseVerificationListStatusParam', () => {
  it('keeps pending_rc so dashboard card click applies', () => {
    assert.equal(parseVerificationListStatusParam('pending_rc'), 'pending_rc');
    assert.equal(parseVerificationListStatusParam('draft'), 'draft');
    assert.equal(parseVerificationListStatusParam('failed_submit'), 'failed_submit');
    assert.equal(parseVerificationListStatusParam('certified'), 'certified');
  });

  it('maps legacy aliases and rejects unknown', () => {
    assert.equal(parseVerificationListStatusParam('approved'), 'submitted');
    assert.equal(parseVerificationListStatusParam('failed_certification'), 'failed_submit');
    assert.equal(parseVerificationListStatusParam('not_a_status'), null);
    assert.equal(parseVerificationListStatusParam(null), null);
  });
});

describe('pending RC list filter', () => {
  const pending = [
    rec({ id: 'prc-1' }),
    rec({ id: 'prc-2', serialNumber: 'SN-SHARED' }),
    rec({ id: 'prc-3', serialNumber: 'SN-SHARED' }),
    rec({ id: 'prc-4' }),
    rec({ id: 'prc-5' }),
  ];
  const others = [
    rec({
      id: 'draft-1',
      status: 'draft',
      performedBy: 'rc',
      requestSource: 'rc_manual',
    }),
    rec({
      id: 'fail-1',
      status: 'submitted',
      pipelineFailedPhase: 'submit',
      pipelineFailedAt: '2026-09-08T00:00:00.000Z',
      performedBy: 'rc',
    }),
    rec({
      id: 'cert-1',
      status: 'certified',
      certificateNumber: 'IND/1',
      certificatePdfUrl: 'https://example.test/c.pdf',
      performedBy: 'rc',
    }),
    rec({
      id: 'sub-1',
      status: 'submitted',
      performedBy: 'rc',
    }),
  ];
  const all = [...pending, ...others];

  it('status filter is only pending_rc — not fail/draft/cert', () => {
    const filtered = all.filter(record => record.status === 'pending_rc');
    assert.deepEqual(
      filtered.map(row => row.id).sort(),
      pending.map(row => row.id).sort(),
    );
    assert.equal(others[0].status === 'pending_rc', false);
    assert.equal(others[1].status === 'pending_rc', false);
    assert.equal(others[2].status === 'pending_rc', false);
  });

  it('filtered length matches dashboard raw pending_rc tally; rows stay uncollapsed', () => {
    const filtered = all.filter(record => record.status === 'pending_rc');
    assert.equal(filtered.length, 5);
    assert.equal(verificationListKeepsUncollapsedRows('pending_rc'), true);
    assert.equal(verificationListKeepsUncollapsedRows('certified'), false);
    assert.equal(verificationListKeepsUncollapsedRows('failed_submit'), false);
    assert.equal(verificationListKeepsUncollapsedRows('draft'), false);
  });
});

describe('planPendingRcBulkSubmit', () => {
  it('select-all queues only pending RC; skips Fail/Draft/Cert', () => {
    const rows = [
      rec({ id: 'prc-1' }),
      rec({ id: 'prc-2' }),
      rec({
        id: 'draft-1',
        status: 'draft',
        performedBy: 'rc',
        requestSource: 'rc_manual',
      }),
      rec({
        id: 'fail-1',
        status: 'submitted',
        pipelineFailedPhase: 'submit',
        pipelineFailedAt: '2026-09-08T00:00:00.000Z',
        performedBy: 'rc',
      }),
      rec({
        id: 'cert-1',
        status: 'certified',
        certificateNumber: 'IND/2',
        certificatePdfUrl: 'https://example.test/c.pdf',
        performedBy: 'rc',
      }),
    ];

    const plan = planPendingRcBulkSubmit(rows);
    assert.deepEqual(
      plan.approveAndSubmit.map(row => row.id),
      ['prc-1', 'prc-2'],
    );
    assert.deepEqual(
      plan.ignored.map(row => row.id).sort(),
      ['cert-1', 'draft-1', 'fail-1'],
    );
    assert.deepEqual(
      filterPendingRcSubmitTargets(rows).map(row => row.id),
      ['prc-1', 'prc-2'],
    );
    assert.equal(pendingRcBulkHasWork(plan), true);
  });

  it('pending_rc without verifier work is not the approve→submit path', () => {
    const rcOwned = rec({
      id: 'prc-rc',
      performedBy: 'rc',
      requestSource: 'rc_manual',
    });
    const plan = planPendingRcBulkSubmit([rcOwned]);
    assert.deepEqual(plan.approveAndSubmit, []);
    assert.equal(plan.ignored[0]?.id, 'prc-rc');
  });

  it('confirm copy names existing approve + eMAAP submit', () => {
    const message = formatPendingRcBulkConfirmMessage(
      planPendingRcBulkSubmit([rec({ id: 'prc-1' }), rec({ id: 'draft-1', status: 'draft' })]),
    );
    assert.match(message, /Approve 1 pending RC job/);
    assert.match(message, /single-row Approve/);
    assert.match(message, /eMAAP submit/);
    assert.match(message, /Does not touch draft, fail-at-submit, or certified/);
  });

  it('bulk submit is RC Admin or Super Admin; VCT cannot', () => {
    assert.equal(canActorBulkSubmitPendingRc('rc_admin'), true);
    assert.equal(canActorBulkSubmitPendingRc('super_admin'), true);
    assert.equal(canActorBulkSubmitPendingRc('vct'), false);
    assert.equal(canActorBulkSubmitPendingRc('verifier'), false);
  });
});
