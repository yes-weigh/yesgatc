import type { DocaCertificatePdfExtract } from './docaScraping';

export const GATC_CERTIFICATE_PARSER_VERSION = 4;

type InstrumentRowFields = {
  instrumentType: string;
  manufacturerModel: string;
  serialNumber: string;
  yearOfManufacture: string;
  accuracyClass: string;
  maxCapacity: string;
  minCapacity: string;
  verificationScaleIntervalE: string;
  unitOfMeasurement: string;
  actualScaleIntervalD: string;
  verificationIntervalsN: string;
  maximumPermissibleError: string;
};

const OWNER_BLOCK_REGEX =
  /belonging to\s+M\/s-([^,]+?)\s*,\s*Address[-:\s]*(.+?)\s*,\s*Ph:?[-\s]*([\d\s]+)/i;

const CERTIFICATE_NUMBER_REGEX = /Certificate No\.?\s*:?\s*(IND\/GATC\/[^\s]+)/i;

const VERIFICATION_DATE_REGEX =
  /Date of Verification\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/i;

const NEXT_VERIFICATION_REGEX =
  /Next verification falls due on or before\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})/i;

const INSTRUMENT_ROW_REGEX =
  /(?<!\bif\s)(?<![(\-])(Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z0-9-]+)\s+(20\d{2})\s+(I{1,3}|IV)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+\.?\d*\s*[a-zA-Z]+)/gi;

const INSTRUMENT_ROW_BEFORE_VISUAL_REGEX =
  /(?:MPE\)|Maximum Permissible Error \(MPE\))\s+(?<!\bif\s)(Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z0-9-]+)\s+(20\d{2})\s+(I{1,3}|IV)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+\.?\d*\s*g)(?=\s+Visual\b)/gi;

