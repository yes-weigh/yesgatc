const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedYesoneWebhookUrl,
  normalizeYesoneWebhookSettings,
  certificateReadyForYesone,
  verificationReadyForYesone,
  isCertificateSigned,
  onlyYesoneMetaChanged,
  shouldPushYesone,
  shouldPushYesoneRc,
  ovQuotaAction,
  countOvUsedFromRecords,
  buildOvQuotaPayload,
  buildRcOvUsedSnapshot,
  yesoneCertificateEvent,
  yesoneRcEvent,
  buildYesoneRc,
  buildYesoneCertificatePayload,
  buildYesoneRcUsedPayload,
  payloadFingerprint,
  uniqueIssuedCertificates,
} = require('./yesoneWebhook');

test('unique issued certificates keep one row per number', () => {
  const rows = uniqueIssuedCertificates([
    {
      id: 'draft',
      data: () => ({ certificateNumber: 'IND/GATC/KL/26/04/26/10', status: 'draft' }),
    },
    {
      id: 'pdf',
      data: () => ({
        certificateNumber: 'IND/GATC/KL/26/04/26/10',
        status: 'certified',
        certificatePdfUrl: 'https://storage.example/a.pdf',
      }),
    },
    {
      id: 'other',
      data: () => ({
        certificateNumber: 'IND/GATC/KL/26/04/26/11',
        status: 'submitted',
      }),
    },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.record.certificateNumber.endsWith('/10'))?.id, 'pdf');
});

test('https URLs allowed; http only on localhost', () => {
  assert.equal(isAllowedYesoneWebhookUrl('https://yesone.app/hooks/yesgatc'), true);
  assert.equal(isAllowedYesoneWebhookUrl('http://localhost:3000/hook'), true);
  assert.equal(isAllowedYesoneWebhookUrl('http://yesone.app/hook'), false);
  assert.equal(isAllowedYesoneWebhookUrl('not-a-url'), false);
});

test('settings enable when a valid URL is stored', () => {
  const off = normalizeYesoneWebhookSettings({});
  assert.equal(off.yesoneWebhookEnabled, false);
  const on = normalizeYesoneWebhookSettings({
    yesoneWebhookUrl: 'https://yesone.app/hooks/yesgatc',
  });
  assert.equal(on.yesoneWebhookEnabled, true);
});

test('ready only after issued number plus PDF or void', () => {
  assert.equal(certificateReadyForYesone({ serialNumber: 'A' }), false);
  assert.equal(
    certificateReadyForYesone({
      certificateNumber: 'IND/GATC/KL/26/04/26/12',
      certificatePdfUrl: 'https://storage.example/a.pdf',
    }),
    true,
  );
});

test('unsigned then signed certificate events', () => {
  const before = { serialNumber: 'Y1' };
  const unsigned = {
    certificateNumber: 'IND/GATC/KL/26/04/26/3741',
    certificatePdfUrl: 'https://storage.example/a.pdf',
  };
  const signed = {
    ...unsigned,
    signedCertificatePdfUrl: 'https://storage.example/signed.pdf',
  };
  const voided = {
    ...signed,
    certificateVoidedAt: '2026-08-26T00:00:00.000Z',
  };
  assert.equal(isCertificateSigned(unsigned), false);
  assert.equal(isCertificateSigned(signed), true);
  assert.equal(yesoneCertificateEvent(before, unsigned), 'certificate.certified_unsigned');
  assert.equal(yesoneCertificateEvent(unsigned, signed), 'certificate.certified_signed');
  assert.equal(yesoneCertificateEvent(signed, voided), 'certificate.voided');
});

test('RC created, deactivated, modified', () => {
  const created = { role: 'rc_admin', companyName: 'Acme', active: true };
  const deactivated = { ...created, active: false, deactivatedAt: '2026-08-26T00:00:00.000Z' };
  const renamed = { ...created, companyName: 'Acme Labs' };
  assert.equal(yesoneRcEvent(null, created), 'rc.created');
  assert.equal(yesoneRcEvent(created, deactivated), 'rc.deactivated');
  assert.equal(yesoneRcEvent(created, renamed), 'rc.modified');
  assert.equal(shouldPushYesoneRc(null, { role: 'vct' }), false);
  assert.equal(shouldPushYesoneRc(null, created), true);
  assert.equal(
    shouldPushYesoneRc(created, { ...created, ovQuota: 40, ovQuotaSource: 'yesone' }),
    false,
  );
});

test('RC payload omits password', () => {
  const rc = buildYesoneRc('uid1', {
    role: 'rc_admin',
    aadhar: '123456789012',
    companyName: 'Acme',
    clearTextPassword: 'secret',
    phone: '9847000000',
    active: true,
  });
  assert.equal(rc.companyName, 'Acme');
  assert.equal(rc.clearTextPassword, undefined);
  assert.equal(rc.active, true);
});

test('certificate payload includes unsigned and signed PDF fields', () => {
  const payload = buildYesoneCertificatePayload(
    'rec1',
    {
      certificateNumber: 'IND/GATC/KL/26/04/26/12',
      serialNumber: 'Y02159',
      customerName: 'V. ABDULLA',
      certificatePdfUrl: 'https://storage.example/a.pdf',
      signedCertificatePdfUrl: 'https://storage.example/signed.pdf',
      verificationType: 'RV',
      productName: 'YESWEIGH',
    },
    { phone: '9847141042', address: 'OMANOOR' },
    { id: 'rc1', role: 'rc_admin', companyName: 'Meezan' },
    'certificate.certified_signed',
    '2026-08-26T00:00:00.000Z',
  );
  assert.equal(payload.certificate.signed, true);
  assert.equal(payload.certificate.unsignedPdfUrl, 'https://storage.example/a.pdf');
  assert.equal(payload.certificate.signedPdfUrl, 'https://storage.example/signed.pdf');
  assert.equal(payload.certificate.productName, 'YESWEIGH');
  assert.equal(payload.rc.companyName, 'Meezan');
  assert.equal(payload.certificate.status, null);
  assert.equal(payload.quota, null);
  assert.equal(payloadFingerprint(payload).length, 64);
});

