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
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
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
    status: (['idle', 'running', 'paused', 'completed', 'error'].includes(status)
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
      scrapePause: false,
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

export { subscribeAutomationWorkerRemote };
