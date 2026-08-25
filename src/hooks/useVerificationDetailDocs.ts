import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import type { Customer, Product, SiteCalibration } from '../types';

export function resolveProductForVerification(
  record: Pick<SiteCalibration, 'productId' | 'productName'>,
  products: Product[],
): Product | null {
  const productId = record.productId?.trim();
  if (productId) {
    const byId = products.find(product => product.id === productId);
    if (byId) return byId;
  }
  const name = record.productName?.trim();
  if (!name) return null;
  return products.find(product => product.name.trim() === name) ?? null;
}

export function useVerificationDetailDocs(
  record: SiteCalibration,
  passed?: {
    customer?: Customer | null;
    product?: Product | null;
  },
): {
  customer: Customer | null;
  product: Product | null;
} {
  const { products } = useAppContext();
  const listedProduct = useMemo(
    () => passed?.product ?? resolveProductForVerification(record, products),
    [passed?.product, products, record.productId, record.productName],
  );

  const [fetchedCustomer, setFetchedCustomer] = useState<Customer | null>(null);
  const [fetchedProduct, setFetchedProduct] = useState<Product | null>(null);

  useEffect(() => {
    if (passed?.customer) {
      setFetchedCustomer(null);
      return;
    }
    const customerId = record.customerId?.trim();
    if (!customerId) {
      setFetchedCustomer(null);
      return;
    }

    let cancelled = false;
    void getDoc(doc(db, 'customers', customerId))
      .then(snap => {
        if (cancelled) return;
        setFetchedCustomer(
          snap.exists() ? ({ id: snap.id, ...snap.data() } as Customer) : null,
        );
      })
      .catch(() => {
        if (!cancelled) setFetchedCustomer(null);
      });

    return () => {
      cancelled = true;
    };
  }, [passed?.customer, record.customerId]);

  useEffect(() => {
    if (listedProduct) {
      setFetchedProduct(null);
      return;
    }
    const productId = record.productId?.trim();
    if (!productId) {
      setFetchedProduct(null);
      return;
    }

    let cancelled = false;
    void getDoc(doc(db, 'products', productId))
      .then(snap => {
        if (cancelled) return;
        setFetchedProduct(
          snap.exists() ? ({ id: snap.id, ...snap.data() } as Product) : null,
        );
      })
      .catch(() => {
        if (!cancelled) setFetchedProduct(null);
      });

    return () => {
      cancelled = true;
    };
  }, [listedProduct, record.productId]);

  return {
    customer: passed?.customer ?? fetchedCustomer,
    product: listedProduct ?? fetchedProduct,
  };
}
