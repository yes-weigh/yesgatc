import * as XLSX from 'xlsx';
import { buildDocaCertificateViewUrl } from './docaCertificateUrl';
import type { DocaCertificateRecord } from './docaScraping';
import { normalizeSerialKey } from './verificationResubmit';
import { fetchAllSiteCalibrations } from './verificationRecordsQuery';
import type { SiteCalibration } from '../types';

export type VerificationSerialExportRow = {
  Serial: string;
  Max: string;
  'Certificate PDF link': string;
};

function resolveVerificationCertificatePdfLink(record: SiteCalibration): string {
  const docaUrl = buildDocaCertificateViewUrl(record.certificateNumber);
  if (docaUrl) {
    return docaUrl;
  }

  return record.certificatePdfUrl?.trim() ?? '';
}

function resolveScrapeCertificatePdfLink(record: DocaCertificateRecord): string {
  const certificateNumber =
    record.pdfExtract?.certificateNumber?.trim()
    || record.gatcCertificateNo?.trim()
    || record.generateCertificate?.trim()
    || '';
  const docaUrl = buildDocaCertificateViewUrl(certificateNumber);
  if (docaUrl) {
    return docaUrl;
  }

  return record.certificatePdfUrl?.trim() ?? '';
}

function extractField(
  record: DocaCertificateRecord,
  key: Exclude<keyof NonNullable<DocaCertificateRecord['pdfExtract']>, 'parserVersion'>,
): string {
  const value = record.pdfExtract?.[key];
  return value == null ? '' : String(value);
}

function recordToExportRow(record: DocaCertificateRecord): Record<string, string> {
  return {
    Certificate: record.generateCertificate,
    'GATC Certificate No': record.gatcCertificateNo,
    Instrument: record.instrumentName,
    'Belongs To': record.belongTo,
    'Validity Date': record.validityDate,
    'Upload Date': record.uploadDate,
    'Scraped At': record.scrapedAt,
    'Machine Name': record.machineName,
    'PDF Download URL': record.certificatePdfUrl,
    'PDF Storage Path': record.certificatePdfPath,
    'DOCA Certificate Source URL': record.docaCertSourceUrl,
    'Instrument Photo URL': record.instrumentPhotoUrl,
    'Instrument Photo Path': record.instrumentPhotoPath,
    'DOCA Photo Source URL': record.docaPhotoSourceUrl,
    'Parse Status': extractField(record, 'parseStatus'),
    'Parse Error': extractField(record, 'parseError'),
    'Parsed At': extractField(record, 'parsedAt'),
    'Parser Version': String(record.pdfExtract?.parserVersion ?? ''),
    'Certificate Number (PDF)': extractField(record, 'certificateNumber'),
    'Serial Number': extractField(record, 'serialNumber'),
    'Max Capacity': extractField(record, 'maxCapacity'),
    'Min Capacity': extractField(record, 'minCapacity'),
    'Scale Interval (e)': extractField(record, 'verificationScaleIntervalE'),
    'Scale Interval (d)': extractField(record, 'actualScaleIntervalD'),
    'Unit of Measurement': extractField(record, 'unitOfMeasurement'),
    'Manufacturer / Model': extractField(record, 'manufacturerModel'),
    'Instrument Type': extractField(record, 'instrumentType'),
    'Year of Manufacture': extractField(record, 'yearOfManufacture'),
    'Accuracy Class': extractField(record, 'accuracyClass'),
    'Verification Intervals (n)': extractField(record, 'verificationIntervalsN'),
    'Maximum Permissible Error': extractField(record, 'maximumPermissibleError'),
    Owner: extractField(record, 'ownerName'),
    'Owner Address': extractField(record, 'ownerAddress'),
    'Owner Phone': extractField(record, 'ownerPhone'),
    'Verification Date': extractField(record, 'verificationDate'),
    'Next Verification Due': extractField(record, 'nextVerificationDue'),
    'Model Approval Nos': extractField(record, 'modelApprovalNos'),
    'Seal Identification Nos': extractField(record, 'sealIdentificationNos'),
  };
}

export function exportDocaCertificatesToExcel(
  records: DocaCertificateRecord[],
  filename?: string,
): void {
  if (records.length === 0) return;

  const rows = records.map(recordToExportRow);
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Certificates');

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, filename ?? `doca-certificates-${dateStamp}.xlsx`);
}

