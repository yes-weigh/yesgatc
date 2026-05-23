/**
 * Creates the first super_admin (Firebase Auth + Firestore profile).
 *
 * Usage (PowerShell):
 *   $env:SEED_AADHAR="123456789012"
 *   $env:SEED_PASSWORD="YourSecurePassword1"
 *   $env:SEED_DISPLAY_NAME="Super Admin"   # optional
 *   $env:SEED_EMAIL="admin@example.com"    # optional contact email
 *   $env:SEED_PHONE="9876543210"           # optional contact phone
 *   npm run seed:super-admin
 *
 * Delete old Auth users in Firebase Console → Authentication before re-seeding.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyACjIT9hQNzAXDDZW7JaMMaVQgfyZi5oT4',
  authDomain: 'yesgatc.firebaseapp.com',
  projectId: 'yesgatc',
  storageBucket: 'yesgatc.firebasestorage.app',
  messagingSenderId: '56759346990',
  appId: '1:56759346990:web:db16c479912c3d213cbcbf',
};

const AUTH_EMAIL_DOMAIN = 'yesgatc.auth';

function normalizeAadhar(input) {
  return String(input).replace(/\D/g, '');
}

function authEmailForAadhar(aadhar) {
  return `${normalizeAadhar(aadhar)}@${AUTH_EMAIL_DOMAIN}`;
}

const aadhar = normalizeAadhar(process.env.SEED_AADHAR ?? '');
const password = process.env.SEED_PASSWORD ?? '';
const displayName = process.env.SEED_DISPLAY_NAME ?? 'Super Admin';
const contactEmail = (process.env.SEED_EMAIL ?? '').trim();
const contactPhone = String(process.env.SEED_PHONE ?? '').replace(/\D/g, '');

if (!/^\d{12}$/.test(aadhar)) {
  console.error('SEED_AADHAR must be exactly 12 digits.');
  process.exit(1);
}
if (password.length < 6) {
  console.error('SEED_PASSWORD must be at least 6 characters.');
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const email = authEmailForAadhar(aadhar);

console.log('Creating super_admin...');
console.log(`  Aadhar: ${aadhar}`);
console.log(`  Auth email (internal): ${email}`);

try {
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
    console.log('  Auth user created.');
  } catch (authErr) {
    const code = authErr?.code ?? '';
    if (code === 'auth/email-already-in-use') {
      console.log('  Auth user already exists — signing in to finish Firestore profile...');
      cred = await signInWithEmailAndPassword(auth, email, password);
    } else {
      throw authErr;
    }
  }
  const uid = cred.user.uid;

  const profile = {
    aadhar,
    role: 'super_admin',
    username: displayName,
    clearTextPassword: password,
    createdAt: new Date().toISOString(),
    rcId: uid,
    ...(contactEmail ? { email: contactEmail } : {}),
    ...(contactPhone.length === 10 ? { phone: contactPhone } : {}),
  };

  await setDoc(doc(db, 'users', uid), profile);

  const check = await getDoc(doc(db, 'users', uid));
  if (!check.exists()) {
    throw new Error('Firestore profile was not written.');
  }

  console.log('\n✅ Super admin created successfully.');
  console.log(`   UID: ${uid}`);
  console.log('\nSign in at the app with:');
  console.log(`   Aadhar:   ${aadhar}`);
  console.log(`   Password: (value of SEED_PASSWORD)`);
} catch (err) {
  const msg = err?.message ?? String(err);
  if (msg.includes('email-already-in-use')) {
    console.error('\n❌ This Aadhar is already registered in Firebase Auth.');
    console.error('   Delete the user in Firebase Console → Authentication, or use a different SEED_AADHAR.');
  } else {
    console.error('\n❌ Seed failed:', msg);
  }
  process.exit(1);
}

process.exit(0);
