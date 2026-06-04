import type {
  CustomerLocation,
  FirestoreUserDoc,
  JobType,
  RcFeeTierAmounts,
  RcFeesStructure,
  VerificationLocation,
} from '../types';
import type { Product } from '../types';
import type { ProductFileMeta } from './productApprovalUpload';
import { isValidPincode, normalizePincode } from './contactFields';
import { resolveLaboratorySealIdentification } from './rcLaboratoryFields';
export {
  vctProfilePhotoFromUser as rcProfilePhotoFromUser,
  vctProfilePhotoFieldsFromMeta as rcProfilePhotoFieldsFromMeta,
} from './vctProfileFields';

export function parseRcLocation(input: {
  latitude?: string;
  longitude?: string;
}): CustomerLocation | undefined {
  const latStr = input.latitude?.trim() ?? '';
  const lngStr = input.longitude?.trim() ?? '';
  if (!latStr || !lngStr) return undefined;
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

export function rcProfileCoordsFromUser(doc: FirestoreUserDoc): { latitude: string; longitude: string } {
  return {
    latitude: doc.location?.lat != null ? String(doc.location.lat) : '',
    longitude: doc.location?.lng != null ? String(doc.location.lng) : '',
  };
}

export function formatRcLocation(doc: FirestoreUserDoc): string {
  if (!doc.location) return '—';
  return `${doc.location.lat.toFixed(5)}, ${doc.location.lng.toFixed(5)}`;
}

export function rcMapsUrl(doc: FirestoreUserDoc): string | null {
  if (!doc.location) return null;
  return `https://www.google.com/maps?q=${doc.location.lat},${doc.location.lng}`;
}

/** Certificate date + 1 year (YYYY-MM-DD). */
export const DEFAULT_RC_FEES_STRUCTURE: RcFeesStructure = {
  tierUpto20Kg: { inPremise: 750, inSitu: 850, self: 150 },
  tierUpto150Kg: { inPremise: 900, inSitu: 1000, self: 250 },
};

function mergeRcFeeTier(
  tier: Partial<RcFeeTierAmounts> | undefined,
  defaults: RcFeeTierAmounts,
): RcFeeTierAmounts {
  return {
    inPremise: tier?.inPremise ?? defaults.inPremise,
    inSitu: tier?.inSitu ?? defaults.inSitu,
    self: tier?.self ?? defaults.self,
  };
}

export function resolveRcFeesStructure(
  doc: Pick<FirestoreUserDoc, 'feesStructure'> | null | undefined,
): RcFeesStructure {
  const stored = doc?.feesStructure;
  if (!stored) return DEFAULT_RC_FEES_STRUCTURE;
  return {
    tierUpto20Kg: mergeRcFeeTier(stored.tierUpto20Kg, DEFAULT_RC_FEES_STRUCTURE.tierUpto20Kg),
    tierUpto150Kg: mergeRcFeeTier(stored.tierUpto150Kg, DEFAULT_RC_FEES_STRUCTURE.tierUpto150Kg),
  };
}

export function rcFeesDraftFromUser(doc: Pick<FirestoreUserDoc, 'feesStructure'> | null | undefined): RcFeesStructure {
  const fees = resolveRcFeesStructure(doc);
  return {
    tierUpto20Kg: { ...fees.tierUpto20Kg },
    tierUpto150Kg: { ...fees.tierUpto150Kg },
  };
}

export function formatRcFeeAmount(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

/** GST applied on top of quoted verification fees (e.g. RV ₹150 / ₹250 base). */
export const VERIFICATION_FEE_GST_RATE = 0.2;

export type VerificationFeeWithGst = {
  base: number;
  gst: number;
  total: number;
};

export function verificationFeeWithGst(baseAmount: number): VerificationFeeWithGst {
  const base = Math.round(baseAmount);
  const gst = Math.round(base * VERIFICATION_FEE_GST_RATE);
  return { base, gst, total: base + gst };
}

export function parseRcFeeAmountInput(value: string): number {
  const digits = value.replace(/\D/g, '');
  if (!digits) return 0;
  return Math.min(Number.parseInt(digits, 10), 999_999);
}

export function validateRcFeesStructure(fees: RcFeesStructure): string | null {
  const tiers = [fees.tierUpto20Kg, fees.tierUpto150Kg];
  for (const tier of tiers) {
    for (const amount of [tier.inPremise, tier.inSitu, tier.self]) {
      if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
        return 'Fee amounts must be whole numbers (0 or more).';
      }
    }
  }
  return null;
}

/** Maximum capacity normalized to kg for fee tier lookup. */
export function productMaximumCapacityKg(
  product: Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'> | null | undefined,
): number | null {
  if (!product || product.maximumCapacity == null || !Number.isFinite(product.maximumCapacity)) {
    return null;
  }
  if (product.unitOfMeasurement === 'g') {
    return product.maximumCapacity / 1000;
  }
  return product.maximumCapacity;
}

export function formatProductMaximumCapacity(
  product: Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'> | null | undefined,
): string {
  if (!product?.maximumCapacity || !Number.isFinite(product.maximumCapacity)) return '—';
  return `${product.maximumCapacity} ${product.unitOfMeasurement || 'kg'}`;
}

export type RcVerificationFeeQuote = {
  amount: number | null;
  tierLabel: string;
  capacityDisplay: string;
  incompleteReason?: string;
};

export function rcVerificationFeeQuote(
  fees: RcFeesStructure,
  location: VerificationLocation | '',
  product: Pick<Product, 'maximumCapacity' | 'unitOfMeasurement'> | null | undefined,
  subject: 'self' | 'customer' | '' = '',
  verificationType: JobType | '' = '',
): RcVerificationFeeQuote {
  const capacityKg = productMaximumCapacityKg(product);
  const capacityDisplay = formatProductMaximumCapacity(product);
  /** RV always uses self-tier fees (e.g. ₹150 / ₹250), regardless of party or location. */
  const useSelfFees = verificationType === 'RV' || subject === 'self';

  if (!useSelfFees && !location) {
    return {
      amount: null,
      tierLabel: '—',
      capacityDisplay,
      incompleteReason: 'Select location',
    };
  }

  if (capacityKg == null) {
    return {
      amount: null,
      tierLabel: '—',
      capacityDisplay,
      incompleteReason: 'Select product',
    };
  }

  const tierKey = capacityKg <= 20 ? 'tierUpto20Kg' : 'tierUpto150Kg';
  const tier = fees[tierKey];
  const amount = useSelfFees
    ? tier.self
    : location === 'in_situ'
      ? tier.inSitu
      : tier.inPremise;
  const tierLabel =
    tierKey === 'tierUpto20Kg' ? 'Up to 20 kg' : 'Above 20 kg up to 150 kg';

  return {
    amount,
    tierLabel,
    capacityDisplay,
  };
}

export function sumRcVerificationFees(quotes: Array<{ amount: number | null }>): number {
  return quotes.reduce((sum, quote) => sum + (quote.amount ?? 0), 0);
}

export function standardWeightsCertExpiryFromDate(certDate: string): string {
  if (!certDate.trim()) return '';
  const d = new Date(`${certDate.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export type RcFormValues = {
  companyName: string;
  contactPerson: string;
  place: string;
  pincode: string;
  address: string;
  aadhar: string;
  email: string;
  phone: string;
  gstNumber: string;
  password: string;
  standardWeightsCertNumber: string;
  standardWeightsCertDate: string;
};

export const EMPTY_RC_FORM: RcFormValues = {
  companyName: '',
  contactPerson: '',
  place: '',
  pincode: '',
  address: '',
  aadhar: '',
  email: '',
  phone: '',
  gstNumber: '',
  password: '',
  standardWeightsCertNumber: '',
  standardWeightsCertDate: '',
};

export function validateRcPincodeInput(pincode: string): string | null {
  const normalized = normalizePincode(pincode);
  if (normalized && !isValidPincode(normalized)) {
    return 'Postal code must be exactly 6 digits.';
  }
  return null;
}

export function rcFormFromUser(doc: FirestoreUserDoc): RcFormValues {
  return {
    companyName: doc.companyName || doc.username || '',
    contactPerson: doc.contactPerson || '',
    place: doc.place || '',
    pincode: doc.pincode || '',
    address: doc.address || '',
    aadhar: doc.aadhar || '',
    email: doc.email || '',
    phone: doc.phone || '',
    gstNumber: doc.gstNumber || '',
    password: '',
    standardWeightsCertNumber: doc.standardWeightsCertNumber || '',
    standardWeightsCertDate: doc.standardWeightsCertDate || '',
  };
}

export type RcFormUploads = {
  cert: ProductFileMeta | null;
  seal: ProductFileMeta | null;
};

function applyFileMeta(
  base: Partial<FirestoreUserDoc>,
  prefix: 'standardWeightsCert' | 'seal',
  file: ProductFileMeta | null,
  isCreate: boolean,
): void {
  const urlKey = `${prefix}Url` as keyof FirestoreUserDoc;
  const pathKey = `${prefix}Path` as keyof FirestoreUserDoc;
  const nameKey = `${prefix}Name` as keyof FirestoreUserDoc;
  const typeKey = `${prefix}ContentType` as keyof FirestoreUserDoc;

  if (file) {
    (base as Record<string, string>)[urlKey] = file.url;
    (base as Record<string, string>)[pathKey] = file.path;
    (base as Record<string, string>)[nameKey] = file.name;
    (base as Record<string, string>)[typeKey] = file.contentType;
  } else if (isCreate) {
    (base as Record<string, string>)[urlKey] = '';
    (base as Record<string, string>)[pathKey] = '';
    (base as Record<string, string>)[nameKey] = '';
    (base as Record<string, string>)[typeKey] = '';
  }
}

export function buildRcFirestoreFields(
  values: RcFormValues,
  uploads: RcFormUploads,
  options: { includePassword?: string; isCreate?: boolean },
): Partial<FirestoreUserDoc> {
  const expiry = standardWeightsCertExpiryFromDate(values.standardWeightsCertDate);
  const pincode = normalizePincode(values.pincode);
  const base: Partial<FirestoreUserDoc> = {
    companyName: values.companyName.trim(),
    username: values.companyName.trim(),
    contactPerson: values.contactPerson.trim(),
    place: values.place.trim(),
    pincode,
    address: values.address.trim(),
    gstNumber: values.gstNumber.trim(),
    email: values.email.trim(),
    phone: values.phone.replace(/\D/g, '').slice(0, 10),
    standardWeightsCertNumber: values.standardWeightsCertNumber.trim(),
    standardWeightsCertDate: values.standardWeightsCertDate,
    standardWeightsCertExpiry: expiry,
  };

  if (options.isCreate) {
    base.laboratorySealIdentification = resolveLaboratorySealIdentification(null);
    base.feesStructure = rcFeesDraftFromUser(null);
  }

  applyFileMeta(base, 'standardWeightsCert', uploads.cert, Boolean(options.isCreate));
  applyFileMeta(base, 'seal', uploads.seal, Boolean(options.isCreate));

  if (options.includePassword) {
    base.clearTextPassword = options.includePassword;
  }

  return base;
}
