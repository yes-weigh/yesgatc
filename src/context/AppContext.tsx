/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Job, Product, Certificate } from '../types';
import { useAuth } from './useAuth';
import { filterAdminManagedProducts } from '../lib/productAccess';

interface AppContextType {
  jobs: Job[];
  products: Product[];
  certificates: Certificate[];
  loadingData: boolean;
  createJob: (job: Omit<Job, 'id'>) => Promise<void>;
  updateJob: (jobId: string, updates: Partial<Job>) => Promise<void>;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (productId: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  addCertificate: (cert: Omit<Certificate, 'id'>) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [jobs,         setJobs]         = useState<Job[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [loadingData,  setLoadingData]  = useState(true);

  const products = useMemo(() => {
    if (user?.role === 'super_admin') return allProducts;
    return filterAdminManagedProducts(allProducts);
  }, [allProducts, user?.role]);

  useEffect(() => {
    if (!user) {
      Promise.resolve().then(() => {
        setJobs([]);
        setAllProducts([]);
        setCertificates([]);
        setLoadingData(false);
      });
      return;
    }

    Promise.resolve().then(() => setLoadingData(true));
    let loaded = 0;
    const done = () => { loaded++; if (loaded >= 3) setLoadingData(false); };

    const unsubJobs = onSnapshot(
      query(collection(db, 'jobs'), orderBy('createdAt', 'desc')),
      snap => { setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Job))); done(); },
      () => done()
    );

    const unsubProducts = onSnapshot(
      collection(db, 'products'),
      snap => { setAllProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product))); done(); },
      () => done()
    );

    const unsubCerts = onSnapshot(
      collection(db, 'certificates'),
      snap => { setCertificates(snap.docs.map(d => ({ id: d.id, ...d.data() } as Certificate))); done(); },
      () => done()
    );

    return () => { unsubJobs(); unsubProducts(); unsubCerts(); };
  }, [user]);

  const createJob = async (job: Omit<Job, 'id'>) => {
    await addDoc(collection(db, 'jobs'), {
      ...job,
      createdAt: new Date().toISOString(),
      _createdAt: serverTimestamp(),
    });
  };

  const updateJob = async (jobId: string, updates: Partial<Job>) => {
    await updateDoc(doc(db, 'jobs', jobId), { ...updates, _updatedAt: serverTimestamp() });
  };

  const addProduct = async (product: Omit<Product, 'id'>) => {
    await addDoc(collection(db, 'products'), product);
  };

  const updateProduct = async (productId: string, updates: Partial<Product>) => {
    await updateDoc(doc(db, 'products', productId), updates);
  };

  const deleteProduct = async (productId: string) => {
    await deleteDoc(doc(db, 'products', productId));
  };

  const addCertificate = async (cert: Omit<Certificate, 'id'>) => {
    const certRef = doc(collection(db, 'certificates'));
    await setDoc(certRef, { ...cert, issuedAt: new Date().toISOString() });
  };

  return (
    <AppContext.Provider value={{
      jobs, products, certificates, loadingData,
      createJob, updateJob, addProduct, updateProduct, deleteProduct, addCertificate,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
};
