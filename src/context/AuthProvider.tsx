import React, { useState, useEffect } from 'react';
import {
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  authEmailForAadhar,
  authErrorMessage,
  isValidAadhar,
  normalizeAadhar,
} from '../lib/aadharAuth';
import {
  APP_SETTINGS_COLLECTION,
  APP_SETTINGS_GLOBAL_DOC,
  normalizeAppSettings,
} from '../lib/appSettings';
import { clearEmbedToken, takeEmbedTokenFromLocation } from '../lib/embedMode';
import { isVctApproved, isVctActive, VCT_INACTIVE_LOGIN_MESSAGE, VCT_PENDING_LOGIN_MESSAGE } from '../lib/vctApproval';
import { isVerifierActive, VERIFIER_INACTIVE_LOGIN_MESSAGE } from '../lib/verifierAccount';
import { isRcAccountActive, RC_ACCOUNT_INACTIVE_LOGIN_MESSAGE } from '../lib/rcActivation';
import type { User, Role, FirestoreUserDoc } from '../types';
import { AuthContext } from './auth-context';

const VALID_ROLES: Role[] = ['super_admin', 'rc_admin', 'vct', 'verifier'];
const FORCE_RELOGIN_ROLES: Role[] = ['rc_admin', 'vct', 'verifier'];
const AUTH_SESSION_EPOCH_KEY = 'yesgatc.authSessionEpoch';
const AUTH_LOGIN_AT_KEY = 'yesgatc.authLoginAt';
export const SESSION_ENDED_LOGIN_MESSAGE = 'Session ended. Please sign in again.';

function readAcceptedEpoch(): number {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_EPOCH_KEY);
    const value = raw == null ? 0 : Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function writeAcceptedEpoch(epoch: number) {
  try {
    sessionStorage.setItem(AUTH_SESSION_EPOCH_KEY, String(Math.max(0, Math.floor(epoch))));
  } catch {
    /* ignore */
  }
}

