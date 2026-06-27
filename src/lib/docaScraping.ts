import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  AUTOMATION_WORKER_COLLECTION,
  readInt,
  readString,
  saveAutomationWorkerRemoteControl,
  subscribeAutomationWorkerRemote,
  type AutomationWorkerRemoteControl,
} from './automationWorker';
import { normalizeCertificateMatchKey } from './docaCertificateMatch';

export const DOCA_CERTIFICATES_COLLECTION = 'docaCertificates';
export const DOCA_SCRAPE_STATUS_DOC = 'scrape';
export const DOCA_ENRICH_STATUS_DOC = 'enrich';

export type DocaCertificatePdfExtract = {
  parseStatus: 'ok' | 'partial' | 'failed' | '';
  parseError: string;
  parsedAt: string;
  parserVersion: number;
  certificateNumber: string;
  verificationDate: string;
  ownerName: string;
  ownerAddress: string;
  ownerPhone: string;
  instrumentType: string;
  manufacturerModel: string;
  serialNumber: string;
  yearOfManufacture: string;
  accuracyClass: string;
  maxCapacity: string;
  minCapacity: string;
  verificationScaleIntervalE: string;
  actualScaleIntervalD: string;
  unitOfMeasurement: string;
  verificationIntervalsN: string;
  maximumPermissibleError: string;
  nextVerificationDue: string;
  modelApprovalNos: string;
  sealIdentificationNos: string;
};

export type DocaCertificateRecord = {
  id: string;
  generateCertificate: string;
  gatcCertificateNo: string;
  instrumentName: string;
  belongTo: string;
  validityDate: string;
  uploadDate: string;
  certificatePdfUrl: string;
  certificatePdfPath: string;
  instrumentPhotoUrl: string;
  instrumentPhotoPath: string;
  docaCertSourceUrl: string;
  docaPhotoSourceUrl: string;
  scrapedAt: string;
  machineName: string;
  pdfExtract: DocaCertificatePdfExtract | null;
};

export type DocaScrapeStatus = {
  status: 'idle' | 'running' | 'login_required' | 'paused' | 'completed' | 'error';
  statusMessage: string;
  currentPage: number;
  totalPages: number;
  totalEntries: number;
  processedRows: number;
  uploadedRows: number;
  skippedRows: number;
  failedRows: number;
  checkpointPage: number;
  startedAt: string;
  lastProgressAt: string;
  lastError: string;
  machineName: string;
};

export type DocaEnrichStatus = {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  statusMessage: string;
  totalRows: number;
  processedRows: number;
  parsedRows: number;
  skippedRows: number;
  failedRows: number;
  startedAt: string;
  lastProgressAt: string;
  lastError: string;
  machineName: string;
  lastProcessed: DocaEnrichLastProcessed | null;
};

export type DocaEnrichLastProcessed = {
  certificate: string;
  action: 'parsed' | 'skipped' | 'failed' | '';
  processedAt: string;
  pdfExtract: DocaCertificatePdfExtract | null;
};

export type DocaScrapeLogEntry = {
  id: string;
  createdAt: string;
  message: string;
  level: string;
};

function normalizePdfExtract(data: unknown): DocaCertificatePdfExtract | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const parseStatus = readString(record, 'parseStatus');
  return {
    parseStatus: (['ok', 'partial', 'failed'].includes(parseStatus)
      ? parseStatus
      : '') as DocaCertificatePdfExtract['parseStatus'],
    parseError: readString(record, 'parseError'),
    parsedAt: readString(record, 'parsedAt'),
    parserVersion: readInt(record, 'parserVersion'),
    certificateNumber: readString(record, 'certificateNumber'),
    verificationDate: readString(record, 'verificationDate'),
    ownerName: readString(record, 'ownerName'),
    ownerAddress: readString(record, 'ownerAddress'),
    ownerPhone: readString(record, 'ownerPhone'),
    instrumentType: readString(record, 'instrumentType'),
    manufacturerModel: readString(record, 'manufacturerModel'),
    serialNumber: readString(record, 'serialNumber'),
    yearOfManufacture: readString(record, 'yearOfManufacture'),
    accuracyClass: readString(record, 'accuracyClass'),
    maxCapacity: readString(record, 'maxCapacity'),
    minCapacity: readString(record, 'minCapacity'),
    verificationScaleIntervalE: readString(record, 'verificationScaleIntervalE'),
    actualScaleIntervalD: readString(record, 'actualScaleIntervalD'),
    unitOfMeasurement: readString(record, 'unitOfMeasurement'),
    verificationIntervalsN: readString(record, 'verificationIntervalsN'),
    maximumPermissibleError: readString(record, 'maximumPermissibleError'),
    nextVerificationDue: readString(record, 'nextVerificationDue'),
    modelApprovalNos: readString(record, 'modelApprovalNos'),
    sealIdentificationNos: readString(record, 'sealIdentificationNos'),
  };
}

