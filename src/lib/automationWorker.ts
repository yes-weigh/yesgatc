import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';

export const AUTOMATION_WORKER_COLLECTION = 'automationWorker';
export const AUTOMATION_WORKER_STATUS_DOC = 'status';
export const AUTOMATION_WORKER_REMOTE_DOC = 'remote';
export const AUTOMATION_WORKER_LOGS_COLLECTION = 'automationWorkerLogs';
export const AUTOMATION_WORKER_CAPTCHA_COLLECTION = 'automationWorkerCaptchaAttempts';
export const AUTOMATION_WORKER_SESSIONS_COLLECTION = 'automationWorkerSessions';

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
  docaFillOnly: boolean;
  docaSessionState: string;
  queueTotal: number;
  queueEligible: number;
  queueSubmitted: number;
  queueApproved: number;
  jobsCompletedSession: number;
  jobsFailedSession: number;
  docaLoggedInAt: string;
  docaSessionAgeSeconds: number;
  lastSessionProbeAt: string;
  lastSessionProbeResult: string;
};

export type AutomationWorkerRemoteControl = {
  commandRevision: number;
  credentialsRevision: number;
  autoWorkerEnabled: boolean;
  docaFillOnly: boolean;
  pauseWorker: boolean;
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
};

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
  docaFillOnly: false,
  pauseWorker: false,
  superAdminAadhar: '',
  superAdminPassword: '',
  docaEmail: '',
  docaPassword: '',
  captchaApiKey: '',
  updatedAt: '',
  updatedByUid: '',
};

export const OFFLINE_HEARTBEAT_MS = 90_000;

function readString(data: Record<string, unknown>, key: string, fallback = ''): string {
  const value = data[key];
  return typeof value === 'string' ? value : fallback;
}

function readBool(data: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = data[key];
  return typeof value === 'boolean' ? value : fallback;
}

function readInt(data: Record<string, unknown>, key: string, fallback = 0): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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
    docaFillOnly: readBool(data, 'docaFillOnly'),
    docaSessionState: readString(data, 'docaSessionState'),
    queueTotal: readInt(data, 'queueTotal'),
    queueEligible: readInt(data, 'queueEligible'),
    queueSubmitted: readInt(data, 'queueSubmitted'),
    queueApproved: readInt(data, 'queueApproved'),
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
    docaFillOnly: readBool(data, 'docaFillOnly'),
    pauseWorker: readBool(data, 'pauseWorker'),
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
): Unsubscribe {
  const q = query(
    collection(db, AUTOMATION_WORKER_LOGS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(maxEntries),
  );
  return onSnapshot(
    q,
    snapshot => {
      onData(
        snapshot.docs.map(docSnap => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            createdAt: readString(data, 'createdAt'),
            message: readString(data, 'message'),
            level: readString(data, 'level', 'info'),
            category: readString(data, 'category'),
            machineName: readString(data, 'machineName'),
          };
        }),
      );
    },
    error => onError?.(error),
  );
}

export function subscribeAutomationWorkerCaptchaAttempts(
  onData: (attempts: AutomationWorkerCaptchaAttempt[]) => void,
  onError?: (error: Error) => void,
  maxEntries = 100,
): Unsubscribe {
  const q = query(
    collection(db, AUTOMATION_WORKER_CAPTCHA_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(maxEntries),
  );
  return onSnapshot(
    q,
    snapshot => {
      onData(
        snapshot.docs.map(docSnap => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            createdAt: readString(data, 'createdAt'),
            resolvedText: readString(data, 'resolvedText'),
            ocrProvider: readString(data, 'ocrProvider'),
            attemptNumber: readInt(data, 'attemptNumber'),
            success: readBool(data, 'success'),
            outcome: readString(data, 'outcome'),
            imageUrl: readString(data, 'imageUrl'),
            machineName: readString(data, 'machineName'),
          };
        }),
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
        snapshot.docs.map(docSnap => {
          const data = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            loggedInAt: readString(data, 'loggedInAt'),
            loggedOutAt: readString(data, 'loggedOutAt'),
            durationSeconds: readInt(data, 'durationSeconds'),
            logoutReason: readString(data, 'logoutReason'),
            machineName: readString(data, 'machineName'),
          };
        }),
      );
    },
    error => onError?.(error),
  );
}

export async function saveAutomationWorkerRemoteControl(
  current: AutomationWorkerRemoteControl,
  patch: Partial<AutomationWorkerRemoteControl> & Partial<AutomationWorkerCredentialsForm>,
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
      docaFillOnly: patch.docaFillOnly ?? current.docaFillOnly,
      pauseWorker: patch.pauseWorker ?? current.pauseWorker,
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
