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

/** Stable catalogue order for OV/RV + product lists. */
export function sortProductsByDisplayOrder(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const ao = a.sortOrder;
    const bo = b.sortOrder;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    const byName = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
    if (byName) return byName;
    return a.id.localeCompare(b.id);
  });
}

export function nextProductSortOrder(products: Product[]): number {
  let max = -1;
  for (const product of products) {
    if (typeof product.sortOrder === 'number' && Number.isFinite(product.sortOrder)) {
      max = Math.max(max, product.sortOrder);
    }
  }
  return max + 1;
}
