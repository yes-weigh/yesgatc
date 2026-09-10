import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RC_CERTIFICATION_METHOD_EDIT_OPTIONS,
  rcCertificationMethodFromUser,
  rcUsesManualSignedUpload,
  rcUsesPdfSigner,
} from './rcCertificationMethod.ts';

describe('RC certification method', () => {
  it('defaults unset to auto DSC — not manual upload', () => {
    assert.equal(rcCertificationMethodFromUser(undefined), 'auto_dsc');
    assert.equal(rcUsesManualSignedUpload(undefined), false);
    assert.equal(rcUsesPdfSigner(undefined), false);
  });

  it('treats pdf_signer as worker stamp + eMAAP upload, not file picker', () => {
    assert.equal(rcUsesPdfSigner({ certificationMethod: 'pdf_signer' }), true);
    assert.equal(rcUsesManualSignedUpload({ certificationMethod: 'pdf_signer' }), false);
  });

  it('treats cached eMAAP PDF signer as pdf signer even if Super Admin still says manual', () => {
    assert.equal(
      rcUsesPdfSigner({ certificationMethod: 'manual_upload', emaapSignerType: 'pdf_signer' }),
      true,
    );
    assert.equal(
      rcUsesManualSignedUpload({
        certificationMethod: 'manual_upload',
        emaapSignerType: 'pdf_signer',
      }),
      false,
    );
  });

  it('does not let eMAAP cache override Auto DSC', () => {
    assert.equal(
      rcUsesPdfSigner({ certificationMethod: 'auto_dsc', emaapSignerType: 'pdf_signer' }),
      false,
    );
  });

  it('keeps file-picker path only for leftover manual_upload', () => {
    assert.equal(rcUsesManualSignedUpload({ certificationMethod: 'manual_upload' }), true);
    assert.equal(rcUsesPdfSigner({ certificationMethod: 'manual_upload' }), false);
  });

  it('does not offer Manual upload on the Super Admin RC editor', () => {
    assert.deepEqual(
      RC_CERTIFICATION_METHOD_EDIT_OPTIONS.map(option => option.id),
      ['auto_dsc', 'pdf_signer'],
    );
  });
});