const INSTRUMENT_MODEL_SERIAL_REGEX =
  /(?<![\w(/])([A-Z][A-Z0-9]{2,})\s+([A-Z][A-Z0-9-]{3,})\s+(20\d{2})\s+(I{1,3}|IV)\s+(\d+\.?\d*\s*kg)\s+(\S+)\s+(\d+\.?\d*\s*g)\s+kg\s+(\S+)\s+(\d+)\s+(\d+\.?\d*)\s*g(?=\s+Visual\b)/g;

const MODEL_APPROVAL_REGEX =
  /Model Approval No\.?\s*:?\s*([^\r\n]+?)(?=\s*(?:Seal|Certificate|Date of|Verification Fee|$))/i;

const SEAL_IDENTIFICATION_REGEX =
  /Seal Identification No\.?\s*:?\s*([^\r\n]+?)(?=\s*(?:Certificate|Date of|Next verification|Model Approval|$))/i;

function failed(error: string): DocaCertificatePdfExtract {
  return {
    parseStatus: 'failed',
    parseError: error,
    parsedAt: new Date().toISOString(),
    parserVersion: GATC_CERTIFICATE_PARSER_VERSION,
    certificateNumber: '',
    verificationDate: '',
    ownerName: '',
    ownerAddress: '',
    ownerPhone: '',
    instrumentType: '',
    manufacturerModel: '',
    serialNumber: '',
    yearOfManufacture: '',
    accuracyClass: '',
    maxCapacity: '',
    minCapacity: '',
    verificationScaleIntervalE: '',
    actualScaleIntervalD: '',
    unitOfMeasurement: '',
    verificationIntervalsN: '',
    maximumPermissibleError: '',
    nextVerificationDue: '',
    modelApprovalNos: '',
    sealIdentificationNos: '',
  };
}

function cleanValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function cleanMassUnit(value: string): string {
  return cleanValue(value).replace(/(\d+\.?\d*)\s+([a-zA-Z]+)/g, '$1$2');
}

function cleanPhone(value: string): string {
  return value.replace(/[^\d]/g, '').trim();
}

function normalizeDate(value: string): string {
  const trimmed = value.trim();
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (dmy) {
    return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/Permissibl e/gi, 'Permissible')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlausibleInstrumentRow(fields: InstrumentRowFields): boolean {
  return (
    Boolean(fields.serialNumber.trim())
    && fields.yearOfManufacture.startsWith('20')
    && /kg/i.test(fields.maxCapacity)
    && /g/i.test(fields.verificationScaleIntervalE)
    && fields.manufacturerModel.toLowerCase() !== 'verification'
  );
}

function buildInstrumentRowFromTypedMatch(match: RegExpMatchArray): InstrumentRowFields | null {
  if (match.length < 13) return null;
  const fields: InstrumentRowFields = {
    instrumentType: cleanValue(match[1] ?? ''),
    manufacturerModel: cleanValue(match[2] ?? ''),
    serialNumber: cleanValue(match[3] ?? ''),
    yearOfManufacture: match[4] ?? '',
    accuracyClass: match[5] ?? '',
    maxCapacity: cleanMassUnit(match[6] ?? ''),
    minCapacity: cleanMassUnit(match[7] ?? ''),
    verificationScaleIntervalE: cleanMassUnit(match[8] ?? ''),
    unitOfMeasurement: cleanValue(match[9] ?? ''),
    actualScaleIntervalD: cleanMassUnit(match[10] ?? ''),
    verificationIntervalsN: match[11] ?? '',
    maximumPermissibleError: cleanMassUnit(match[12] ?? ''),
  };
  return isPlausibleInstrumentRow(fields) ? fields : null;
}

function tryParseInstrumentRow(text: string): InstrumentRowFields | null {
  for (const regex of [INSTRUMENT_ROW_BEFORE_VISUAL_REGEX, INSTRUMENT_ROW_REGEX]) {
    regex.lastIndex = 0;
    let match = regex.exec(text);
    while (match) {
      const fields = buildInstrumentRowFromTypedMatch(match);
      if (fields) return fields;
      match = regex.exec(text);
    }
  }

  INSTRUMENT_MODEL_SERIAL_REGEX.lastIndex = 0;
  const modelMatch = INSTRUMENT_MODEL_SERIAL_REGEX.exec(text);
  if (modelMatch) {
    const fields: InstrumentRowFields = {
      instrumentType: 'Electronic',
      manufacturerModel: cleanValue(modelMatch[1] ?? ''),
      serialNumber: cleanValue(modelMatch[2] ?? ''),
      yearOfManufacture: modelMatch[3] ?? '',
      accuracyClass: modelMatch[4] ?? '',
      maxCapacity: cleanMassUnit(modelMatch[5] ?? ''),
      minCapacity: cleanMassUnit(modelMatch[6] ?? ''),
      verificationScaleIntervalE: cleanMassUnit(modelMatch[7] ?? ''),
      unitOfMeasurement: cleanValue(modelMatch[8] ?? ''),
      actualScaleIntervalD: cleanMassUnit(modelMatch[9] ?? ''),
      verificationIntervalsN: modelMatch[10] ?? '',
      maximumPermissibleError: cleanMassUnit(`${modelMatch[11] ?? ''}g`),
    };
    if (isPlausibleInstrumentRow(fields)) return fields;
  }

  return null;
}

function isVerificationTestColumnLabel(token: string): boolean {
  const lower = token.toLowerCase();
  return lower === 'visual' || lower === 'pass' || lower === 'ambient' || lower === 'supply';
}

function tryParseInstrumentColumnLayout(rawText: string): InstrumentRowFields | null {
  const lines = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const start = lines.findIndex(line => /^(Electronic|Mechanical|Hybrid)\b/i.test(line));
  if (start < 0) return null;

  const tokens: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (i > start && /^Visual\b/i.test(line)) break;

    const parts = line.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;

    if (i > start && isVerificationTestColumnLabel(parts[0] ?? '')) break;

    tokens.push(parts[0] ?? '');
    if (tokens.length >= 12) break;
  }

  if (tokens.length < 8) return null;

  const fields: InstrumentRowFields = {
    instrumentType: cleanValue(tokens[0] ?? ''),
    manufacturerModel: cleanValue(tokens[1] ?? ''),
    serialNumber: cleanValue(tokens[2] ?? ''),
    yearOfManufacture: tokens[3] ?? '',
    accuracyClass: tokens[4] ?? '',
    maxCapacity: cleanMassUnit(tokens[5] ?? ''),
    minCapacity: tokens[6] ? cleanMassUnit(tokens[6]) : '',
    verificationScaleIntervalE: tokens[7] ? cleanMassUnit(tokens[7]) : '',
    unitOfMeasurement: tokens[8] ? cleanValue(tokens[8]) : '',
    actualScaleIntervalD: tokens[9] ? cleanMassUnit(tokens[9]) : '',
    verificationIntervalsN: tokens[10] ?? '',
    maximumPermissibleError: tokens[11] ? cleanMassUnit(tokens[11]) : '',
  };

  return isPlausibleInstrumentRow(fields) ? fields : null;
}

function tryParseInstrumentScattered(text: string): InstrumentRowFields | null {
  let instrumentType = 'Electronic';
  let model = 'YESWEIGH';
  let serial = '';

  const yesweighMatch = /\bYESWEIGH\s+([A-Z][A-Z0-9-]{4,})\b/.exec(text);
  if (yesweighMatch) {
    serial = yesweighMatch[1] ?? '';
  } else {
    const brandMatch = /\b(Electronic|Mechanical|Hybrid)\s+(\S+)\s+([A-Z][A-Z0-9-]{4,})\b/i.exec(text);
    if (!brandMatch) return null;
    instrumentType = brandMatch[1] ?? 'Electronic';
    model = brandMatch[2] ?? '';
    serial = brandMatch[3] ?? '';
  }

  const classMatch = /\b(20\d{2})\s+(I{1,3}|IV)\s+(\d+\.?\d*\s*kg)\b/i.exec(text);
  if (!classMatch) return null;

  const chainMatch =
    /\b(\d+\.?\d*\s*g)\s+(\d+\.?\d*\s*g)\s+kg\s+(\d+\.?\d*\s*g)\s+(\d+)\s+(\d+\.?\d*\s*g)\b/i.exec(text);

  const fields: InstrumentRowFields = {
    instrumentType: cleanValue(instrumentType),
    manufacturerModel: cleanValue(model),
    serialNumber: cleanValue(serial),
    yearOfManufacture: classMatch[1] ?? '',
    accuracyClass: classMatch[2] ?? '',
    maxCapacity: cleanMassUnit(classMatch[3] ?? ''),
    minCapacity: chainMatch ? cleanMassUnit(chainMatch[1] ?? '') : '',
    verificationScaleIntervalE: chainMatch ? cleanMassUnit(chainMatch[2] ?? '') : '',
    unitOfMeasurement: 'kg',
    actualScaleIntervalD: chainMatch ? cleanMassUnit(chainMatch[3] ?? '') : '',
    verificationIntervalsN: chainMatch ? (chainMatch[4] ?? '') : '',
    maximumPermissibleError: chainMatch ? cleanMassUnit(chainMatch[5] ?? '') : '',
  };

  return isPlausibleInstrumentRow(fields) ? fields : null;
}

function determineStatus(extract: DocaCertificatePdfExtract): {
  parseStatus: DocaCertificatePdfExtract['parseStatus'];
  parseError: string;
} {
  const hasSerial = Boolean(extract.serialNumber.trim());
  const hasCapacity = Boolean(extract.maxCapacity.trim());
  const hasOwner = Boolean(extract.ownerName.trim() || extract.ownerAddress.trim());
  const hasInterval = Boolean(extract.verificationScaleIntervalE.trim());

  if (hasSerial && hasCapacity && hasInterval) {
    return { parseStatus: 'ok', parseError: '' };
  }

  if (hasSerial || hasCapacity || hasOwner || Boolean(extract.certificateNumber.trim())) {
    return { parseStatus: 'partial', parseError: '' };
  }

  return {
    parseStatus: 'failed',
    parseError: 'Could not locate instrument or owner details in the PDF text.',
  };
}

function applyInstrumentFields(
  extract: DocaCertificatePdfExtract,
  fields: InstrumentRowFields,
): DocaCertificatePdfExtract {
  return {
    ...extract,
    instrumentType: fields.instrumentType,
    manufacturerModel: fields.manufacturerModel,
    serialNumber: fields.serialNumber,
    yearOfManufacture: fields.yearOfManufacture,
    accuracyClass: fields.accuracyClass,
    maxCapacity: fields.maxCapacity,
    minCapacity: fields.minCapacity,
    verificationScaleIntervalE: fields.verificationScaleIntervalE,
    unitOfMeasurement: fields.unitOfMeasurement,
    actualScaleIntervalD: fields.actualScaleIntervalD,
    verificationIntervalsN: fields.verificationIntervalsN,
    maximumPermissibleError: fields.maximumPermissibleError,
  };
}

export function parseGatcCertificatePdfText(rawText: string): DocaCertificatePdfExtract {
  const text = normalizeText(rawText);
  if (!text) {
    return failed('PDF contains no extractable text.');
  }

  let extract: DocaCertificatePdfExtract = {
    parseStatus: 'failed',
    parseError: '',
    parsedAt: new Date().toISOString(),
    parserVersion: GATC_CERTIFICATE_PARSER_VERSION,
    certificateNumber: '',
    verificationDate: '',
    ownerName: '',
    ownerAddress: '',
    ownerPhone: '',
    instrumentType: '',
    manufacturerModel: '',
    serialNumber: '',
    yearOfManufacture: '',
    accuracyClass: '',
    maxCapacity: '',
    minCapacity: '',
    verificationScaleIntervalE: '',
    actualScaleIntervalD: '',
    unitOfMeasurement: '',
    verificationIntervalsN: '',
    maximumPermissibleError: '',
    nextVerificationDue: '',
    modelApprovalNos: '',
    sealIdentificationNos: '',
  };

  const ownerMatch = OWNER_BLOCK_REGEX.exec(text);
  if (ownerMatch) {
    extract = {
      ...extract,
      ownerName: cleanValue(ownerMatch[1] ?? ''),
      ownerAddress: cleanValue(ownerMatch[2] ?? ''),
      ownerPhone: cleanPhone(ownerMatch[3] ?? ''),
    };
  }

  const certMatch = CERTIFICATE_NUMBER_REGEX.exec(text);
  if (certMatch) {
    extract = { ...extract, certificateNumber: cleanValue(certMatch[1] ?? '') };
  }

  const verificationMatch = VERIFICATION_DATE_REGEX.exec(text);
  if (verificationMatch) {
    extract = { ...extract, verificationDate: normalizeDate(verificationMatch[1] ?? '') };
  }

  const nextDueMatch = NEXT_VERIFICATION_REGEX.exec(text);
  if (nextDueMatch) {
    extract = { ...extract, nextVerificationDue: normalizeDate(nextDueMatch[1] ?? '') };
  }

  const instrument =
    tryParseInstrumentRow(text)
    ?? tryParseInstrumentColumnLayout(rawText)
    ?? tryParseInstrumentScattered(text);

  if (instrument) {
    extract = applyInstrumentFields(extract, instrument);
  }

  const modelApprovalMatch = MODEL_APPROVAL_REGEX.exec(text);
  if (modelApprovalMatch) {
    extract = { ...extract, modelApprovalNos: cleanValue(modelApprovalMatch[1] ?? '') };
  }

  const sealMatch = SEAL_IDENTIFICATION_REGEX.exec(text);
  if (sealMatch) {
    extract = { ...extract, sealIdentificationNos: cleanValue(sealMatch[1] ?? '') };
  }

  const status = determineStatus(extract);
  return { ...extract, parseStatus: status.parseStatus, parseError: status.parseError };
}
