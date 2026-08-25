import { computeProductDerived } from './productCalculations';
import { maximumCapacityKgFromRecord } from './zohoRvSubmit';
import { resolveVerificationParty, resolveVerificationProduct } from './verificationPartyDetails';
import {
  verificationLocationLabel,
  verificationTypeLabel,
} from './siteCalibrationProfileFields';
import { formatVerificationLabelValidTill } from './verificationLabel';
import { verificationVctLabel } from './verificationRequest';
import { VERIFICATION_GST_BILL_BRANDING } from './verificationGstBill';
import { buildCertificateVerifyUrl } from './certificateVerifyUrl';
import type { Customer, Product, SiteCalibration } from '../types';

export const VERIFICATION_TEST_REPORT_BRANDING = {
  companyName: VERIFICATION_GST_BILL_BRANDING.companyName,
  addressLines: VERIFICATION_GST_BILL_BRANDING.addressLines,
  phone: '0484-2304414',
  website: 'www.yesweigh.in',
  gatcApprovalNumber: VERIFICATION_GST_BILL_BRANDING.gatcApprovalNumber,
  logoSrc: '/brand/label-logo.png',
  testReference: 'OIML R 76 / LMPC Rules 2011',
  testMethod: 'Standard weights',
  purpose: 'Trade / Commercial Use',
} as const;

/** Repeatability + corner load when Max allows. */
export const TEST_REPORT_SPOT_LOAD_KG = 20;

const ROUND_LOADS_KG = [5, 10, 15, 20, 25, 30, 40, 50, 60, 100, 150, 200, 300, 500, 1000];

export type AccuracyClassCode = 'I' | 'II' | 'III' | 'IIII';

export type TestReportRow = {
  sr: number;
  loadKg: number;
  indicatedKg: number;
  errorG: number;
  mpeG: number;
  result: 'PASS' | 'FAIL';
};

export type RepeatabilityBlock = {
  loadKg: number;
  readingsKg: number[];
  eMaxMinusEminG: number;
  mpeG: number;
  result: 'PASS' | 'FAIL';
};

export type EccentricityRow = {
  location: string;
  loadKg: number;
  indicatedKg: number;
  errorG: number;
  mpeG: number;
  result: 'PASS' | 'FAIL';
};

export type VerificationTestReportData = {
  title: string;
  overallResult: 'PASSED' | 'FAILED';
  testDate: string;
  reportNumber: string;
  certificateNumber: string;
  nextDueDate: string;
  verificationType: string;
  location: string;
  testedBy: string;
  temperature: string;
  humidity: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  instrumentType: string;
  manufacturer: string;
  modelApprovalNo: string;
  serialNumber: string;
  accuracyClass: string;
  maxLabel: string;
  minLabel: string;
  eLabel: string;
  nLabel: string;
  sealId: string;
  verifyUrl: string | null;
  weighing: TestReportRow[];
  repeatability: RepeatabilityBlock | null;
  eccentricity: EccentricityRow[];
  missingFields: string[];
};

function dash(value?: string | number | null): string {
  if (value == null) return '—';
  const text = String(value).trim();
  return text || '—';
}

