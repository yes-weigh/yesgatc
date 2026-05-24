import type { Product, Role } from '../types';

/** Products created and managed by Super Admin (legacy docs without managedByRole are included). */
export function isAdminManagedProduct(product: Product): boolean {
  if (!product.managedByRole) return true;
  return product.managedByRole === 'super_admin';
}

export function filterAdminManagedProducts(products: Product[]): Product[] {
  return products.filter(isAdminManagedProduct);
}

export function adminProductMeta(managedByUid: string): Pick<Product, 'managedByRole' | 'managedByUid' | 'managedAt'> {
  return {
    managedByRole: 'super_admin' satisfies Role,
    managedByUid,
    managedAt: new Date().toISOString(),
  };
}
