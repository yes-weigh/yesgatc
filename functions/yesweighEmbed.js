const { timingSafeEqual } = require('crypto');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const AUTH_EMAIL_DOMAIN = 'yesgatc.auth';

function secretsEqual(provided, expected) {
  const left = Buffer.from(String(provided ?? ''), 'utf8');
  const right = Buffer.from(String(expected ?? ''), 'utf8');
  if (!right.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function resolveUidByAadhar(aadhar) {
  const indexSnap = await getFirestore().doc(`aadharIndex/${aadhar}`).get();
  const indexedUid = indexSnap.exists ? String(indexSnap.data()?.uid ?? '').trim() : '';
  if (indexedUid) return indexedUid;

  try {
    const authUser = await getAuth().getUserByEmail(`${aadhar}@${AUTH_EMAIL_DOMAIN}`);
    if (authUser?.uid) return authUser.uid;
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') throw err;
  }

  const usersSnap = await getFirestore()
    .collection('users')
    .where('aadhar', '==', aadhar)
    .limit(1)
    .get();
  if (!usersSnap.empty) return usersSnap.docs[0].id;
  return '';
}

/**
 * Mints a Firebase custom token for the YesWeigh Service iframe embed.
 * Auth is the shared YESWEIGH_EMBED_SECRET header — not the RC password.
 */
async function mintYesweighEmbedTokenHandler(req, res, secret, aadharInput) {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const provided = req.get('x-yesweigh-embed-secret') || '';
  if (!secretsEqual(provided, secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const aadhar = String(aadharInput ?? '').replace(/\D/g, '');
  if (aadhar.length !== 12) {
    res.status(500).json({ error: 'Embed RC Aadhar is not configured.' });
    return;
  }

  const uid = await resolveUidByAadhar(aadhar);
  if (!uid) {
    res.status(404).json({ error: 'RC login not found' });
    return;
  }

  const userSnap = await getFirestore().doc(`users/${uid}`).get();
  const role = userSnap.exists ? String(userSnap.data()?.role ?? '') : '';
  if (role !== 'rc_admin') {
    res.status(403).json({ error: 'Embed account is not an RC admin' });
    return;
  }

  const token = await getAuth().createCustomToken(uid, {
    embed: true,
    source: 'yesweigh-service',
  });
  res.json({ token });
}

module.exports = { mintYesweighEmbedTokenHandler };
