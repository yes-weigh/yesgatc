const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedYesoneWebhookUrl,
  normalizeYesoneWebhookSettings,
  certificateReadyForYesone,
  isCertificateSigned,
  onlyYesoneMetaChanged,
  shouldPushYesone,
  shouldPushYesoneRc,
  yesoneCertificateEvent,
  yesoneRcEvent,
  buildYesoneRc,
  buildYesoneCertificatePayload,
  payloadFingerprint,
} = require('./yesoneWebhook');

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
  assert.equal(payloadFingerprint(payload).length, 64);
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
