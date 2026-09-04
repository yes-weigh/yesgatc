import type { Product, Role } from '../types';
import { getProductSpecifications, newSpecificationId } from './productSpecifications';

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

export function modelIdKey(modelid: string | undefined | null): string {
  return (modelid || '').trim().toLowerCase();
}

/** Other catalogue rows with the same Model ID (trim + case-insensitive). */
export function productsWithModelId(
  products: Product[],
  modelid: string,
  excludeId?: string | null,
): Product[] {
  const key = modelIdKey(modelid);
  if (!key) return [];
  return products.filter(p => modelIdKey(p.modelid) === key && p.id !== (excludeId ?? ''));
}

export function groupDuplicateModelIds(products: Product[]): Array<{
  modelid: string;
  items: Product[];
}> {
  const map = new Map<string, Product[]>();
  for (const product of products) {
    const key = modelIdKey(product.modelid);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(product);
    else map.set(key, [product]);
  }
  return [...map.values()]
    .filter(items => items.length > 1)
    .map(items => ({ modelid: (items[0].modelid || '').trim(), items }));
}

export function suggestedCloneIds(source: Product): { modelid: string; modelNo: string } {
  const name = (source.name || '').trim();
  const approval = (source.modelApprovalNo || '').trim();
  if (name === 'ATM PC' || approval === 'IND/09/20/23') {
    return { modelid: 'ATM30', modelNo: 'YSP-30' };
  }
  return { modelid: '', modelNo: source.modelNo || '' };
}

/** Copy a catalogue product with a new Model ID / Model No. Shares image and approval files. */
export function buildClonedProduct(
  source: Product,
  modelid: string,
  modelNo: string,
  sortOrder: number,
  managedByUid?: string,
): Omit<Product, 'id'> {
  const specifications = getProductSpecifications(source).map(spec => ({
    id: newSpecificationId(),
    maximumCapacity: spec.maximumCapacity,
    minimumCapacity: spec.minimumCapacity,
    verificationScaleInterval: spec.verificationScaleInterval,
    actualScaleInterval: spec.actualScaleInterval,
    noOfVerificationIntervals: spec.noOfVerificationIntervals,
    maximumPermissibleError: spec.maximumPermissibleError,
  }));
  const primary = specifications[0];
  return {
    modelid: modelid.trim(),
    modelNo: modelNo.trim(),
    yesoneSku: source.yesoneSku || '',
    pasPreAllotted: Boolean(source.pasPreAllotted),
    name: source.name || '',
    typeOfInstrument: source.typeOfInstrument || 'Electronic',
    manufacturerBrandSeries: source.manufacturerBrandSeries || 'YESWEIGH',
    accuracyClass: source.accuracyClass || 'III',
    maximumCapacity: primary?.maximumCapacity ?? source.maximumCapacity,
    minimumCapacity: primary?.minimumCapacity ?? source.minimumCapacity,
    verificationScaleInterval:
      primary?.verificationScaleInterval ?? source.verificationScaleInterval,
    actualScaleInterval: primary?.actualScaleInterval ?? source.actualScaleInterval,
    noOfVerificationIntervals:
      primary?.noOfVerificationIntervals ?? source.noOfVerificationIntervals,
    maximumPermissibleError: primary?.maximumPermissibleError ?? source.maximumPermissibleError,
    specifications,
    unitOfMeasurement: source.unitOfMeasurement || 'kg',
    active: source.active !== false,
    supplyVoltage: source.supplyVoltage || '230 V AC',
    modelApprovalNo: source.modelApprovalNo || '',
    modelApprovalDocUrl: source.modelApprovalDocUrl || '',
    modelApprovalDocPath: source.modelApprovalDocPath || '',
    modelApprovalDocName: source.modelApprovalDocName || '',
    modelApprovalDocContentType: source.modelApprovalDocContentType || '',
    productImageUrl: source.productImageUrl || '',
    productImagePath: source.productImagePath || '',
    productImageName: source.productImageName || '',
    productImageContentType: source.productImageContentType || '',
    sortOrder,
    ...(managedByUid ? adminProductMeta(managedByUid) : {}),
  };
}