function readLoginAtMs(): number {
  try {
    const raw = sessionStorage.getItem(AUTH_LOGIN_AT_KEY);
    const value = raw == null ? 0 : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeLoginAtMs(ms: number) {
  try {
    sessionStorage.setItem(AUTH_LOGIN_AT_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

function forceLogoutAtMs(data: Record<string, unknown> | undefined): number {
  const raw = data?.forceLogoutAt;
  if (!raw) return 0;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof raw === 'object' && raw !== null && 'toMillis' in raw) {
    const toMillis = (raw as { toMillis?: () => number }).toMillis;
    if (typeof toMillis === 'function') {
      try {
        return toMillis.call(raw);
      } catch {
        return 0;
      }
    }
  }
  if (typeof raw === 'object' && raw !== null && 'seconds' in raw) {
    const seconds = Number((raw as { seconds?: unknown }).seconds);
    return Number.isFinite(seconds) ? seconds * 1000 : 0;
  }
  return 0;
}

const resolveUser = async (fbUser: FirebaseUser): Promise<User | null> => {
  try {
    const snap = await getDoc(doc(db, 'users', fbUser.uid));
    if (!snap.exists()) return null;

    const data = snap.data() as FirestoreUserDoc;
    const role = VALID_ROLES.includes(data.role as Role) ? (data.role as Role) : null;
    const aadhar = normalizeAadhar(data.aadhar ?? '');
    if (!role || !isValidAadhar(aadhar)) return null;

    if (role === 'vct' && !isVctApproved(data)) return null;
    if (role === 'vct' && !isVctActive(data)) return null;
    if (role === 'verifier' && !isVerifierActive(data)) return null;
    if (role === 'rc_admin' && !isRcAccountActive(data)) return null;

    return {
      uid: fbUser.uid,
      aadhar,
      username: data.username || 'User',
      role,
      rcId: data.rcId,
      email: data.email?.trim() || undefined,
      phone: data.phone?.trim() || undefined,
    };
  } catch {
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const embedToken = takeEmbedTokenFromLocation();
    const embedSignIn = embedToken
      ? signInWithCustomToken(auth, embedToken)
          .then(() => {
            clearEmbedToken();
          })
          .catch(err => {
            console.error('Embed sign-in failed', err);
            if (!cancelled) {
              setError('Could not open the embedded verification session.');
            }
          })
      : Promise.resolve();

    const unsub = onAuthStateChanged(auth, async fbUser => {
      await embedSignIn;
      if (cancelled) return;
      const activeUser = auth.currentUser ?? fbUser;
      if (activeUser) {
        const resolved = await resolveUser(activeUser);
        setUser(resolved);
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!user || !FORCE_RELOGIN_ROLES.includes(user.role)) return;

    let ending = false;
    const endSession = async () => {
      if (ending) return;
      ending = true;
      setError(SESSION_ENDED_LOGIN_MESSAGE);
      setUser(null);
      await signOut(auth).catch(() => undefined);
    };

    const settingsUnsub = onSnapshot(
      doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC),
      async snap => {
        const epoch = normalizeAppSettings(snap.exists() ? snap.data() : undefined).authSessionEpoch ?? 0;
        if (epoch > readAcceptedEpoch()) await endSession();
      },
      () => {
        /* ignore */
      },
    );

    const userUnsub = onSnapshot(
      doc(db, 'users', user.uid),
      async snap => {
        if (!snap.exists()) return;
        const forcedAt = forceLogoutAtMs(snap.data() as Record<string, unknown>);
        const loginAt = readLoginAtMs();
        if (forcedAt > 0 && forcedAt > loginAt) await endSession();
      },
      () => {
        /* ignore */
      },
    );

    return () => {
      settingsUnsub();
      userUnsub();
    };
  }, [user]);

  const login = async (aadharInput: string, password: string) => {
    setError(null);
    setLoading(true);
    const aadhar = normalizeAadhar(aadharInput);
    if (aadhar.length === 10) {
      const msg = 'That is a phone number. Use the 12-digit Aadhar on the Verifiers card.';
      setError(msg);
      setLoading(false);
      throw new Error(msg);
    }
    if (!isValidAadhar(aadhar)) {
      const msg = 'Aadhar number must be exactly 12 digits.';
      setError(msg);
      setLoading(false);
      throw new Error(msg);
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, authEmailForAadhar(aadhar), password);
      const snap = await getDoc(doc(db, 'users', cred.user.uid));
      if (!snap.exists()) {
        await signOut(auth);
        throw new Error(
          'No staff profile for this Aadhar. In Verifiers, add them again with the same Aadhar and password.',
        );
      }
      const data = snap.data() as FirestoreUserDoc;
      if (data.role === 'vct' && !isVctApproved(data)) {
        await signOut(auth);
        throw new Error(VCT_PENDING_LOGIN_MESSAGE);
      }
      if (data.role === 'vct' && !isVctActive(data)) {
        await signOut(auth);
        throw new Error(VCT_INACTIVE_LOGIN_MESSAGE);
      }
      if (data.role === 'verifier' && !isVerifierActive(data)) {
        await signOut(auth);
        throw new Error(VERIFIER_INACTIVE_LOGIN_MESSAGE);
      }
      if (data.role === 'rc_admin' && !isRcAccountActive(data)) {
        await signOut(auth);
        throw new Error(RC_ACCOUNT_INACTIVE_LOGIN_MESSAGE);
      }
      const resolved = await resolveUser(cred.user);
      if (!resolved) {
        await signOut(auth);
        if (!VALID_ROLES.includes(data.role as Role)) {
          throw new Error('This app version cannot open this account. Hard-refresh YES LAB and try again.');
        }
        throw new Error('No profile found for this account. Contact your administrator.');
      }

      const settingsSnap = await getDoc(doc(db, APP_SETTINGS_COLLECTION, APP_SETTINGS_GLOBAL_DOC));
      const epoch = normalizeAppSettings(
        settingsSnap.exists() ? settingsSnap.data() : undefined,
      ).authSessionEpoch ?? 0;
      writeAcceptedEpoch(epoch);
      writeLoginAtMs(Date.now());

      setUser(resolved);
    } catch (err: unknown) {
      const friendly = authErrorMessage(err, 'Login failed');
      setError(friendly);
      throw new Error(friendly, { cause: err });
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
