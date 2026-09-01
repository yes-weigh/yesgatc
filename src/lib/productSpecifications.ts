import type { Product, ProductSpecification, SiteCalibration } from '../types';
import { computeProductDerived } from './productCalculations';

function formatRounded(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

export function isProductActive(product: Product | null | undefined): boolean {
  return product?.active !== false;
}

export function newSpecificationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `spec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortSpecsByCapacity(specs: ProductSpecification[]): ProductSpecification[] {
  return [...specs].sort((a, b) => {
    const maxDiff = (a.maximumCapacity || 0) - (b.maximumCapacity || 0);
    if (maxDiff !== 0) return maxDiff;
    return (a.verificationScaleInterval || 0) - (b.verificationScaleInterval || 0);
  });
}

/** All specs for a product — falls back to legacy top-level capacity fields. Smallest Max first. */
export function getProductSpecifications(product: Product): ProductSpecification[] {
  if (product.specifications && product.specifications.length > 0) {
    return sortSpecsByCapacity(product.specifications);
  }
  return [
    {
      id: 'primary',
      maximumCapacity: product.maximumCapacity,
      minimumCapacity: product.minimumCapacity,
      verificationScaleInterval: product.verificationScaleInterval,
      actualScaleInterval: product.actualScaleInterval,
      noOfVerificationIntervals: product.noOfVerificationIntervals,
      maximumPermissibleError: product.maximumPermissibleError,
    },
  ];
}

export function resolveProductSpecification(
  product: Product,
  specificationId?: string | null,
): ProductSpecification {
  const specs = getProductSpecifications(product);
  if (specificationId) {
    const match = specs.find(spec => spec.id === specificationId);
    if (match) return match;
  }
  return specs[0];
}

export function formatSpecificationCapacitySpecs(
  spec: Pick<
    ProductSpecification,
    'maximumCapacity' | 'verificationScaleInterval' | 'minimumCapacity'
  >,
  unit: 'kg' | 'g' = 'kg',
): string {
  const parts: string[] = [];
  if (spec.maximumCapacity) parts.push(`Max ${spec.maximumCapacity} ${unit}`);
  if (spec.verificationScaleInterval) {
    parts.push(`e ${formatRounded(spec.verificationScaleInterval)} g`);
  }
  if (spec.minimumCapacity) {
    parts.push(`Min ${formatRounded(spec.minimumCapacity)} g`);
  }
  return parts.join(' · ');
}

/** Shop card left stack — Max + e per capacity row, e.g. "10 kg 1 g". */
export function formatShopCapacityLine(
  spec: Pick<ProductSpecification, 'maximumCapacity' | 'verificationScaleInterval'>,
  unit: 'kg' | 'g' = 'kg',
): string {
  const max = Number.isFinite(spec.maximumCapacity) ? String(spec.maximumCapacity) : '';
  const e = Number.isFinite(spec.verificationScaleInterval)
    ? formatRounded(spec.verificationScaleInterval)
    : '';
  if (max && e) return `${max} ${unit} ${e} g`;
  if (max) return `${max} ${unit}`;
  if (e) return `${e} g`;
  return '';
}

export function formatShopCapacityLines(product: Product): string[] {
  const unit = product.unitOfMeasurement || 'kg';
  return getProductSpecifications(product)
    .map(spec => formatShopCapacityLine(spec, unit))
    .filter(Boolean);
}

export function productHasMultipleSpecifications(product: Product): boolean {
  return getProductSpecifications(product).length > 1;
}

export type SpecFormRow = {
  localId: string;
  maximumCapacity: string;
  verificationScaleInterval: string;
  maximumPermissibleError: string;
};

export function emptySpecFormRow(): SpecFormRow {
  return {
    localId: newSpecificationId(),
    maximumCapacity: '',
    verificationScaleInterval: '',
    maximumPermissibleError: '',
  };
}

export function specFormRowsFromProduct(product: Product): SpecFormRow[] {
  return getProductSpecifications(product).map(spec => ({
    localId: spec.id || newSpecificationId(),
    maximumCapacity:
      spec.maximumCapacity !== undefined && spec.maximumCapacity !== null
        ? String(spec.maximumCapacity)
        : '',
    verificationScaleInterval:
      spec.verificationScaleInterval !== undefined && spec.verificationScaleInterval !== null
        ? String(spec.verificationScaleInterval)
        : '',
    maximumPermissibleError:
      spec.maximumPermissibleError !== undefined && spec.maximumPermissibleError !== null
        ? String(spec.maximumPermissibleError)
        : '',
  }));
}

export function buildSpecificationsFromFormRows(
  rows: SpecFormRow[],
): { specifications: ProductSpecification[]; primary: ProductSpecification } | null {
  const built: ProductSpecification[] = [];
  for (const row of rows) {
    const max = Number(row.maximumCapacity);
    const e = Number(row.verificationScaleInterval);
    if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(e) || e <= 0) {
      return null;
    }
    const derived = computeProductDerived(max, e);
    built.push({
      id: row.localId || newSpecificationId(),
      maximumCapacity: max,
      verificationScaleInterval: e,
      minimumCapacity: derived.minimumCapacity,
      actualScaleInterval: derived.actualScaleInterval,
      noOfVerificationIntervals: derived.noOfVerificationIntervals,
      maximumPermissibleError: Number(row.maximumPermissibleError) || 0,
    });
  }
  if (built.length === 0) return null;
  return { specifications: built, primary: built[0] };
}

/** Apply selected product + spec onto capacity snapshot fields. */
export function capacityFieldsFromProductSpec(
  product: Product,
  specificationId?: string | null,
): Pick<
  Product,
  | 'maximumCapacity'
  | 'minimumCapacity'
  | 'verificationScaleInterval'
  | 'actualScaleInterval'
  | 'noOfVerificationIntervals'
  | 'maximumPermissibleError'
  | 'unitOfMeasurement'
> {
  const spec = resolveProductSpecification(product, specificationId);
  return {
    maximumCapacity: spec.maximumCapacity,
    minimumCapacity: spec.minimumCapacity,
    verificationScaleInterval: spec.verificationScaleInterval,
    actualScaleInterval: spec.actualScaleInterval,
    noOfVerificationIntervals: spec.noOfVerificationIntervals,
    maximumPermissibleError: spec.maximumPermissibleError,
    unitOfMeasurement: product.unitOfMeasurement || 'kg',
  };
}

/** Overlay selected spec (and optional MPE) onto a product for display / fees. */
export function productWithDeviceSpecification(
  product: Product,
  specificationId?: string | null,
  mpeOverride?: number | null,
): Product {
  const capacity = capacityFieldsFromProductSpec(product, specificationId);
  const mpe =
    mpeOverride != null && Number.isFinite(mpeOverride) && mpeOverride > 0
      ? mpeOverride
      : capacity.maximumPermissibleError;
  return {
    ...product,
    ...capacity,
    maximumPermissibleError: mpe,
  };
}

function firstPositive(...values: Array<number | null | undefined>): number | undefined {
  for (const value of values) {
    if (value != null && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

/** Submitted snapshot first, then selected spec, then product primary. Derive Min/d/n from Max+e. */
export function capacityFieldsFromRecordOrProduct(
  record: Pick<
    SiteCalibration,
    | 'maximumCapacity'
    | 'minimumCapacity'
    | 'verificationScaleInterval'
    | 'actualScaleInterval'
    | 'noOfVerificationIntervals'
    | 'maximumPermissibleError'
    | 'unitOfMeasurement'
    | 'productSpecificationId'
  >,
  product?: Product | null,
): Pick<
  Product,
  | 'maximumCapacity'
  | 'minimumCapacity'
  | 'verificationScaleInterval'
  | 'actualScaleInterval'
  | 'noOfVerificationIntervals'
  | 'maximumPermissibleError'
  | 'unitOfMeasurement'
> {
  const specId = record.productSpecificationId?.trim();
  const specMatch = product && specId
    ? getProductSpecifications(product).find(spec => spec.id === specId)
    : undefined;
  const fromSpec = specMatch && product ? capacityFieldsFromProductSpec(product, specId) : null;
  const fromPrimary = product && !specId
    ? {
        maximumCapacity: product.maximumCapacity,
        minimumCapacity: product.minimumCapacity,
        verificationScaleInterval: product.verificationScaleInterval,
        actualScaleInterval: product.actualScaleInterval,
        noOfVerificationIntervals: product.noOfVerificationIntervals,
        maximumPermissibleError: product.maximumPermissibleError,
        unitOfMeasurement: product.unitOfMeasurement || 'kg',
      }
    : null;
  const max = firstPositive(record.maximumCapacity, fromSpec?.maximumCapacity, fromPrimary?.maximumCapacity);
  const e = firstPositive(
    record.verificationScaleInterval,
    fromSpec?.verificationScaleInterval,
    fromPrimary?.verificationScaleInterval,
  );
  const derived = max != null && e != null ? computeProductDerived(max, e) : null;
  return {
    maximumCapacity: max ?? 0,
    minimumCapacity:
      firstPositive(
        record.minimumCapacity,
        fromSpec?.minimumCapacity,
        derived?.minimumCapacity,
        fromPrimary?.minimumCapacity,
      ) ?? 0,
    verificationScaleInterval: e ?? 0,
    actualScaleInterval:
      firstPositive(
        record.actualScaleInterval,
        fromSpec?.actualScaleInterval,
        derived?.actualScaleInterval,
        fromPrimary?.actualScaleInterval,
      ) ?? 0,
    noOfVerificationIntervals:
      firstPositive(
        record.noOfVerificationIntervals,
        fromSpec?.noOfVerificationIntervals,
        derived?.noOfVerificationIntervals,
        fromPrimary?.noOfVerificationIntervals,
      ) ?? 0,
    maximumPermissibleError:
      firstPositive(record.maximumPermissibleError, fromSpec?.maximumPermissibleError, fromPrimary?.maximumPermissibleError) ?? 0,
    unitOfMeasurement: record.unitOfMeasurement || fromSpec?.unitOfMeasurement || fromPrimary?.unitOfMeasurement || 'kg',
  };
}

