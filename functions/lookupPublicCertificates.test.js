const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePublicCertificatePdfUrl,
  buildLookupValues,
  isIssuedPublicCertificate,
  toPublicCertificate,
} = require('./lookupPublicCertificates');

test('PDF order is signed, then eMAAP, then stored', () => {
  assert.equal(
    resolvePublicCertificatePdfUrl({
      signedCertificatePdfUrl: 'https://signed.example/a.pdf',
      emaapCertificatePdfUrl: 'https://gatcapi.example/thirpartycertificate/a.pdf',
      certificatePdfUrl: 'https://storage.example/a.pdf',
    }),
    'https://signed.example/a.pdf',
  );
  assert.equal(
    resolvePublicCertificatePdfUrl({
      emaapCertificatePdfUrl: 'https://gatcapi.example/thirpartycertificate/a.pdf',
      certificatePdfUrl: 'https://storage.example/a.pdf',
    }),
    'https://gatcapi.example/thirpartycertificate/a.pdf',
  );
  assert.equal(
    resolvePublicCertificatePdfUrl({ certificatePdfUrl: 'https://storage.example/a.pdf' }),
    'https://storage.example/a.pdf',
  );
});

test('lookup values cover serial case and compacted certificate number', () => {
  const values = buildLookupValues('ind / gatc / kl / 26 / 04 / 26 / 12');
  assert.ok(values.serials.includes('ind / gatc / kl / 26 / 04 / 26 / 12'));
  assert.ok(values.certificates.includes('IND/GATC/KL/26/04/26/12'));
});

test('only issued certificates with a real number are public', () => {
  assert.equal(isIssuedPublicCertificate({ serialNumber: 'ABC' }), false);
  assert.equal(isIssuedPublicCertificate({ certificateNumber: 'IND/GATC/KL/26/04/26/12' }), true);
  assert.equal(
    isIssuedPublicCertificate({ certificateNumber: 'System.Collections.Generic.Dictionary`2' }),
    false,
  );
});

test('voided certificates keep summary but drop the PDF', () => {
  const hit = toPublicCertificate({
    certificateNumber: 'IND/GATC/KL/26/04/26/12',
    serialNumber: 'ABC123',
    customerName: 'Acme',
    certifiedAt: '2026-08-01T00:00:00.000Z',
    verificationType: 'RV',
    certificateVoidedAt: '2026-08-02T00:00:00.000Z',
    signedCertificatePdfUrl: 'https://signed.example/a.pdf',
  });
  assert.equal(hit.voided, true);
  assert.equal(hit.pdfUrl, null);
  assert.equal(hit.customerName, 'Acme');
});