test('OV quota consume on draft; release on reject', () => {
  const rc = { rcCode: 'ABC', ovQuota: 10, ovQuotaUsed: 2 };
  const draft = { rcId: 'rc1', serialNumber: 'Y1', status: 'draft', verificationType: 'OV' };
  const submitted = { ...draft, status: 'submitted' };
  const rejected = { ...submitted, status: 'rejected' };
  const rv = { ...draft, verificationType: 'RV' };
  assert.deepEqual(ovQuotaAction(null, draft, rc), { usedDelta: 1, unusedDelta: -1, action: 'consume' });
  assert.deepEqual(ovQuotaAction(draft, submitted, rc), { usedDelta: 0, unusedDelta: 0, action: 'none' });
  assert.deepEqual(ovQuotaAction(submitted, rejected, rc), { usedDelta: -1, unusedDelta: 1, action: 'release' });
  assert.deepEqual(ovQuotaAction(null, rv, rc), { usedDelta: 0, unusedDelta: 0, action: 'none' });
  const consume = buildYesoneCertificatePayload(
    'ov1',
    draft,
    null,
    { id: 'rc1', ...rc, role: 'rc_admin' },
    'verification.created',
    '2026-08-28T00:00:00.000Z',
    {
      usedDelta: 1,
      unusedDelta: -1,
      action: 'consume',
      status: 'draft',
      verificationType: 'OV',
      serialNumber: 'Y1',
    },
  );
  assert.equal(consume.quota.action, 'consume');
  assert.equal(consume.quota.usedDelta, 1);
  assert.equal(consume.certificate.status, 'draft');
});

test('live OV used unique serials; IWP skips before reset date', () => {
  const rc = { rcCode: 'ABC', ovQuota: 10, ovQuotaUsed: 2 };
  assert.equal(countOvUsedFromRecords([
    { verificationType: 'OV', status: 'draft', serialNumber: 'Y1' },
    { verificationType: 'OV', status: 'submitted', serialNumber: 'Y1' },
    { verificationType: 'RV', serialNumber: 'Y2' },
    { verificationType: 'OV', status: 'rejected', serialNumber: 'Y3' },
    { verificationType: 'OV', status: 'draft', serialNumber: '' },
  ], rc), 2);
  assert.equal(countOvUsedFromRecords([
    { verificationType: 'OV', status: 'draft', serialNumber: 'Y1', createdAt: '2026-08-27T18:00:00.000Z' },
    { verificationType: 'OV', status: 'draft', serialNumber: 'Y2', createdAt: '2026-08-28T00:00:00.000Z' },
  ], { rcCode: 'IWP' }), 1);
  const snap = buildRcOvUsedSnapshot(rc, 4);
  assert.equal(snap.action, 'sync');
  assert.equal(snap.used, 4);
  assert.equal(snap.balance, 6);
  const payload = buildYesoneRcUsedPayload(
    'rc1',
    { id: 'rc1', role: 'rc_admin', ...rc },
    4,
    'rc.ov_used',
    '2026-08-28T00:00:00.000Z',
  );
  assert.equal(payload.event, 'rc.ov_used');
  assert.equal(payload.quota.used, 4);
  assert.equal(payload.quota.ovDone, 4);
  assert.equal(payload.rc.ovUsed, 4);
  assert.equal(payload.rc.ovQuotaUsed, 4);
  assert.equal(payload.quota.action, 'sync');
  const auto = buildOvQuotaPayload(
    { status: 'draft', verificationType: 'OV', serialNumber: 'Y1' },
    rc,
    { usedDelta: 1, unusedDelta: -1, action: 'consume' },
    5,
  );
  assert.equal(auto.used, 5);
  assert.equal(auto.action, 'consume');
  assert.equal(auto.rcCode, 'ABC');
});

test('live verification writes push before certificate issue', () => {
  const draft = { rcId: 'rc1', serialNumber: 'Y1', status: 'draft' };
  const pending = { ...draft, status: 'pending_rc', pendingRcAt: '2026-08-28T00:00:00.000Z' };
  const submitted = { ...pending, status: 'submitted', submittedAt: '2026-08-28T01:00:00.000Z' };
  assert.equal(verificationReadyForYesone(draft), true);
  assert.equal(shouldPushYesone(null, draft), true);
  assert.equal(shouldPushYesone(null, {}), false);
  assert.equal(yesoneCertificateEvent(null, draft), 'verification.created');
  assert.equal(yesoneCertificateEvent(draft, pending), 'verification.pending_rc');
  assert.equal(yesoneCertificateEvent(pending, submitted), 'verification.submitted');
  assert.equal(yesoneCertificateEvent(draft, { ...draft, customerName: 'A' }), 'verification.updated');
});

test('status-only writes do not re-push', () => {
  const record = {
    certificateNumber: 'IND/GATC/KL/26/04/26/12',
    certificatePdfUrl: 'https://storage.example/a.pdf',
  };
  const after = {
    ...record,
    yesonePushStatus: 'sent',
    yesonePushFingerprint: 'abc',
    updatedAt: '2026-08-26T00:00:00.000Z',
  };
  assert.equal(onlyYesoneMetaChanged(record, after), true);
  assert.equal(shouldPushYesone(record, after), false);
});
