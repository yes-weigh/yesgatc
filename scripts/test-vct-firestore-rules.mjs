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
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8');

const RC_UID = 'rc-admin-test-001';
const VCT_UID = 'vct-tech-test-001';
const VERIFIER_UID = 'verifier-rasheed';
const RC_AADHAR = '111111111111';
const VCT_AADHAR = '222222222222';
const VERIFIER_AADHAR = '555555555555';

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
      await setDoc(doc(db, 'appSettings', 'global'), {
        minVerificationAppVersionCode: 0,
        zohoRvInvoicingEnabled: false,
      });
    });

    const rcDb = testEnv.authenticatedContext(RC_UID).firestore();

    try {
      await assertSucceeds(
        getDocs(
          query(
            collection(rcDb, 'users'),
            where('role', '==', 'vct'),
            where('rcId', '==', RC_UID),
            where('aadhar', '==', VCT_AADHAR),
            limit(1),
          ),
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
      await assertSucceeds(getDoc(doc(vctDb, 'siteCalibrations', 'rc-verification-001')));
      ok('VCT can read RC jobs in their centre');
    } catch (err) {
      fail('VCT can read RC jobs in their centre', err);
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
          applicationNumber: 'VC/26/1',
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

    const customerBase = {
      rcId: RC_UID,
      name: 'GPS Shop',
      phone: '9876543210',
      address: 'Main road',
      pincode: '682001',
      state: 'Kerala',
      district: 'Ernakulam',
      createdAt: new Date().toISOString(),
      createdByUid: VCT_UID,
    };

    try {
      await assertFails(setDoc(doc(vctDb, 'customers', 'cust-no-gps'), customerBase));
      ok('VCT cannot create customer without GPS');
    } catch (err) {
      fail('VCT cannot create customer without GPS', err);
    }

    try {
      await assertSucceeds(
        setDoc(doc(vctDb, 'customers', 'cust-with-gps'), {
          ...customerBase,
          location: { lat: 10.015, lng: 76.341 },
        }),
      );
      ok('VCT can create customer with GPS');
    } catch (err) {
      fail('VCT can create customer with GPS', err);
    }

    try {
      await assertSucceeds(
        updateDoc(doc(vctDb, 'customers', 'cust-with-gps'), {
          location: { lat: 11.258, lng: 75.78 },
        }),
      );
      ok('VCT can update customer GPS');
    } catch (err) {
      fail('VCT can update customer GPS', err);
    }

    try {
      await assertFails(
        updateDoc(doc(vctDb, 'customers', 'cust-with-gps'), {
          location: deleteField(),
        }),
      );
      ok('VCT cannot clear customer GPS');
    } catch (err) {
      fail('VCT cannot clear customer GPS', err);
    }

    try {
      await assertFails(
        setDoc(doc(rcDb, 'customers', 'rc-cust-no-gps'), {
          ...customerBase,
          createdByUid: RC_UID,
        }),
      );
      ok('RC cannot create customer without GPS');
    } catch (err) {
      fail('RC cannot create customer without GPS', err);
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

    const OTHER_RC = 'rc-admin-other-001';
    const SOURCE_ID = 'rc-cert-source-001';
    const OTHER_SOURCE_ID = 'other-rc-cert-001';

    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', OTHER_RC), {
        aadhar: '333333333333',
        role: 'rc_admin',
        username: 'Other RC',
      });
      await setDoc(doc(db, 'siteCalibrations', SOURCE_ID), {
        rcId: RC_UID,
        createdByUid: RC_UID,
        performedBy: 'rc',
        status: 'certified',
        verificationType: 'OV',
        serialNumber: 'SN-RESUB-1',
        applicationNumber: 'VC/26/10',
        certificateNumber: 'IND/GATC/KL/26/04/1',
        certifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(db, 'siteCalibrations', OTHER_SOURCE_ID), {
        rcId: OTHER_RC,
        createdByUid: OTHER_RC,
        performedBy: 'rc',
        status: 'certified',
        verificationType: 'OV',
        serialNumber: 'SN-OTHER-1',
        applicationNumber: 'VC/26/11',
        certificateNumber: 'IND/GATC/KL/26/04/2',
        certifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    });

    const resubmitClone = {
      rcId: RC_UID,
      createdByUid: RC_UID,
      performedBy: 'rc',
      status: 'submitted',
      verificationType: 'OV',
      serialNumber: 'SN-RESUB-1',
      applicationNumber: 'VC/26/900',
      resubmittedFromId: SOURCE_ID,
      resubmittedByUid: RC_UID,
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    try {
      await assertSucceeds(
        setDoc(doc(rcDb, 'siteCalibrations', 'rc-resubmit-clone-001'), resubmitClone),
      );
      ok('RC admin can create eMAAP resubmit clone of own certificate');
    } catch (err) {
      fail('RC admin can create eMAAP resubmit clone of own certificate', err);
    }

    const ovDraftClone = {
      ...resubmitClone,
      status: 'draft',
      applicationNumber: 'VC/26/901',
    };
    delete ovDraftClone.submittedAt;

    try {
      await assertSucceeds(
        setDoc(doc(rcDb, 'siteCalibrations', 'rc-ov-draft-clone-001'), ovDraftClone),
      );
      ok('RC admin can create OV edit-resubmit draft clone of own certificate');
    } catch (err) {
      fail('RC admin can create OV edit-resubmit draft clone of own certificate', err);
    }

    const VCT_SOURCE_ID = 'vct-origin-cert-001';
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'siteCalibrations', VCT_SOURCE_ID), {
        rcId: RC_UID,
        createdByUid: VCT_UID,
        vctId: VCT_UID,
        performedBy: 'vct',
        status: 'certified',
        verificationType: 'OV',
        serialNumber: 'SN-VCT-OV-1',
        applicationNumber: 'VC/26/12',
        certificateNumber: 'IND/GATC/KL/26/04/3',
        certifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    });

    try {
      await assertSucceeds(
        setDoc(doc(rcDb, 'siteCalibrations', 'rc-ov-vct-origin-draft-001'), {
          rcId: RC_UID,
          createdByUid: RC_UID,
          performedBy: 'vct',
          vctId: VCT_UID,
          status: 'draft',
          verificationType: 'OV',
          serialNumber: 'SN-VCT-OV-1',
          applicationNumber: 'VC/26/902',
          resubmittedFromId: VCT_SOURCE_ID,
          resubmittedByUid: RC_UID,
          createdAt: new Date().toISOString(),
        }),
      );
      ok('RC admin can draft-clone a VCT-origin OV certificate');
    } catch (err) {
      fail('RC admin can draft-clone a VCT-origin OV certificate', err);
    }

    try {
      await assertFails(
        setDoc(doc(rcDb, 'siteCalibrations', 'rc-resubmit-other-001'), {
          ...resubmitClone,
          serialNumber: 'SN-OTHER-1',
          resubmittedFromId: OTHER_SOURCE_ID,
        }),
      );
      ok('RC admin cannot resubmit another centre certificate');
    } catch (err) {
      fail('RC admin cannot resubmit another centre certificate', err);
    }

    try {
      await assertFails(
        setDoc(doc(rcDb, 'siteCalibrations', 'rc-resubmit-serial-mismatch'), {
          ...resubmitClone,
          serialNumber: 'SN-WRONG',
        }),
      );
      ok('RC admin cannot resubmit with serial mismatch');
    } catch (err) {
      fail('RC admin cannot resubmit with serial mismatch', err);
    }

    const FAIL_OWN = 'vct-failed-submit-own';
    const FAIL_RC = 'rc-failed-submit-001';
    const FAIL_REJECTED = 'vct-rejected-001';
    const FAIL_UNSIGNED = 'vct-unsigned-cert-001';
    const nowIso = new Date().toISOString();
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'siteCalibrations', FAIL_OWN), {
        rcId: RC_UID,
        createdByUid: VCT_UID,
        vctId: VCT_UID,
        performedBy: 'vct',
        status: 'submitted',
        verificationType: 'OV',
        serialNumber: 'SN-FAIL-OWN',
        applicationNumber: 'VC/26/50',
        pipelineFailedPhase: 'submit',
        pipelineFailedAt: nowIso,
        submittedAt: nowIso,
        createdAt: nowIso,
      });
      await setDoc(doc(db, 'siteCalibrations', FAIL_RC), {
        rcId: RC_UID,
        createdByUid: RC_UID,
        performedBy: 'rc',
        status: 'submitted',
        verificationType: 'OV',
        serialNumber: 'SN-FAIL-RC',
        applicationNumber: 'VC/26/51',
        pipelineFailedPhase: 'submit',
        pipelineFailedAt: nowIso,
        submittedAt: nowIso,
        createdAt: nowIso,
      });
      await setDoc(doc(db, 'siteCalibrations', FAIL_REJECTED), {
        rcId: RC_UID,
        createdByUid: VCT_UID,
        vctId: VCT_UID,
        performedBy: 'vct',
        status: 'rejected',
        verificationType: 'OV',
        serialNumber: 'SN-REJ',
        applicationNumber: 'VC/26/52',
        pipelineFailedPhase: 'submit',
        submittedAt: nowIso,
        createdAt: nowIso,
      });
      await setDoc(doc(db, 'siteCalibrations', FAIL_UNSIGNED), {
        rcId: RC_UID,
        createdByUid: VCT_UID,
        vctId: VCT_UID,
        performedBy: 'vct',
        status: 'certified',
        verificationType: 'OV',
        serialNumber: 'SN-UNSIGNED',
        applicationNumber: 'VC/26/53',
        certificateNumber: 'IND/GATC/KL/26/04/99',
        certifiedAt: nowIso,
        createdAt: nowIso,
      });
    });

    const failedSubmitResubmitPatch = {
      status: 'submitted',
      submittedAt: nowIso,
      updatedAt: nowIso,
      pipelineFailedPhase: deleteField(),
      pipelineFailureMessage: deleteField(),
      pipelineFailedAt: deleteField(),
      certificationLastError: deleteField(),
      lastFailedSubmitResubmitAt: nowIso,
      failedSubmitResubmitSource: 'manual',
      clientAppVersion: '0.0.0-test',
      clientAppVersionCode: 1,
    };

    try {
      await assertSucceeds(
        updateDoc(doc(vctDb, 'siteCalibrations', FAIL_OWN), failedSubmitResubmitPatch),
      );
      ok('VCT can resubmit own failed-at-submit job');
    } catch (err) {
      fail('VCT can resubmit own failed-at-submit job', err);
    }

    try {
      await assertFails(
        updateDoc(doc(vctDb, 'siteCalibrations', FAIL_RC), failedSubmitResubmitPatch),
      );
      ok('VCT cannot resubmit RC-owned failed-at-submit job');
    } catch (err) {
      fail('VCT cannot resubmit RC-owned failed-at-submit job', err);
    }

    try {
      await assertFails(
        updateDoc(doc(vctDb, 'siteCalibrations', FAIL_REJECTED), failedSubmitResubmitPatch),
      );
      ok('VCT cannot resubmit rejected verification');
    } catch (err) {
      fail('VCT cannot resubmit rejected verification', err);
    }

    try {
      await assertFails(
        updateDoc(doc(vctDb, 'siteCalibrations', FAIL_UNSIGNED), {
          ...failedSubmitResubmitPatch,
          status: 'submitted',
        }),
      );
      ok('VCT cannot resubmit unsigned certified verification');
    } catch (err) {
      fail('VCT cannot resubmit unsigned certified verification', err);
    }

    try {
      await assertSucceeds(
        updateDoc(doc(rcDb, 'siteCalibrations', FAIL_RC), failedSubmitResubmitPatch),
      );
      ok('RC admin can resubmit own failed-at-submit job');
    } catch (err) {
      fail('RC admin can resubmit own failed-at-submit job', err);
    }

    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', VERIFIER_UID), {
        aadhar: VERIFIER_AADHAR,
        role: 'verifier',
        rcId: RC_UID,
        active: true,
        username: 'Rasheed',
        createdAt: new Date().toISOString(),
      });
    });
    const verifierDb = testEnv.authenticatedContext(VERIFIER_UID).firestore();

    const verifierOvDraft = (serialNumber, applicationNumber) => ({
      rcId: RC_UID,
      createdByUid: VERIFIER_UID,
      vctId: VERIFIER_UID,
      performedBy: 'verifier',
      requestSource: 'verifier',
      status: 'draft',
      verificationType: 'OV',
      applicationNumber,
      customerName: 'Verifier Customer',
      productName: 'Bench PC',
      serialNumber,
      createdAt: new Date().toISOString(),
    });

    try {
      await assertFails(
        setDoc(
          doc(verifierDb, 'siteCalibrations', 'vr-ov-unallotted'),
          verifierOvDraft('X00423', 'VC/26/10'),
        ),
      );
      ok('Verifier cannot create OV with GAS serial not allotted to them');
    } catch (err) {
      fail('Verifier cannot create OV with GAS serial not allotted to them', err);
    }

    try {
      await assertSucceeds(
        setDoc(
          doc(verifierDb, 'siteCalibrations', 'vr-ov-empty'),
          verifierOvDraft('', 'VC/26/11'),
        ),
      );
      ok('Verifier can create OV draft with empty serial');
    } catch (err) {
      fail('Verifier can create OV draft with empty serial', err);
    }

    try {
      await assertSucceeds(
        setDoc(
          doc(verifierDb, 'siteCalibrations', 'vr-ov-pas'),
          verifierOvDraft('YJ01001', 'VC/26/12'),
        ),
      );
      ok('Verifier can create OV with PAS serial without GAS allotment');
    } catch (err) {
      fail('Verifier can create OV with PAS serial without GAS allotment', err);
    }

    try {
      await assertSucceeds(
        setDoc(doc(verifierDb, 'siteCalibrations', 'vr-rv-unallotted'), {
          ...verifierOvDraft('X00423', 'VC/26/13'),
          verificationType: 'RV',
        }),
      );
      ok('Verifier RV may use existing serial without unused GAS allotment');
    } catch (err) {
      fail('Verifier RV may use existing serial without unused GAS allotment', err);
    }

    try {
      await assertFails(
        setDoc(doc(verifierDb, 'customers', 'vr-cust-no-gps'), {
          rcId: RC_UID,
          name: 'Verifier Shop',
          phone: '9876543210',
          address: 'Main road',
          pincode: '682001',
          createdByUid: VERIFIER_UID,
          createdAt: new Date().toISOString(),
        }),
      );
      ok('Verifier cannot create customer without GPS');
    } catch (err) {
      fail('Verifier cannot create customer without GPS', err);
    }

    try {
      await assertSucceeds(
        updateDoc(doc(rcDb, 'users', RC_UID), {
          yesoneVerifierAllottedByUid: { [VERIFIER_UID]: ['X00423', 'G0541'] },
          yesoneReservedSerials: ['X00423', 'G0541'],
          yesoneReservedForUids: [VERIFIER_UID],
        }),
      );
      ok('RC admin can allot GAS seats to own verifier on own user doc');
    } catch (err) {
      fail('RC admin can allot GAS seats to own verifier on own user doc', err);
    }

    try {
      await assertSucceeds(
        setDoc(
          doc(verifierDb, 'siteCalibrations', 'vr-ov-allotted'),
          verifierOvDraft('X00423', 'VC/26/14'),
        ),
      );
      ok('Verifier can create OV with GAS serial allotted to their uid');
    } catch (err) {
      fail('Verifier can create OV with GAS serial allotted to their uid', err);
    }

    try {
      await assertFails(
        setDoc(
          doc(verifierDb, 'siteCalibrations', 'vr-ov-other-range'),
          verifierOvDraft('X00424', 'VC/26/15'),
        ),
      );
      ok('Verifier cannot create OV with RC unused GAS serial not allotted to them');
    } catch (err) {
      fail('Verifier cannot create OV with RC unused GAS serial not allotted to them', err);
    }

    try {
      await assertFails(
        updateDoc(doc(verifierDb, 'siteCalibrations', 'vr-ov-empty'), {
          serialNumber: 'X00424',
        }),
      );
      ok('Verifier cannot update draft to unallotted GAS serial');
    } catch (err) {
      fail('Verifier cannot update draft to unallotted GAS serial', err);
    }

    try {
      await assertSucceeds(
        updateDoc(doc(verifierDb, 'siteCalibrations', 'vr-ov-empty'), {
          serialNumber: 'G0541',
        }),
      );
      ok('Verifier can update draft to allotted GAS serial');
    } catch (err) {
      fail('Verifier can update draft to allotted GAS serial', err);
    }

    try {
      await assertFails(
        updateDoc(doc(vctDb, 'users', RC_UID), {
          yesoneVerifierAllottedByUid: { [VERIFIER_UID]: ['X99999'] },
        }),
      );
      ok('VCT cannot allot serials on parent RC user doc');
    } catch (err) {
      fail('VCT cannot allot serials on parent RC user doc', err);
    }

    try {
      await assertFails(
        updateDoc(doc(verifierDb, 'users', RC_UID), {
          yesoneVerifierAllottedByUid: { [VERIFIER_UID]: ['X00424'] },
        }),
      );
      ok('Verifier cannot allot serials on parent RC user doc');
    } catch (err) {
      fail('Verifier cannot allot serials on parent RC user doc', err);
    }

    const otherRcAdminDb = testEnv.authenticatedContext('other-rc-admin-002').firestore();
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'other-rc-admin-002'), {
        aadhar: '444444444444',
        role: 'rc_admin',
        username: 'Other RC',
        companyName: 'Other RC',
      });
    });
    try {
      await assertFails(
        updateDoc(doc(otherRcAdminDb, 'users', RC_UID), {
          yesoneVerifierAllottedByUid: { stolen: ['X00423'] },
        }),
      );
      ok('RC admin cannot allot serials on another RC user doc');
    } catch (err) {
      fail('RC admin cannot allot serials on another RC user doc', err);
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