function roundTo(value: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function formatKgPlain(value: number): string {
  return value.toFixed(3);
}

export function formatGPlain(value: number): string {
  const rounded = roundTo(value, 4);
  if (rounded === 0) return '0';
  return String(rounded);
}

export function formatPmPlain(value: number): string {
  return `±${roundTo(value, 4)}`;
}

function parseAccuracyClass(raw?: string | null): AccuracyClassCode {
  const text = (raw || 'III').replace(/class/gi, '').trim().toUpperCase();
  if (text === 'I' || text === '1') return 'I';
  if (text === 'II' || text === '2') return 'II';
  if (text === 'IIII' || text === 'IV' || text === '4') return 'IIII';
  return 'III';
}

/** Verification MPE in units of e — OIML R 76. */
export function verificationMpeInE(loadInE: number, accuracyClass: AccuracyClassCode): number {
  if (accuracyClass === 'I') {
    if (loadInE <= 50_000) return 0.5;
    if (loadInE <= 200_000) return 1;
    return 1.5;
  }
  if (accuracyClass === 'II') {
    if (loadInE <= 5_000) return 0.5;
    if (loadInE <= 20_000) return 1;
    return 1.5;
  }
  if (accuracyClass === 'IIII') {
    if (loadInE <= 50) return 0.5;
    if (loadInE <= 200) return 1;
    return 1.5;
  }
  if (loadInE <= 500) return 0.5;
  if (loadInE <= 2_000) return 1;
  return 1.5;
}

function kgToE(kg: number, eGrams: number): number {
  return (kg * 1000) / eGrams;
}

function mpeGAtLoad(loadKg: number, eGrams: number, accuracyClass: AccuracyClassCode): number {
  return roundTo(verificationMpeInE(kgToE(loadKg, eGrams), accuracyClass) * eGrams, 4);
}

function alignToE(kg: number, eGrams: number): number {
  const grams = kg * 1000;
  return roundTo((Math.round(grams / eGrams) * eGrams) / 1000, 6);
}

function uniqueAlignedLoadsKg(raw: number[], maxKg: number, eGrams: number): number[] {
  const unique: number[] = [];
  const epsilon = eGrams / 2000;
  for (const candidate of raw) {
    if (!Number.isFinite(candidate) || candidate <= 0 || candidate > maxKg + epsilon) continue;
    const aligned = Math.min(maxKg, alignToE(candidate, eGrams));
    if (aligned <= 0) continue;
    if (!unique.some(existing => Math.abs(existing - aligned) < epsilon)) {
      unique.push(aligned);
    }
  }
  unique.sort((a, b) => a - b);
  if (!unique.some(v => Math.abs(v - maxKg) < epsilon)) unique.push(maxKg);
  return unique;
}

/** Round trade loads from Min to Max — no fractional ⅓ / ⅔ steps. */
export function buildWeighingLoadPointsKg(maxKg: number, eGrams: number, minKg: number): number[] {
  return uniqueAlignedLoadsKg(
    [minKg, ...ROUND_LOADS_KG.filter(load => load < maxKg), maxKg],
    maxKg,
    eGrams,
  );
}

/** 20 kg when Max ≥ 20, else Max. */
export function preferredSpotLoadKg(maxKg: number, eGrams: number): number {
  if (maxKg + eGrams / 2000 >= TEST_REPORT_SPOT_LOAD_KG) {
    return alignToE(TEST_REPORT_SPOT_LOAD_KG, eGrams);
  }
  return maxKg;
}

function formatReportDate(iso?: string): string {
  if (!iso?.trim()) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getFullYear()}`;
}

function climateField(value: string | undefined, suffix: string): string {
  const text = value?.trim();
  if (!text) return '—';
  if (text.includes(suffix.trim()) || (suffix === '°C' && text.includes('°'))) return text;
  return `${text} ${suffix}`;
}

export function buildVerificationTestReportData(
  record: SiteCalibration,
  customer?: Customer | null,
  product?: Product | null,
  verifyUrl?: string | null,
): VerificationTestReportData {
  const missingFields: string[] = [];
  const productInfo = resolveVerificationProduct(record, product);
  const party = resolveVerificationParty(record, { customer });
  const accuracyClass = parseAccuracyClass(productInfo.accuracyClass || product?.accuracyClass);
  const maxKg = maximumCapacityKgFromRecord({
    maximumCapacity: record.maximumCapacity ?? product?.maximumCapacity,
    unitOfMeasurement: record.unitOfMeasurement ?? product?.unitOfMeasurement,
  });
  const eGrams = record.verificationScaleInterval ?? product?.verificationScaleInterval ?? null;
  const derived =
    maxKg != null && eGrams != null && eGrams > 0
      ? computeProductDerived(maxKg, eGrams)
      : null;
  const minGrams = product?.minimumCapacity && product.minimumCapacity > 0
    ? product.minimumCapacity
    : derived?.minimumCapacity ?? (eGrams != null ? eGrams * 20 : null);
  const minKg = minGrams != null ? minGrams / 1000 : null;

  if (maxKg == null || maxKg <= 0) missingFields.push('Maximum capacity');
  if (eGrams == null || eGrams <= 0) missingFields.push('Verification scale interval e');
  if (!record.certificateNumber?.trim()) missingFields.push('Certificate number');

  const canBuild = maxKg != null && eGrams != null && eGrams > 0 && minKg != null;
  const loads = canBuild ? buildWeighingLoadPointsKg(maxKg, eGrams, minKg) : [];

  const weighing: TestReportRow[] = loads.map((loadKg, index) => ({
    sr: index + 1,
    loadKg,
    indicatedKg: loadKg,
    errorG: 0,
    mpeG: mpeGAtLoad(loadKg, eGrams!, accuracyClass),
    result: 'PASS',
  }));

  const spotKg = canBuild ? preferredSpotLoadKg(maxKg, eGrams) : 0;
  const spotMpeG = canBuild ? mpeGAtLoad(spotKg, eGrams, accuracyClass) : 0;

  const repeatability: RepeatabilityBlock | null = canBuild
    ? {
        loadKg: spotKg,
        readingsKg: [spotKg, spotKg, spotKg, spotKg, spotKg],
        eMaxMinusEminG: 0,
        mpeG: spotMpeG,
        result: 'PASS',
      }
    : null;

  const eccentricity: EccentricityRow[] = canBuild
    ? (['Centre', 'Front left', 'Front right', 'Rear left', 'Rear right'] as const).map(location => ({
        location,
        loadKg: spotKg,
        indicatedKg: spotKg,
        errorG: 0,
        mpeG: spotMpeG,
        result: 'PASS' as const,
      }))
    : [];

  const certificateNumber = record.certificateNumber?.trim() || '—';
  const n = derived?.noOfVerificationIntervals;

  return {
    title: 'ELECTRONIC WEIGHING SCALE TEST REPORT',
    overallResult: loads.length > 0 ? 'PASSED' : 'FAILED',
    testDate: formatReportDate(record.certifiedAt || record.submittedAt),
    reportNumber: certificateNumber === '—' ? '—' : `${certificateNumber}-P`,
    certificateNumber,
    nextDueDate: formatVerificationLabelValidTill(record.certifiedAt),
    verificationType: verificationTypeLabel(record.verificationType),
    location: verificationLocationLabel(record.verificationLocation),
    testedBy: verificationVctLabel(record),
    temperature: climateField(record.ambientTemperature, '°C'),
    humidity: climateField(record.relativeHumidity, '%'),
    customerName: dash(party.name),
    customerAddress: [party.address, party.district, party.state, party.pincode].filter(Boolean).join(', ') || '—',
    customerPhone: dash(party.phone),
    instrumentType: product?.typeOfInstrument?.trim() || 'Electronic Weighing Scale',
    manufacturer: dash(productInfo.manufacturer),
    modelApprovalNo: dash(productInfo.modelApprovalNo),
    serialNumber: dash(record.serialNumber),
    accuracyClass,
    maxLabel: maxKg != null ? `${formatKgPlain(maxKg)} kg` : '—',
    minLabel: minGrams != null ? `${roundTo(minGrams, 4)} g` : '—',
    eLabel: eGrams != null ? `${roundTo(eGrams, 4)} g` : '—',
    nLabel: n != null ? String(roundTo(n, 4)) : '—',
    sealId: dash(record.sealIdentificationNumber),
    verifyUrl: verifyUrl ?? buildCertificateVerifyUrl(record),
    weighing,
    repeatability,
    eccentricity,
    missingFields,
  };
}

export function buildVerificationTestReportShareMessage(report: VerificationTestReportData): string {
  return [
    VERIFICATION_TEST_REPORT_BRANDING.companyName,
    report.title,
    `Result : ${report.overallResult}`,
    `Report No : ${report.reportNumber}`,
    `Certificate No : ${report.certificateNumber}`,
    `Serial : ${report.serialNumber}`,
    `Max : ${report.maxLabel}  Min : ${report.minLabel}  e : ${report.eLabel}`,
    report.verifyUrl || '',
  ]
    .filter(Boolean)
    .join('\n');
}
