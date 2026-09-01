import type { Product } from '../types';
import {
  formatShopCapacityLine,
  getProductSpecifications,
  isProductActive,
} from './productSpecifications';

export type ProductStatusFilter = 'active' | 'inactive' | 'all';
export type ProductApprovalLayout = 'list' | 'group';

export type ProductListFilterState = {
  modelApproval: string;
  approvalLayout: ProductApprovalLayout;
  /** Encoded as `${max}|${e}` or `all`. */
  spec: string;
  modelNo: string;
  status: ProductStatusFilter;
};

export const DEFAULT_PRODUCT_LIST_FILTERS: ProductListFilterState = {
  modelApproval: 'all',
  approvalLayout: 'list',
  spec: 'all',
  modelNo: 'all',
  status: 'active',
};

export function isProductListFilterActive(filters: ProductListFilterState): boolean {
  return (
    filters.modelApproval !== 'all' ||
    filters.approvalLayout !== 'list' ||
    filters.spec !== 'all' ||
    filters.modelNo !== 'all' ||
    filters.status !== 'active'
  );
}

function uniqueSortedStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map(v => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

export function productModelApprovalOptions(products: Product[]): string[] {
  return uniqueSortedStrings(products.map(p => p.modelApprovalNo || ''));
}

export function productModelNoOptions(products: Product[]): string[] {
  return uniqueSortedStrings(products.map(p => p.modelNo || ''));
}

export type ProductSpecFilterOption = {
  value: string;
  label: string;
};

function encodeSpecKey(max: number, e: number): string {
  return `${max}|${e}`;
}

export function productSpecOptions(products: Product[]): ProductSpecFilterOption[] {
  const map = new Map<string, string>();
  for (const product of products) {
    const unit = product.unitOfMeasurement || 'kg';
    for (const spec of getProductSpecifications(product)) {
      if (!Number.isFinite(spec.maximumCapacity) || !Number.isFinite(spec.verificationScaleInterval)) {
        continue;
      }
      const value = encodeSpecKey(spec.maximumCapacity, spec.verificationScaleInterval);
      if (!map.has(value)) {
        map.set(value, formatShopCapacityLine(spec, unit));
      }
    }
  }
  return [...map.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function productMatchesSpec(product: Product, specKey: string): boolean {
  if (specKey === 'all') return true;
  const [maxRaw, eRaw] = specKey.split('|');
  const max = Number(maxRaw);
  const e = Number(eRaw);
  if (!Number.isFinite(max) || !Number.isFinite(e)) return true;
  return getProductSpecifications(product).some(
    spec => spec.maximumCapacity === max && spec.verificationScaleInterval === e,
  );
}

export function filterProductsForList(
  products: Product[],
  filters: ProductListFilterState,
): Product[] {
  return products.filter(product => {
    if (filters.status === 'active' && !isProductActive(product)) return false;
    if (filters.status === 'inactive' && isProductActive(product)) return false;

    if (filters.modelApproval !== 'all') {
      const approval = (product.modelApprovalNo || '').trim();
      if (approval !== filters.modelApproval) return false;
    }

    if (filters.modelNo !== 'all') {
      const modelNo = (product.modelNo || '').trim();
      if (modelNo !== filters.modelNo) return false;
    }

    if (!productMatchesSpec(product, filters.spec)) return false;

    return true;
  });
}

export function groupProductsByModelApproval(products: Product[]): {
  key: string;
  label: string;
  products: Product[];
}[] {
  const map = new Map<string, Product[]>();
  for (const product of products) {
    const key = (product.modelApprovalNo || '').trim() || '__none__';
    const list = map.get(key);
    if (list) list.push(product);
    else map.set(key, [product]);
  }
  return [...map.entries()]
    .map(([key, groupProducts]) => ({
      key,
      label: key === '__none__' ? 'No approval no' : key,
      products: groupProducts,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Reorder full id list by moving within the currently visible subset. */
export function reorderIdsWithinVisible(
  allIds: string[],
  visibleIds: string[],
  fromId: string,
  toId: string,
): string[] | null {
  const visibleSet = new Set(visibleIds);
  const visible = allIds.filter(id => visibleSet.has(id));
  const from = visible.indexOf(fromId);
  const to = visible.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return null;
  const nextVisible = [...visible];
  const [moved] = nextVisible.splice(from, 1);
  nextVisible.splice(to, 0, moved);
  let vi = 0;
  return allIds.map(id => (visibleSet.has(id) ? nextVisible[vi++]! : id));
}
