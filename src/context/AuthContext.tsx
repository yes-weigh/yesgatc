/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  authEmailForAadhar,
  authErrorMessage,
  isValidAadhar,
  normalizeAadhar,
} from '../lib/aadharAuth';
import type { User, Role, FirestoreUserDoc } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (aadhar: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const VALID_ROLES: Role[] = ['super_admin', 'rc_admin', 'vct'];

const resolveUser = async (fbUser: FirebaseUser): Promise<User | null> => {
  try {
    const snap = await getDoc(doc(db, 'users', fbUser.uid));
    if (!snap.exists()) return null;

    const data = snap.data() as FirestoreUserDoc;
    const role = VALID_ROLES.includes(data.role as Role) ? (data.role as Role) : null;
    const aadhar = normalizeAadhar(data.aadhar ?? '');
    if (!role || !isValidAadhar(aadhar)) return null;

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
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const resolved = await resolveUser(fbUser);
        setUser(resolved);
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async (aadharInput: string, password: string) => {
    setError(null);
    setLoading(true);
    const aadhar = normalizeAadhar(aadharInput);
    if (!isValidAadhar(aadhar)) {
      const msg = 'Aadhar number must be exactly 12 digits.';
      setError(msg);
      setLoading(false);
      throw new Error(msg);
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, authEmailForAadhar(aadhar), password);
      const resolved = await resolveUser(cred.user);
      if (!resolved) {
        await signOut(auth);
        throw new Error('No profile found for this account. Contact your administrator.');
      }
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

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