function normalizeDocaCertificate(
  id: string,
  data: Record<string, unknown> | undefined,
): DocaCertificateRecord {
  return {
    id,
    generateCertificate: readString(data, 'generateCertificate'),
    gatcCertificateNo: readString(data, 'gatcCertificateNo'),
    instrumentName: readString(data, 'instrumentName'),
    belongTo: readString(data, 'belongTo'),
    validityDate: readString(data, 'validityDate'),
    uploadDate: readString(data, 'uploadDate'),
    certificatePdfUrl: readString(data, 'certificatePdfUrl'),
    certificatePdfPath: readString(data, 'certificatePdfPath'),
    instrumentPhotoUrl: readString(data, 'instrumentPhotoUrl'),
    instrumentPhotoPath: readString(data, 'instrumentPhotoPath'),
    docaCertSourceUrl: readString(data, 'docaCertSourceUrl'),
    docaPhotoSourceUrl: readString(data, 'docaPhotoSourceUrl'),
    scrapedAt: readString(data, 'scrapedAt'),
    machineName: readString(data, 'machineName'),
    pdfExtract: normalizePdfExtract(data?.pdfExtract),
  };
}

export function normalizeDocaScrapeStatus(
  data: Record<string, unknown> | undefined,
): DocaScrapeStatus | null {
  if (!data) return null;
  const status = readString(data, 'status', 'idle');
  return {
    status: (['idle', 'running', 'login_required', 'paused', 'completed', 'error'].includes(status)
      ? status
      : 'idle') as DocaScrapeStatus['status'],
    statusMessage: readString(data, 'statusMessage'),
    currentPage: readInt(data, 'currentPage'),
    totalPages: readInt(data, 'totalPages'),
    totalEntries: readInt(data, 'totalEntries'),
    processedRows: readInt(data, 'processedRows'),
    uploadedRows: readInt(data, 'uploadedRows'),
    skippedRows: readInt(data, 'skippedRows'),
    failedRows: readInt(data, 'failedRows'),
    checkpointPage: readInt(data, 'checkpointPage'),
    startedAt: readString(data, 'startedAt'),
    lastProgressAt: readString(data, 'lastProgressAt'),
    lastError: readString(data, 'lastError'),
    machineName: readString(data, 'machineName'),
  };
}

export function subscribeDocaCertificates(
  onData: (records: DocaCertificateRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, DOCA_CERTIFICATES_COLLECTION),
    orderBy('scrapedAt', 'desc'),
  );
  return onSnapshot(
    q,
    snapshot => {
      onData(
        snapshot.docs.map(docSnap =>
          normalizeDocaCertificate(docSnap.id, docSnap.data() as Record<string, unknown>),
        ),
      );
    },
    error => onError?.(error),
  );
}

/** Live set of certificate numbers from siteCalibrations (verification pipeline). */
export function subscribeVerificationCertificateNumbers(
  onData: (numbers: Set<string>) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, 'siteCalibrations'),
    snapshot => {
      const numbers = new Set<string>();
      snapshot.docs.forEach(docSnap => {
        const key = normalizeCertificateMatchKey(
          readString(docSnap.data() as Record<string, unknown>, 'certificateNumber'),
        );
        if (key) {
          numbers.add(key);
        }
      });
      onData(numbers);
    },
    error => onError?.(error),
  );
}