type MergedSerialRow = {
  serial: string;
  max: string;
  certificatePdfLink: string;
  sortTs: number;
};

function verificationTimestamp(record: SiteCalibration): number {
  const raw =
    record.certifiedAt ||
    record.updatedAt ||
    record.submittedAt ||
    record.createdAt ||
    '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatVerificationMax(record: SiteCalibration): string {
  if (record.maximumCapacity == null || !Number.isFinite(record.maximumCapacity)) {
    return '';
  }

  const unit = record.unitOfMeasurement?.trim() || 'kg';
  return `${record.maximumCapacity} ${unit}`;
}

function verificationToMergedRow(record: SiteCalibration): MergedSerialRow {
  return {
    serial: record.serialNumber.trim(),
    max: formatVerificationMax(record),
    certificatePdfLink: resolveVerificationCertificatePdfLink(record),
    sortTs: verificationTimestamp(record),
  };
}

function mergeMergedRows(primary: MergedSerialRow, secondary: MergedSerialRow): MergedSerialRow {
  return {
    serial: primary.serial || secondary.serial,
    max: primary.max || secondary.max,
    certificatePdfLink: primary.certificatePdfLink || secondary.certificatePdfLink,
    sortTs: Math.max(primary.sortTs, secondary.sortTs),
  };
}

function pickPreferredVerificationRow(
  existing: MergedSerialRow,
  candidate: MergedSerialRow,
): MergedSerialRow {
  const existingLink = Boolean(existing.certificatePdfLink);
  const candidateLink = Boolean(candidate.certificatePdfLink);
  if (candidateLink && !existingLink) {
    return mergeMergedRows(candidate, existing);
  }
  if (existingLink && !candidateLink) {
    return mergeMergedRows(existing, candidate);
  }

  return candidate.sortTs >= existing.sortTs
    ? mergeMergedRows(candidate, existing)
    : mergeMergedRows(existing, candidate);
}

export function buildMergedVerificationSerialRows(
  scrapeRecords: DocaCertificateRecord[],
  verifications: SiteCalibration[],
): VerificationSerialExportRow[] {
  const merged = new Map<string, MergedSerialRow>();

  for (const record of verifications) {
    const serialKey = normalizeSerialKey(record.serialNumber);
    if (!serialKey) {
      continue;
    }

    const candidate = verificationToMergedRow(record);
    const existing = merged.get(serialKey);
    merged.set(
      serialKey,
      existing ? pickPreferredVerificationRow(existing, candidate) : candidate,
    );
  }

  for (const record of scrapeRecords) {
    const serial = record.pdfExtract?.serialNumber?.trim() ?? '';
    const serialKey = normalizeSerialKey(serial);
    if (!serialKey) {
      continue;
    }

    const scrapeMax = record.pdfExtract?.maxCapacity?.trim() ?? '';
    const scrapePdfLink = resolveScrapeCertificatePdfLink(record);
    const existing = merged.get(serialKey);
    if (!existing) {
      merged.set(serialKey, {
        serial,
        max: scrapeMax,
        certificatePdfLink: scrapePdfLink,
        sortTs: 0,
      });
      continue;
    }

    merged.set(serialKey, mergeMergedRows(existing, {
      serial,
      max: scrapeMax,
      certificatePdfLink: scrapePdfLink,
      sortTs: 0,
    }));
  }

  return [...merged.values()]
    .map(row => ({
      Serial: row.serial,
      Max: row.max,
      'Certificate PDF link': row.certificatePdfLink,
    }))
    .sort((left, right) => left.Serial.localeCompare(right.Serial, undefined, { sensitivity: 'base' }));
}

export async function exportMergedVerificationsSerialExcel(
  scrapeRecords: DocaCertificateRecord[],
  filename?: string,
): Promise<number> {
  const verifications = await fetchAllSiteCalibrations();
  const rows = buildMergedVerificationSerialRows(scrapeRecords, verifications);
  if (rows.length === 0) {
    return 0;
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Verifications');

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, filename ?? `verifications-serial-export-${dateStamp}.xlsx`);
  return rows.length;
}
