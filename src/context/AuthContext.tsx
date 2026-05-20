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
import type { User, Role, FirestoreUserDoc } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
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
    if (!role) return null;

    return {
      uid: fbUser.uid,
      email: fbUser.email ?? data.email,
      username: data.username || fbUser.email?.split('@')[0] || 'User',
      role,
      rcId: data.rcId,
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

  const login = async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const resolved = await resolveUser(cred.user);
      if (!resolved) {
        await signOut(auth);
        throw new Error('No profile found for this account. Contact your administrator.');
      }
      setUser(resolved);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : 'Login failed';
      const friendly =
        raw.includes('invalid-credential') || raw.includes('wrong-password') || raw.includes('user-not-found')
          ? 'Invalid email or password.'
          : raw;
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
