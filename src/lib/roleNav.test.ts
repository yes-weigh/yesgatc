import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Role } from '../types.ts';
import { navSpecsForRole, roleCanOpenCertificates } from './roleNav.ts';

const ROLES: Role[] = ['super_admin', 'rc_admin', 'vct', 'verifier'];

function labels(role: Role, hasCreatedVerifiers = false): string[] {
  return navSpecsForRole(role, { hasCreatedVerifiers }).map(item => item.label);
}

describe('roleCanOpenCertificates', () => {
  it('allows RC admin only', () => {
    assert.equal(roleCanOpenCertificates('rc_admin'), true);
    assert.equal(roleCanOpenCertificates('vct'), false);
    assert.equal(roleCanOpenCertificates('super_admin'), false);
    assert.equal(roleCanOpenCertificates('verifier'), false);
    assert.equal(roleCanOpenCertificates(undefined), false);
  });
});

describe('navSpecsForRole Certificates', () => {
  it('hides Certificates nav for verifier and VCT', () => {
    assert.equal(labels('rc_admin').includes('Certificates'), true);
    assert.equal(labels('vct').includes('Certificates'), false);
    assert.equal(labels('verifier').includes('Certificates'), false);
    assert.equal(labels('super_admin').includes('Certificates'), false);
  });

  it('does not expose certificates paths to verifier or VCT', () => {
    for (const role of ROLES) {
      const paths = navSpecsForRole(role).map(item => item.path);
      const hasCert = paths.some(path => path.includes('/certificates'));
      assert.equal(hasCert, role === 'rc_admin');
    }
  });

  it('keeps verifier dashboard and verification job routes', () => {
    const paths = navSpecsForRole('verifier').map(item => item.path);
    assert.deepEqual(paths, ['/verifier', '/verifier/verification', '/verifier/profile']);
  });
});

describe('navSpecsForRole Manual PDF', () => {
  it('hides Manual PDF nav for every role', () => {
    for (const role of ROLES) {
      assert.equal(labels(role).includes('Manual PDF'), false);
    }
  });

  it('does not expose manual-pdf paths', () => {
    for (const role of ROLES) {
      const paths = navSpecsForRole(role).map(item => item.path);
      assert.equal(paths.some(path => path.includes('manual-pdf')), false);
    }
  });
});

describe('navSpecsForRole RC quota', () => {
  it('keeps RC quota as standalone after Verification for super admin', () => {
    const specs = navSpecsForRole('super_admin');
    const verificationIdx = specs.findIndex(item => item.path === '/admin/verifications');
    assert.equal(specs[verificationIdx + 1]?.path, '/admin/rc-quota');
    assert.equal(specs[verificationIdx + 1]?.label, 'RC quata');
  });
});

describe('navSpecsForRole Vr Allotted', () => {
  it('hides Vr Allotted when RC has no created verifiers', () => {
    assert.equal(labels('rc_admin', false).includes('Vr Allotted'), false);
    const specs = navSpecsForRole('rc_admin');
    assert.equal(specs.some(item => item.path === '/rc/vr-allotted'), false);
  });

  it('places Vr Allotted as a top-level item after Certificates when RC created ≥1 verifier', () => {
    const specs = navSpecsForRole('rc_admin', { hasCreatedVerifiers: true });
    const certIdx = specs.findIndex(item => item.path === '/rc/certificates');
    assert.equal(specs[certIdx]?.label, 'Certificates');
    assert.equal(specs[certIdx + 1]?.path, '/rc/vr-allotted');
    assert.equal(specs[certIdx + 1]?.label, 'Vr Allotted');
    assert.equal(specs[certIdx + 2]?.path, '/rc/customers');
    assert.equal(labels('rc_admin', true).includes('Vr Allotted'), true);
  });

  it('never shows Vr Allotted to VCT, verifier, or Super Admin', () => {
    assert.equal(labels('vct', true).includes('Vr Allotted'), false);
    assert.equal(labels('verifier', true).includes('Vr Allotted'), false);
    assert.equal(labels('super_admin', true).includes('Vr Allotted'), false);
    for (const role of ['vct', 'verifier', 'super_admin'] as const) {
      const paths = navSpecsForRole(role, { hasCreatedVerifiers: true }).map(item => item.path);
      assert.equal(paths.some(path => path.includes('vr-allotted')), false);
    }
  });

  it('keeps Verification, Certificates, then Vr Allotted as siblings', () => {
    const specs = navSpecsForRole('rc_admin', { hasCreatedVerifiers: true });
    const verificationIdx = specs.findIndex(item => item.path === '/rc/verification');
    assert.equal(specs[verificationIdx + 1]?.label, 'Certificates');
    assert.equal(specs[verificationIdx + 2]?.label, 'Vr Allotted');
    assert.equal(specs[verificationIdx + 3]?.label, 'Customers');
  });
});
