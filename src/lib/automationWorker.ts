import {
  Timestamp,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';

export const AUTOMATION_WORKER_COLLECTION = 'automationWorker';
export const AUTOMATION_WORKER_STATUS_DOC = 'status';
export const AUTOMATION_WORKER_REMOTE_DOC = 'remote';
export const AUTOMATION_WORKER_LOGS_COLLECTION = 'automationWorkerLogs';
export const AUTOMATION_WORKER_CAPTCHA_COLLECTION = 'automationWorkerCaptchaAttempts';
export const AUTOMATION_WORKER_SESSIONS_COLLECTION = 'automationWorkerSessions';
export const EMAAP_ENGINE_PRESENCE_COLLECTION = 'emaapEnginePresence';

export const EMAAP_HISTORY_SESSION_LIMIT = 400;
export const EMAAP_HISTORY_LOG_LIMIT = 2500;
export const EMAAP_HISTORY_CAPTCHA_LIMIT = 1500;
export const EMAAP_HISTORY_WINDOW_LIMIT = 800;

export type WorkerRuntimeState =
  | 'idle'
  | 'working'
  | 'paused'
  | 'login_required'
  | 'error'
  | 'offline';

export type AutomationWorkerStatus = {
  lastHeartbeatAt: string;
  startedAt: string;
  machineName: string;
  workerVersion: string;
  state: string;
  statusMessage: string;
  autoWorkerEnabled: boolean;
  remotePaused: boolean;
  docaSessionState: string;
  queueTotal: number;
  queueEligible: number;
  queueSubmitted: number;
  jobsCompletedSession: number;
  jobsFailedSession: number;
  docaLoggedInAt: string;
  docaSessionAgeSeconds: number;
  lastSessionProbeAt: string;
  lastSessionProbeResult: string;
};

export type EmaapEnginePresence = {
  id: string;
  kind: string;
  rcId: string;
  rcName: string;
  machineName: string;
  lastHeartbeatAt: string;
};

export type AutomationWorkerRemoteControl = {
  commandRevision: number;
  credentialsRevision: number;
  autoWorkerEnabled: boolean;
  pauseWorker: boolean;
  clearJobLocksRevision: number;
  scrapeCommandRevision: number;
  scrapePause: boolean;
  scrapeStartPage: number;
  enrichCommandRevision: number;
  enrichPause: boolean;
  superAdminAadhar: string;
  superAdminPassword: string;
  docaEmail: string;
  docaPassword: string;
  captchaApiKey: string;
  updatedAt: string;
  updatedByUid: string;
};

export type AutomationWorkerLogEntry = {
  id: string;
  createdAt: string;
  message: string;
  level: string;
  category: string;
  machineName: string;
};

export type AutomationWorkerCaptchaAttempt = {
  id: string;
  createdAt: string;
  resolvedText: string;
  ocrProvider: string;
  attemptNumber: number;
  success: boolean;
  outcome: string;
  imageUrl: string;
  machineName: string;
};

export type AutomationWorkerSessionEvent = {
  id: string;
  loggedInAt: string;
  loggedOutAt: string;
  durationSeconds: number;
  logoutReason: string;
  machineName: string;
  jobsCompleted?: number;
  jobsFailed?: number;
  workerName?: string;
};

export function mapAutomationWorkerSession(
  id: string,
  data: Record<string, unknown>,
): AutomationWorkerSessionEvent {
  return {
    id,
    loggedInAt: readString(data, 'loggedInAt'),
    loggedOutAt: readString(data, 'loggedOutAt'),
    durationSeconds: readInt(data, 'durationSeconds'),
    logoutReason: readString(data, 'logoutReason'),
    machineName: readString(data, 'machineName'),
    jobsCompleted: readOptionalInt(data, 'jobsCompleted'),
    jobsFailed: readOptionalInt(data, 'jobsFailed'),
    workerName: readString(data, 'workerName') || undefined,
  };
}

export function mapAutomationWorkerLog(
  id: string,
  data: Record<string, unknown>,
): AutomationWorkerLogEntry {
  return {
    id,
    createdAt: readString(data, 'createdAt'),
    message: readString(data, 'message'),
    level: readString(data, 'level', 'info'),
    category: readString(data, 'category'),
    machineName: readString(data, 'machineName'),
  };
}

export function mapAutomationWorkerCaptcha(
  id: string,
  data: Record<string, unknown>,
): AutomationWorkerCaptchaAttempt {
  return {
    id,
    createdAt: readString(data, 'createdAt'),
    resolvedText: readString(data, 'resolvedText'),
    ocrProvider: readString(data, 'ocrProvider'),
    attemptNumber: readInt(data, 'attemptNumber'),
    success: readBool(data, 'success'),
    outcome: readString(data, 'outcome'),
    imageUrl: readString(data, 'imageUrl'),
    machineName: readString(data, 'machineName'),
  };
}

function activityQuery(collectionName: string, maxEntries: number, sinceIso?: string, untilIso?: string): Query {
  if (sinceIso && untilIso) {
    return query(
      collection(db, collectionName),
      where('createdAt', '>=', sinceIso),
      where('createdAt', '<=', untilIso),
      orderBy('createdAt', 'desc'),
      limit(maxEntries),
    );
  }
  if (sinceIso) {
    return query(
      collection(db, collectionName),
      where('createdAt', '>=', sinceIso),
      orderBy('createdAt', 'desc'),
      limit(maxEntries),
    );
  }
  return query(
    collection(db, collectionName),
    orderBy('createdAt', 'desc'),
    limit(maxEntries),
  );
}

export type AutomationWorkerCredentialsForm = {
  superAdminAadhar: string;
  superAdminPassword: string;
  docaEmail: string;
  docaPassword: string;
  captchaApiKey: string;
};

export const DEFAULT_AUTOMATION_WORKER_REMOTE: AutomationWorkerRemoteControl = {
  commandRevision: 0,
  credentialsRevision: 0,
  autoWorkerEnabled: true,
  pauseWorker: false,
  clearJobLocksRevision: 0,
  scrapeCommandRevision: 0,
  scrapePause: true,
  scrapeStartPage: 0,
  enrichCommandRevision: 0,
  enrichPause: false,
  superAdminAadhar: '',
  superAdminPassword: '',
  docaEmail: '',
  docaPassword: '',
  captchaApiKey: '',
  updatedAt: '',
  updatedByUid: '',
};

export const OFFLINE_HEARTBEAT_MS = 90_000;

export function readString(data: Record<string, unknown> | undefined, key: string, fallback = ''): string {
  if (!data) return fallback;
  const value = data[key];
  return typeof value === 'string' ? value : fallback;
}

export function readTimestampIso(data: Record<string, unknown> | undefined, key: string): string {
  if (!data) return '';
  const value = data[key];
  if (typeof value === 'string') return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return '';
    }
  }
  return '';
}

