/**
 * Force RC centre staff (RC + VCT + Verifier under that RC) to sign out and log in again.
 *
 * Uses EmaapEngine credentials. Prefer superAdmin; falls back to RC (own centre only).
 *
 * Dry run:
 *   node scripts/force-relogin-rc-staff.mjs
 *   node scripts/force-relogin-rc-staff.mjs --match=DIY
 *
 * Execute:
 *   node scripts/force-relogin-rc-staff.mjs --match=DIY --execute
 *   node scripts/force-relogin-rc-staff.mjs --match=ALL --execute
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execute = process.argv.includes('--execute');
const PROJECT_ID = 'yesgatc';
const API_KEY = 'AIzaSyACjIT9hQNzAXDDZW7JaMMaVQgfyZi5oT4';
const CREDENTIALS = join(
  homedir(),
  'Library/Application Support/YesGATC/EmaapEngine/credentials.local.json',
);

function argValue(flag) {
  const raw = process.argv.find(a => a.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1).trim() : '';
}

const MATCH_RAW = (argValue('--match') || 'DIY').trim();
const MATCH = MATCH_RAW.toLowerCase() === 'all' ? '' : MATCH_RAW.toLowerCase();

function fieldString(fields, key) {
  return fields?.[key]?.stringValue?.trim() || '';
}

async function signInWithEntry(entry, label) {
  const aadhar = String(entry?.aadhar || '').replace(/\D/g, '');
  const password = entry?.password || '';
  if (aadhar.length !== 12 || !password) return null;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${aadhar}@yesgatc.auth`,
        password,
        returnSecureToken: true,
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) {
    console.warn(`${label}: sign-in failed (${body.error?.message || 'unknown'})`);
    return null;
  }

  const user = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${body.localId}`,
    { headers: { Authorization: `Bearer ${body.idToken}` } },
  );
  const userBody = await user.json();
  const role = userBody.fields?.role?.stringValue || '';
  const companyName = fieldString(userBody.fields, 'companyName');
  const username = fieldString(userBody.fields, 'username');
  const rcCode = fieldString(userBody.fields, 'rcCode');
  return {
    label,
    uid: body.localId,
    idToken: body.idToken,
    role,
    aadhar,
    companyName,
    username,
    rcCode,
  };
}

async function signInOperator() {
  if (!existsSync(CREDENTIALS)) {
    throw new Error(`Missing ${CREDENTIALS}`);
  }
  const stored = JSON.parse(readFileSync(CREDENTIALS, 'utf8'));
  const order = [
    ['superAdmin', stored.superAdmin],
    ['doca', stored.doca],
    ['rc', stored.rc],
  ];

  const signed = [];
  for (const [label, entry] of order) {
    const session = await signInWithEntry(entry, label);
    if (session) signed.push(session);
  }
  if (signed.length === 0) throw new Error('No usable credentials');

  const superAdmin = signed.find(s => s.role === 'super_admin');
  if (superAdmin) return superAdmin;

  const rc = signed.find(s => s.role === 'rc_admin');
  if (rc) {
    console.warn(
      `No super_admin credential — using RC ${rc.companyName || rc.username} (${rc.uid}). Scope = this centre only.`,
    );
    return rc;
  }

  throw new Error(
    `Signed in as ${signed.map(s => s.role).join(', ')} — need super_admin or rc_admin.`,
  );
}

async function listUsersByRole(idToken, role) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'role' },
              op: 'EQUAL',
              value: { stringValue: role },
            },
          },
        },
      }),
    },
  );
  const rows = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(rows));
  return parseUserQueryRows(rows, role);
}

async function listStaffForRc(idToken, rcId, role) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: 'role' },
                    op: 'EQUAL',
                    value: { stringValue: role },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: 'rcId' },
                    op: 'EQUAL',
                    value: { stringValue: rcId },
                  },
                },
              ],
            },
          },
        },
      }),
    },
  );
  const rows = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(rows));
  return parseUserQueryRows(rows, role);
}

function parseUserQueryRows(rows, role) {
  if (!Array.isArray(rows)) throw new Error(JSON.stringify(rows));
  const out = [];
  for (const row of rows) {
    if (row.error) throw new Error(JSON.stringify(row.error));
    const doc = row.document;
    if (!doc?.name) continue;
    const uid = doc.name.split('/').pop();
    const fields = doc.fields || {};
    out.push({
      uid,
      role,
      companyName: fieldString(fields, 'companyName'),
      username: fieldString(fields, 'username'),
      rcCode: fieldString(fields, 'rcCode'),
      rcId: fieldString(fields, 'rcId'),
    });
  }
  return out;
}

function matchesFilter(user, diyRcIds) {
  if (!MATCH) return true;
  const hay = `${user.companyName} ${user.username} ${user.rcCode}`.toLowerCase();
  if (hay.includes(MATCH)) return true;
  if (user.role !== 'rc_admin' && user.rcId && diyRcIds.has(user.rcId)) return true;
  return false;
}

async function patchUserForceLogout(idToken, uid) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}` +
    `?updateMask.fieldPaths=forceLogoutAt`;
  const now = new Date().toISOString();
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        forceLogoutAt: { timestampValue: now },
      },
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${uid}: ${body.error?.message || JSON.stringify(body)}`);
  }
}

async function bumpGlobalEpoch(idToken) {
  const settingsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/appSettings/global`;
  const settingsGet = await fetch(settingsUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const settingsBody = await settingsGet.json();
  const currentEpoch = Number(settingsBody.fields?.authSessionEpoch?.integerValue || 0) || 0;
  const nextEpoch = currentEpoch + 1;
  const patchUrl =
    `${settingsUrl}?updateMask.fieldPaths=authSessionEpoch&updateMask.fieldPaths=updatedAt`;
  const now = new Date().toISOString();
  const patch = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        authSessionEpoch: { integerValue: String(nextEpoch) },
        updatedAt: { timestampValue: now },
      },
    }),
  });
  const patchBody = await patch.json();
  if (!patch.ok) {
    throw new Error(`Failed to bump authSessionEpoch: ${JSON.stringify(patchBody)}`);
  }
  return { currentEpoch, nextEpoch };
}

async function main() {
  const operator = await signInOperator();
  console.log(
    `Operator: ${operator.role} ${operator.companyName || operator.username || operator.uid} (${operator.aadhar})`,
  );
  console.log(`Match filter: ${MATCH ? MATCH_RAW : 'ALL'}`);
  console.log(execute ? 'EXECUTE mode' : 'DRY RUN (pass --execute to apply)');

  let staff = [];
  if (operator.role === 'super_admin') {
    const [rcs, vcts, verifiers] = await Promise.all([
      listUsersByRole(operator.idToken, 'rc_admin'),
      listUsersByRole(operator.idToken, 'vct'),
      listUsersByRole(operator.idToken, 'verifier'),
    ]);
    const diyRcs = rcs.filter(rc => matchesFilter(rc, new Set()));
    const diyRcIds = new Set(diyRcs.map(rc => rc.uid));
    staff = [...rcs, ...vcts, ...verifiers].filter(user => matchesFilter(user, diyRcIds));
    console.log(`\nRC centres matched: ${diyRcs.length}`);
    for (const rc of diyRcs) {
      console.log(
        `  - ${rc.companyName || rc.username || rc.uid} [${rc.rcCode || 'no-code'}] ${rc.uid}`,
      );
    }
  } else {
    const rcId = operator.uid;
    const hay = `${operator.companyName} ${operator.username} ${operator.rcCode}`.toLowerCase();
    if (MATCH && !hay.includes(MATCH)) {
      throw new Error(
        `Logged-in RC "${operator.companyName || operator.username}" does not match --match=${MATCH_RAW}`,
      );
    }
    const [vcts, verifiers] = await Promise.all([
      listStaffForRc(operator.idToken, rcId, 'vct'),
      listStaffForRc(operator.idToken, rcId, 'verifier'),
    ]);
    staff = [
      {
        uid: operator.uid,
        role: 'rc_admin',
        companyName: operator.companyName,
        username: operator.username,
        rcCode: operator.rcCode,
        rcId: '',
      },
      ...vcts,
      ...verifiers,
    ];
    console.log(`\nCentre: ${operator.companyName || operator.username} [${operator.rcCode || 'no-code'}]`);
  }

  console.log(`Staff to force re-login: ${staff.length}`);
  console.log(`  rc_admin=${staff.filter(s => s.role === 'rc_admin').length}`);
  console.log(`  vct=${staff.filter(s => s.role === 'vct').length}`);
  console.log(`  verifier=${staff.filter(s => s.role === 'verifier').length}`);
  for (const row of staff.slice(0, 40)) {
    console.log(
      `  - [${row.role}] ${row.companyName || row.username || row.uid} ${row.uid}`,
    );
  }
  if (staff.length > 40) console.log(`  … +${staff.length - 40} more`);

  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to force logout.');
    return;
  }

  if (staff.length === 0) {
    throw new Error('No staff matched.');
  }

  if (operator.role === 'super_admin') {
    const { currentEpoch, nextEpoch } = await bumpGlobalEpoch(operator.idToken);
    console.log(`\nauthSessionEpoch: ${currentEpoch} → ${nextEpoch} (global force for matched roles)`);
  }

  let ok = 0;
  let fail = 0;
  for (const row of staff) {
    try {
      await patchUserForceLogout(operator.idToken, row.uid);
      ok += 1;
      console.log(`  forceLogoutAt set: [${row.role}] ${row.uid}`);
    } catch (err) {
      fail += 1;
      console.error(`  FAIL ${row.uid}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nDone. ok=${ok} fail=${fail}`);
  console.log('Open apps will sign out and must log in again.');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