export function subscribeDocaScrapeStatus(
  onData: (status: DocaScrapeStatus | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, AUTOMATION_WORKER_COLLECTION, DOCA_SCRAPE_STATUS_DOC),
    snapshot => {
      onData(normalizeDocaScrapeStatus(snapshot.data() as Record<string, unknown> | undefined));
    },
    error => onError?.(error),
  );
}

export function subscribeDocaScrapeLogs(
  onData: (logs: DocaScrapeLogEntry[]) => void,
  onError?: (error: Error) => void,
  maxEntries = 80,
): Unsubscribe {
  const q = query(
    collection(db, 'automationWorkerLogs'),
    orderBy('createdAt', 'desc'),
    limit(maxEntries),
  );
  return onSnapshot(
    q,
    snapshot => {
      onData(
        snapshot.docs
          .map(docSnap => {
            const data = docSnap.data() as Record<string, unknown>;
            return {
              id: docSnap.id,
              createdAt: readString(data, 'createdAt'),
              message: readString(data, 'message'),
              level: readString(data, 'level', 'info'),
              category: readString(data, 'category'),
            };
          })
          .filter(entry => entry.category === 'doca-scrape')
          .map(({ id, createdAt, message, level }) => ({ id, createdAt, message, level })),
      );
    },
    error => onError?.(error),
  );
}

export async function startDocaScrape(
  currentRemote: AutomationWorkerRemoteControl,
  updatedByUid: string,
  options?: { startPage?: number },
): Promise<void> {
  const startPage = options?.startPage ?? currentRemote.scrapeStartPage;
  await saveAutomationWorkerRemoteControl(
    currentRemote,
    {
      scrapePause: false,
      scrapeCommandRevision: currentRemote.scrapeCommandRevision + 1,
      scrapeStartPage: startPage > 1 ? startPage : 0,
    },
    updatedByUid,
  );
}

export async function pauseDocaScrape(
  currentRemote: AutomationWorkerRemoteControl,
  updatedByUid: string,
): Promise<void> {
  await saveAutomationWorkerRemoteControl(
    currentRemote,
    { scrapePause: true },
    updatedByUid,
  );
}

export async function resumeDocaScrape(
  currentRemote: AutomationWorkerRemoteControl,
  updatedByUid: string,
): Promise<void> {
  await saveAutomationWorkerRemoteControl(
    currentRemote,
    { scrapePause: false },
    updatedByUid,
  );
}

export async function ensureDocaScrapeRemoteDefaults(updatedByUid: string): Promise<void> {
  const snap = await getDoc(doc(db, AUTOMATION_WORKER_COLLECTION, 'remote'));
  if (snap.exists() && typeof snap.data()?.scrapeCommandRevision === 'number') {
    return;
  }

  await setDoc(
    doc(db, AUTOMATION_WORKER_COLLECTION, 'remote'),
    {
      scrapeCommandRevision: 0,
      scrapePause: true,
      scrapeStartPage: 0,
      updatedAt: new Date().toISOString(),
      updatedByUid,
    },
    { merge: true },
  );
}

export function normalizeDocaEnrichStatus(
  data: Record<string, unknown> | undefined,
): DocaEnrichStatus | null {
  if (!data) return null;
  const status = readString(data, 'status', 'idle');
  const action = readString(data, 'lastProcessedAction');
  return {
    status: (['idle', 'running', 'paused', 'completed', 'error'].includes(status)
      ? status
      : 'idle') as DocaEnrichStatus['status'],
    statusMessage: readString(data, 'statusMessage'),
    totalRows: readInt(data, 'totalRows'),
    processedRows: readInt(data, 'processedRows'),
    parsedRows: readInt(data, 'parsedRows'),
    skippedRows: readInt(data, 'skippedRows'),
    failedRows: readInt(data, 'failedRows'),
    startedAt: readString(data, 'startedAt'),
    lastProgressAt: readString(data, 'lastProgressAt'),
    lastError: readString(data, 'lastError'),
    machineName: readString(data, 'machineName'),
    lastProcessed: readString(data, 'lastProcessedCertificate')
      ? {
          certificate: readString(data, 'lastProcessedCertificate'),
          action: (['parsed', 'skipped', 'failed'].includes(action)
            ? action
            : '') as DocaEnrichLastProcessed['action'],
          processedAt: readString(data, 'lastProcessedAt'),
          pdfExtract: normalizePdfExtract(data.lastExtract),
        }
      : null,
  };
}

