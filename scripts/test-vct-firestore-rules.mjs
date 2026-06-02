/**
 * Firestore rules smoke test — RC Admin Add Technician flow.
 * Run: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8');

const RC_UID = 'rc-admin-test-001';
const VCT_UID = 'vct-tech-test-001';
const RC_AADHAR = '111111111111';
const VCT_AADHAR = '222222222222';

let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.error(`  ✗ ${name}`);
  console.error(`    ${err instanceof Error ? err.message : err}`);
}

async function run() {
  console.log('\nFirestore rules — RC Add Technician\n');

  const testEnv = await initializeTestEnvironment({
    projectId: 'yesgatc-rules-test',
    firestore: { rules },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', RC_UID), {
        aadhar: RC_AADHAR,
        role: 'rc_admin',
        username: 'Test RC',
        companyName: 'Test RC Center',
      });
    });

    const rcDb = testEnv.authenticatedContext(RC_UID).firestore();

    try {
      await assertSucceeds(
        getDocs(
          query(collection(rcDb, 'users'), where('aadhar', '==', VCT_AADHAR), limit(1)),
        ),
      );
      ok('RC admin can run Aadhar duplicate-check query');
    } catch (err) {
      fail('RC admin can run Aadhar duplicate-check query', err);
    }

    try {
      await assertSucceeds(
        setDoc(doc(rcDb, 'users', VCT_UID), {
          aadhar: VCT_AADHAR,
          role: 'vct',
          rcId: RC_UID,
          approvalStatus: 'pending',
          username: 'Test Technician',
          phone: '9876543210',
          address: 'Test address',
          pincode: '560001',
          policeStation: 'Test PS',
          secondaryContactName: 'Contact',
          secondaryContactRelationship: 'Spouse',
          secondaryContactPhone: '9876543211',
          workflowMode: 'auto',
          createdAt: new Date().toISOString(),
        }),
      );
      ok('RC admin can create VCT profile at new uid');
    } catch (err) {
      fail('RC admin can create VCT profile at new uid', err);
    }

    try {
      await assertSucceeds(
        getDocs(collection(rcDb, 'rcVcts', RC_UID, 'members')),
      );
      ok('RC admin can list their VCT roster');
    } catch (err) {
      fail('RC admin can list their VCT roster', err);
    }

    try {
      await assertSucceeds(
        setDoc(doc(rcDb, 'rcVcts', RC_UID, 'members', VCT_UID), {
          uid: VCT_UID,
          aadhar: VCT_AADHAR,
          username: 'Test Technician',
          approvalStatus: 'pending',
          createdAt: new Date().toISOString(),
        }),
      );
      ok('RC admin can add VCT to roster index');
    } catch (err) {
      fail('RC admin can add VCT to roster index', err);
    }

    try {
      await assertSucceeds(getDocs(collection(rcDb, 'rcVcts', RC_UID, 'members')));
      ok('RC admin can read roster after index write');
    } catch (err) {
      fail('RC admin can read roster after index write', err);
    }

    const otherRcDb = testEnv.authenticatedContext('other-rc-999').firestore();
    try {
      await assertFails(
        setDoc(doc(otherRcDb, 'users', 'vct-hijack'), {
          aadhar: '333333333333',
          role: 'vct',
          rcId: RC_UID,
          approvalStatus: 'pending',
          username: 'Hijack',
        }),
      );
      ok('Unauthenticated profile cannot create VCT under another RC');
    } catch (err) {
      fail('Unauthenticated profile cannot create VCT under another RC', err);
    }

    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', VCT_UID), {
        aadhar: VCT_AADHAR,
        role: 'vct',
        rcId: RC_UID,
        approvalStatus: 'approved',
        active: true,
        username: 'Test Technician',
        phone: '9876543210',
        workflowMode: 'auto',
        createdAt: new Date().toISOString(),
      });
    });

    const vctDb = testEnv.authenticatedContext(VCT_UID).firestore();

    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'siteCalibrations', 'rc-verification-001'), {
        rcId: RC_UID,
        createdByUid: RC_UID,
        performedBy: 'rc',
        status: 'draft',
        verificationType: 'OV',
        customerName: 'RC Customer',
        createdAt: new Date().toISOString(),
      });
    });

    try {
      await assertSucceeds(
        getDocs(
          query(
            collection(vctDb, 'siteCalibrations'),
            where('rcId', '==', RC_UID),
            where('createdByUid', '==', VCT_UID),
          ),
        ),
      );
      ok('VCT can list only their own verifications');
    } catch (err) {
      fail('VCT can list only their own verifications', err);
    }

    try {
      await assertFails(getDoc(doc(vctDb, 'siteCalibrations', 'rc-verification-001')));
      ok('VCT cannot read RC admin verification');
    } catch (err) {
      fail('VCT cannot read RC admin verification', err);
    }

    const verificationId = 'vct-verification-001';
    try {
      await assertSucceeds(
        setDoc(doc(vctDb, 'siteCalibrations', verificationId), {
          rcId: RC_UID,
          createdByUid: VCT_UID,
          vctId: VCT_UID,
          vctName: 'Test Technician',
          performedBy: 'vct',
          requestSource: 'vct_auto',
          status: 'draft',
          verificationType: 'OV',
          customerName: 'Test Customer',
          productName: 'Test Scale',
          serialNumber: 'SN-001',
          createdAt: new Date().toISOString(),
        }),
      );
      ok('VCT can create draft verification for their RC');
    } catch (err) {
      fail('VCT can create draft verification for their RC', err);
    }

    try {
      await assertSucceeds(getDoc(doc(vctDb, 'users', RC_UID)));
      ok('VCT can read parent RC profile (laboratory seal)');
    } catch (err) {
      fail('VCT can read parent RC profile (laboratory seal)', err);
    }

    try {
      await assertSucceeds(
        getDocs(query(collection(vctDb, 'customers'), where('rcId', '==', RC_UID))),
      );
      ok('VCT can list customers for their RC');
    } catch (err) {
      fail('VCT can list customers for their RC', err);
    }

    try {
      await assertFails(
        setDoc(doc(vctDb, 'siteCalibrations', 'vct-verification-bad'), {
          rcId: 'other-rc-999',
          createdByUid: VCT_UID,
          status: 'draft',
          verificationType: 'OV',
          customerName: 'Test Customer',
          createdAt: new Date().toISOString(),
        }),
      );
      ok('VCT cannot create verification under another RC');
    } catch (err) {
      fail('VCT cannot create verification under another RC', err);
    }
  } finally {
    await testEnv.cleanup();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
