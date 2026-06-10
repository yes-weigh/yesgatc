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

export const DOCA_CERTIFICATES_COLLECTION = 'docaCertificates';
export const DOCA_SCRAPE_STATUS_DOC = 'scrape';

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

export type DocaScrapeLogEntry = {
  id: string;
  createdAt: string;
  message: string;
  level: string;
};

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
  maxEntries = 500,
): Unsubscribe {
  const q = query(
    collection(db, DOCA_CERTIFICATES_COLLECTION),
    orderBy('scrapedAt', 'desc'),
    limit(maxEntries),
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
): Promise<void> {
  await saveAutomationWorkerRemoteControl(
    currentRemote,
    {
      scrapePause: false,
      scrapeCommandRevision: currentRemote.scrapeCommandRevision + 1,
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
      updatedAt: new Date().toISOString(),
      updatedByUid,
    },
    { merge: true },
  );
}

export { subscribeAutomationWorkerRemote };