export function subscribeDocaEnrichStatus(
  onData: (status: DocaEnrichStatus | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, AUTOMATION_WORKER_COLLECTION, DOCA_ENRICH_STATUS_DOC),
    snapshot => {
      onData(normalizeDocaEnrichStatus(snapshot.data() as Record<string, unknown> | undefined));
    },
    error => onError?.(error),
  );
}

export function subscribeDocaEnrichLogs(
  onData: (logs: DocaScrapeLogEntry[]) => void,
  onError?: (error: Error) => void,
  maxEntries = 80,
): Unsubscribe {
  const q = query(
    collection(db, 'automationWorkerLogs'),
    orderBy('createdAt', 'desc'),
    limit(maxEntries),
  );
  return onSnapshot(
    q,
    snapshot => {
      onData(
        snapshot.docs
          .map(docSnap => {
            const data = docSnap.data() as Record<string, unknown>;
            return {
              id: docSnap.id,
              createdAt: readString(data, 'createdAt'),
              message: readString(data, 'message'),
              level: readString(data, 'level', 'info'),
              category: readString(data, 'category'),
            };
          })
          .filter(entry => entry.category === 'doca-enrich')
          .map(({ id, createdAt, message, level }) => ({ id, createdAt, message, level })),
      );
    },
    error => onError?.(error),
  );
}

export async function startDocaEnrich(
  currentRemote: AutomationWorkerRemoteControl,
  updatedByUid: string,
): Promise<void> {
  await saveAutomationWorkerRemoteControl(
    currentRemote,
    {
      enrichPause: false,
      enrichCommandRevision: currentRemote.enrichCommandRevision + 1,
    },
    updatedByUid,
  );
}

export async function pauseDocaEnrich(
  currentRemote: AutomationWorkerRemoteControl,
  updatedByUid: string,
): Promise<void> {
  await saveAutomationWorkerRemoteControl(
    currentRemote,
    { enrichPause: true },
    updatedByUid,
  );
}

export async function resumeDocaEnrich(
  currentRemote: AutomationWorkerRemoteControl,
  updatedByUid: string,
): Promise<void> {
  await saveAutomationWorkerRemoteControl(
    currentRemote,
    { enrichPause: false },
    updatedByUid,
  );
}

export async function ensureDocaEnrichRemoteDefaults(updatedByUid: string): Promise<void> {
  const snap = await getDoc(doc(db, AUTOMATION_WORKER_COLLECTION, 'remote'));
  if (snap.exists() && typeof snap.data()?.enrichCommandRevision === 'number') {
    return;
  }

  await setDoc(
    doc(db, AUTOMATION_WORKER_COLLECTION, 'remote'),
    {
      enrichCommandRevision: 0,
      enrichPause: false,
      updatedAt: new Date().toISOString(),
      updatedByUid,
    },
    { merge: true },
  );
}

export function isDocaCertificateMissingPdf(record: DocaCertificateRecord): boolean {
  return !record.certificatePdfUrl.trim() && !record.certificatePdfPath.trim();
}

export function isDocaCertificateMissingPhoto(record: DocaCertificateRecord): boolean {
  return !record.instrumentPhotoUrl.trim() && !record.instrumentPhotoPath.trim();
}

export function listDocaCertificatesMissingPdf(records: DocaCertificateRecord[]): DocaCertificateRecord[] {
  return records.filter(isDocaCertificateMissingPdf);
}