export function readBool(data: Record<string, unknown> | undefined, key: string, fallback = false): boolean {
  if (!data) return fallback;
  const value = data[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function readInt(data: Record<string, unknown> | undefined, key: string, fallback = 0): number {
  if (!data) return fallback;
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readOptionalInt(data: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!data) return undefined;
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeAutomationWorkerStatus(
  data: Record<string, unknown> | undefined,
): AutomationWorkerStatus | null {
  if (!data) return null;
  return {
    lastHeartbeatAt: readString(data, 'lastHeartbeatAt'),
    startedAt: readString(data, 'startedAt'),
    machineName: readString(data, 'machineName'),
    workerVersion: readString(data, 'workerVersion'),
    state: readString(data, 'state', 'offline'),
    statusMessage: readString(data, 'statusMessage'),
    autoWorkerEnabled: readBool(data, 'autoWorkerEnabled', true),
    remotePaused: readBool(data, 'remotePaused'),
    docaSessionState: readString(data, 'docaSessionState'),
    queueTotal: readInt(data, 'queueTotal'),
    queueEligible: readInt(data, 'queueEligible'),
    queueSubmitted: readInt(data, 'queueSubmitted'),
    jobsCompletedSession: readInt(data, 'jobsCompletedSession'),
    jobsFailedSession: readInt(data, 'jobsFailedSession'),
    docaLoggedInAt: readString(data, 'docaLoggedInAt'),
    docaSessionAgeSeconds: readInt(data, 'docaSessionAgeSeconds'),
    lastSessionProbeAt: readString(data, 'lastSessionProbeAt'),
    lastSessionProbeResult: readString(data, 'lastSessionProbeResult'),
  };
}

export function normalizeAutomationWorkerRemote(
  data: Record<string, unknown> | undefined,
): AutomationWorkerRemoteControl {
  if (!data) return { ...DEFAULT_AUTOMATION_WORKER_REMOTE };
  return {
    commandRevision: readInt(data, 'commandRevision'),
    credentialsRevision: readInt(data, 'credentialsRevision'),
    autoWorkerEnabled: readBool(data, 'autoWorkerEnabled', true),
    pauseWorker: readBool(data, 'pauseWorker'),
    clearJobLocksRevision: readInt(data, 'clearJobLocksRevision'),
    scrapeCommandRevision: readInt(data, 'scrapeCommandRevision'),
    scrapePause: readBool(data, 'scrapePause'),
    scrapeStartPage: readInt(data, 'scrapeStartPage'),
    enrichCommandRevision: readInt(data, 'enrichCommandRevision'),
    enrichPause: readBool(data, 'enrichPause'),
    superAdminAadhar: readString(data, 'superAdminAadhar'),
    superAdminPassword: readString(data, 'superAdminPassword'),
    docaEmail: readString(data, 'docaEmail'),
    docaPassword: readString(data, 'docaPassword'),
    captchaApiKey: readString(data, 'captchaApiKey'),
    updatedAt: readString(data, 'updatedAt'),
    updatedByUid: readString(data, 'updatedByUid'),
  };
}

export function resolveWorkerRuntimeState(status: AutomationWorkerStatus | null): WorkerRuntimeState {
  if (!status?.lastHeartbeatAt) return 'offline';
  const heartbeatMs = Date.parse(status.lastHeartbeatAt);
  if (!Number.isFinite(heartbeatMs) || Date.now() - heartbeatMs > OFFLINE_HEARTBEAT_MS) {
    return 'offline';
  }
  if (status.remotePaused) return 'paused';
  if (status.docaSessionState === 'login_required' || status.state === 'login_required') {
    return 'login_required';
  }
  if (status.state === 'working') return 'working';
  if (status.state === 'error') return 'error';
  return 'idle';
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function averageSessionSeconds(sessions: AutomationWorkerSessionEvent[]): number | null {
  if (sessions.length === 0) return null;
  const total = sessions.reduce((sum, session) => sum + (session.durationSeconds || 0), 0);
  return Math.round(total / sessions.length);
}

export function subscribeAutomationWorkerStatus(
  onData: (status: AutomationWorkerStatus | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, AUTOMATION_WORKER_COLLECTION, AUTOMATION_WORKER_STATUS_DOC),
    snapshot => {
      onData(normalizeAutomationWorkerStatus(snapshot.data() as Record<string, unknown> | undefined));
    },
    error => onError?.(error),
  );
}

export function isEmaapEngineLive(presence: EmaapEnginePresence, now = Date.now()): boolean {
  if (presence.kind !== 'emaapengine') return false;
  const heartbeatMs = Date.parse(presence.lastHeartbeatAt);
  return Number.isFinite(heartbeatMs) && now - heartbeatMs <= OFFLINE_HEARTBEAT_MS;
}

export function subscribeEmaapEnginePresence(
  onData: (rows: EmaapEnginePresence[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, EMAAP_ENGINE_PRESENCE_COLLECTION),
    snapshot => {
      onData(
        snapshot.docs.map(document => {
          const data = (document.data() as Record<string, unknown> | undefined) ?? {};
          return {
            id: document.id,
            kind: readString(data, 'kind'),
            rcId: readString(data, 'rcId'),
            rcName: readString(data, 'rcName'),
            machineName: readString(data, 'machineName'),
            lastHeartbeatAt: readTimestampIso(data, 'lastHeartbeatAt'),
          };
        }),
      );
    },
    error => onError?.(error),
  );
}

export function subscribeAutomationWorkerRemote(
  onData: (remote: AutomationWorkerRemoteControl) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, AUTOMATION_WORKER_COLLECTION, AUTOMATION_WORKER_REMOTE_DOC),
    snapshot => {
      onData(normalizeAutomationWorkerRemote(snapshot.data() as Record<string, unknown> | undefined));
    },
    error => onError?.(error),
  );
}

export function subscribeAutomationWorkerLogs(
  onData: (logs: AutomationWorkerLogEntry[]) => void,
  onError?: (error: Error) => void,
  maxEntries = 50,
  sinceIso?: string,
): Unsubscribe {
  return onSnapshot(
    activityQuery(AUTOMATION_WORKER_LOGS_COLLECTION, maxEntries, sinceIso),
    snapshot => {
      onData(
        snapshot.docs.map(docSnap =>
          mapAutomationWorkerLog(docSnap.id, docSnap.data() as Record<string, unknown>),
        ),
      );
    },
    error => onError?.(error),
  );
}

export function subscribeAutomationWorkerCaptchaAttempts(
  onData: (attempts: AutomationWorkerCaptchaAttempt[]) => void,
  onError?: (error: Error) => void,
  maxEntries = 100,
  sinceIso?: string,
): Unsubscribe {
  return onSnapshot(
    activityQuery(AUTOMATION_WORKER_CAPTCHA_COLLECTION, maxEntries, sinceIso),
    snapshot => {
      onData(
        snapshot.docs.map(docSnap =>
          mapAutomationWorkerCaptcha(docSnap.id, docSnap.data() as Record<string, unknown>),
        ),
      );
    },
    error => onError?.(error),
  );
}

export function subscribeAutomationWorkerSessions(
  onData: (sessions: AutomationWorkerSessionEvent[]) => void,
  onError?: (error: Error) => void,
  maxEntries = 50,
): Unsubscribe {
  const q = query(
    collection(db, AUTOMATION_WORKER_SESSIONS_COLLECTION),
    orderBy('loggedOutAt', 'desc'),
    limit(maxEntries),
  );
  return onSnapshot(
    q,
    snapshot => {
      onData(
        snapshot.docs.map(docSnap =>
          mapAutomationWorkerSession(docSnap.id, docSnap.data() as Record<string, unknown>),
        ),
      );
    },
    error => onError?.(error),
  );
}

export async function fetchAutomationWorkerSessions(maxEntries = 300): Promise<AutomationWorkerSessionEvent[]> {
  const snap = await getDocs(
    query(
      collection(db, AUTOMATION_WORKER_SESSIONS_COLLECTION),
      orderBy('loggedOutAt', 'desc'),
      limit(maxEntries),
    ),
  );
  return snap.docs.map(docSnap =>
    mapAutomationWorkerSession(docSnap.id, docSnap.data() as Record<string, unknown>),
  );
}

export async function fetchAutomationWorkerLogs(
  maxEntries = 400,
  sinceIso?: string,
): Promise<AutomationWorkerLogEntry[]> {
  const snap = await getDocs(activityQuery(AUTOMATION_WORKER_LOGS_COLLECTION, maxEntries, sinceIso));
  return snap.docs.map(docSnap =>
    mapAutomationWorkerLog(docSnap.id, docSnap.data() as Record<string, unknown>),
  );
}

export async function fetchAutomationWorkerLogsInRange(
  fromIso: string,
  toIso: string,
  maxEntries = EMAAP_HISTORY_WINDOW_LIMIT,
): Promise<AutomationWorkerLogEntry[]> {
  if (!fromIso) return [];
  const snap = await getDocs(
    activityQuery(AUTOMATION_WORKER_LOGS_COLLECTION, maxEntries, fromIso, toIso || '9999-12-31T23:59:59.999Z'),
  );
  return snap.docs.map(docSnap =>
    mapAutomationWorkerLog(docSnap.id, docSnap.data() as Record<string, unknown>),
  );
}

export async function fetchAutomationWorkerCaptchaAttempts(
  maxEntries = 400,
  sinceIso?: string,
): Promise<AutomationWorkerCaptchaAttempt[]> {
  const snap = await getDocs(activityQuery(AUTOMATION_WORKER_CAPTCHA_COLLECTION, maxEntries, sinceIso));
  return snap.docs.map(docSnap =>
    mapAutomationWorkerCaptcha(docSnap.id, docSnap.data() as Record<string, unknown>),
  );
}

export async function fetchAutomationWorkerCaptchaAttemptsInRange(
  fromIso: string,
  toIso: string,
  maxEntries = EMAAP_HISTORY_WINDOW_LIMIT,
): Promise<AutomationWorkerCaptchaAttempt[]> {
  if (!fromIso) return [];
  const snap = await getDocs(
    activityQuery(AUTOMATION_WORKER_CAPTCHA_COLLECTION, maxEntries, fromIso, toIso || '9999-12-31T23:59:59.999Z'),
  );
  return snap.docs.map(docSnap =>
    mapAutomationWorkerCaptcha(docSnap.id, docSnap.data() as Record<string, unknown>),
  );
}

export async function saveAutomationWorkerRemoteControl(
  current: AutomationWorkerRemoteControl,
  patch: Partial<AutomationWorkerRemoteControl> & Partial<AutomationWorkerCredentialsForm> & {
    scrapeCommandRevision?: number;
    scrapePause?: boolean;
    scrapeStartPage?: number;
    enrichCommandRevision?: number;
    enrichPause?: boolean;
  },
  updatedByUid: string,
  options?: { incrementCommand?: boolean; incrementCredentials?: boolean },
): Promise<void> {
  const nextCommandRevision =
    current.commandRevision + (options?.incrementCommand ? 1 : 0);
  const nextCredentialsRevision =
    current.credentialsRevision + (options?.incrementCredentials ? 1 : 0);

  await setDoc(
    doc(db, AUTOMATION_WORKER_COLLECTION, AUTOMATION_WORKER_REMOTE_DOC),
    {
      commandRevision: nextCommandRevision,
      credentialsRevision: nextCredentialsRevision,
      autoWorkerEnabled: patch.autoWorkerEnabled ?? current.autoWorkerEnabled,
      pauseWorker: patch.pauseWorker ?? current.pauseWorker,
      clearJobLocksRevision: patch.clearJobLocksRevision ?? current.clearJobLocksRevision,
      scrapeCommandRevision: patch.scrapeCommandRevision ?? current.scrapeCommandRevision,
      scrapePause: patch.scrapePause ?? current.scrapePause,
      scrapeStartPage: patch.scrapeStartPage ?? current.scrapeStartPage,
      enrichCommandRevision: patch.enrichCommandRevision ?? current.enrichCommandRevision,
      enrichPause: patch.enrichPause ?? current.enrichPause,
      superAdminAadhar: patch.superAdminAadhar ?? current.superAdminAadhar,
      superAdminPassword: patch.superAdminPassword ?? current.superAdminPassword,
      docaEmail: patch.docaEmail ?? current.docaEmail,
      docaPassword: patch.docaPassword ?? current.docaPassword,
      captchaApiKey: patch.captchaApiKey ?? current.captchaApiKey,
      updatedAt: new Date().toISOString(),
      updatedByUid,
    },
    { merge: true },
  );
}
