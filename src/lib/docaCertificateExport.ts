import * as XLSX from 'xlsx';
import type { DocaCertificateRecord } from './docaScraping';

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