export function listDocaCertificateNumbersMissingPdf(records: DocaCertificateRecord[]): string[] {
  return listDocaCertificatesMissingPdf(records)
    .map(record => record.generateCertificate || record.gatcCertificateNo)
    .filter(Boolean)
    .sort();
}

export type DocaCertificateSortOption =
  | 'scrapedAt-desc'
  | 'scrapedAt-asc'
  | 'certificate-asc'
  | 'certificate-desc'
  | 'belongTo-asc'
  | 'instrument-asc'
  | 'serial-asc'
  | 'maxCapacity-asc'
  | 'parseStatus-asc'
  | 'validityDate-asc'
  | 'validityDate-desc'
  | 'uploadDate-desc';

export const DOCA_CERTIFICATE_SORT_OPTIONS: { value: DocaCertificateSortOption; label: string }[] = [
  { value: 'scrapedAt-desc', label: 'Scraped (newest)' },
  { value: 'scrapedAt-asc', label: 'Scraped (oldest)' },
  { value: 'certificate-asc', label: 'Certificate (A–Z)' },
  { value: 'certificate-desc', label: 'Certificate (Z–A)' },
  { value: 'belongTo-asc', label: 'Belongs to (A–Z)' },
  { value: 'instrument-asc', label: 'Instrument (A–Z)' },
  { value: 'serial-asc', label: 'Serial (A–Z)' },
  { value: 'maxCapacity-asc', label: 'Max capacity' },
  { value: 'parseStatus-asc', label: 'Parse status' },
  { value: 'validityDate-asc', label: 'Validity (soonest)' },
  { value: 'validityDate-desc', label: 'Validity (latest)' },
  { value: 'uploadDate-desc', label: 'Upload date (newest)' },
];

const PARSE_STATUS_RANK: Record<string, number> = {
  failed: 0,
  partial: 1,
  pending: 2,
  ok: 3,
  '': 2,
};

function compareText(a: string, b: string, direction: 'asc' | 'desc'): number {
  const result = a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  return direction === 'asc' ? result : -result;
}

function compareTimestamp(a: string, b: string, direction: 'asc' | 'desc'): number {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  const aValid = Number.isFinite(aTime);
  const bValid = Number.isFinite(bTime);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  const result = aTime - bTime;
  return direction === 'asc' ? result : -result;
}

function sortValue(record: DocaCertificateRecord, option: DocaCertificateSortOption): string {
  switch (option.split('-')[0]) {
    case 'certificate':
      return record.generateCertificate || record.gatcCertificateNo;
    case 'belongTo':
      return record.belongTo;
    case 'instrument':
      return record.instrumentName;
    case 'serial':
      return record.pdfExtract?.serialNumber ?? '';
    case 'maxCapacity':
      return record.pdfExtract?.maxCapacity ?? '';
    case 'parseStatus':
      return record.pdfExtract?.parseStatus ?? 'pending';
    case 'validityDate':
      return record.validityDate;
    case 'uploadDate':
      return record.uploadDate;
    default:
      return record.scrapedAt;
  }
}

export function sortDocaCertificates(
  records: DocaCertificateRecord[],
  sortOption: DocaCertificateSortOption,
): DocaCertificateRecord[] {
  const [field, direction] = sortOption.split('-') as [string, 'asc' | 'desc'];
  const sorted = [...records];

  sorted.sort((left, right) => {
    if (field === 'parseStatus') {
      const leftRank = PARSE_STATUS_RANK[left.pdfExtract?.parseStatus ?? 'pending'] ?? 2;
      const rightRank = PARSE_STATUS_RANK[right.pdfExtract?.parseStatus ?? 'pending'] ?? 2;
      const result = leftRank - rightRank;
      return direction === 'asc' ? result : -result;
    }

    if (field === 'scrapedAt' || field === 'validityDate' || field === 'uploadDate') {
      return compareTimestamp(sortValue(left, sortOption), sortValue(right, sortOption), direction);
    }

    return compareText(sortValue(left, sortOption), sortValue(right, sortOption), direction);
  });

  return sorted;
}

export { subscribeAutomationWorkerRemote };
