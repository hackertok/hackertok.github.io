export const PUSH_STATE_DB_NAME = 'hackertok-push-state';
export const PUSH_STATE_STORE = 'state';
export const PUSH_STATE_KEY = 'current';
export const PUSH_LIFECYCLE_LOCK = 'hackertok:push-lifecycle';
export const PUSH_STATE_CHANNEL = 'hackertok:push-state';

const LEGACY_TOKEN_KEY = 'push:token';
const LEGACY_RECONCILED_AT_KEY = 'push:reconciled-at';
const LEGACY_PENDING_DELETE_KEY = 'push:pending-delete';
const CONTEXT_ID = crypto.randomUUID();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const REPAIR_REASONS = new Set([
  'token_retired',
  'endpoint_conflict',
  'subscription_missing',
  'rotation_failed',
]);

export type PushRepairReason =
  | 'token_retired'
  | 'endpoint_conflict'
  | 'subscription_missing'
  | 'rotation_failed';

export interface DurablePushState {
  version: 1;
  token: string | null;
  reconciledFingerprint: string | null;
  reconciledAt: number;
  pendingDeleteTokens: string[];
  keyId: string | null;
  applicationServerKey: string | null;
  apiOrigin: string | null;
  repairReason: PushRepairReason | null;
  reconcilePending: boolean;
  legacyMigrated: boolean;
  revision: number;
}

function defaultState(): DurablePushState {
  return {
    version: 1,
    token: null,
    reconciledFingerprint: null,
    reconciledAt: 0,
    pendingDeleteTokens: [],
    keyId: null,
    applicationServerKey: null,
    apiOrigin: null,
    repairReason: null,
    reconcilePending: false,
    legacyMigrated: false,
    revision: 0,
  };
}

function safeString(
  value: unknown,
  maxLength: number,
  pattern?: RegExp,
): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    return null;
  }
  return !pattern || pattern.test(value) ? value : null;
}

function safeApiOrigin(value: unknown): string | null {
  const raw = safeString(value, 512);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      return null;
    }
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeState(value: unknown): DurablePushState {
  if (!value || typeof value !== 'object') return defaultState();
  const record = value as Partial<DurablePushState>;
  const pendingDeleteTokens = Array.isArray(record.pendingDeleteTokens)
    ? [...new Set(record.pendingDeleteTokens
      .map((token) => safeString(token, 128, TOKEN_PATTERN))
      .filter((token): token is string => token !== null))]
    : [];
  const repairReason = typeof record.repairReason === 'string' &&
    REPAIR_REASONS.has(record.repairReason)
    ? record.repairReason
    : null;
  return {
    version: 1,
    token: safeString(record.token, 128, TOKEN_PATTERN),
    reconciledFingerprint: safeString(
      record.reconciledFingerprint,
      128,
      FINGERPRINT_PATTERN,
    ),
    reconciledAt:
      typeof record.reconciledAt === 'number' &&
      Number.isSafeInteger(record.reconciledAt) &&
      record.reconciledAt > 0
        ? record.reconciledAt
        : 0,
    pendingDeleteTokens,
    keyId: safeString(record.keyId, 64),
    applicationServerKey: safeString(record.applicationServerKey, 256),
    apiOrigin: safeApiOrigin(record.apiOrigin),
    repairReason,
    reconcilePending: record.reconcilePending === true,
    legacyMigrated: record.legacyMigrated === true,
    revision:
      typeof record.revision === 'number' &&
      Number.isSafeInteger(record.revision) &&
      record.revision >= 0
        ? record.revision
        : 0,
  };
}

function openPushStateDb(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('indexeddb_unavailable'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_STATE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PUSH_STATE_STORE)) {
        request.result.createObjectStore(PUSH_STATE_STORE);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('indexeddb_open_failed'));
    request.onblocked = () => reject(new Error('indexeddb_blocked'));
  });
}

export async function readPushState(): Promise<DurablePushState> {
  const db = await openPushStateDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PUSH_STATE_STORE, 'readonly');
      const request = transaction.objectStore(PUSH_STATE_STORE).get(PUSH_STATE_KEY);
      let state = defaultState();
      request.onsuccess = () => {
        state = normalizeState(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('indexeddb_read_failed'));
      transaction.oncomplete = () => resolve(state);
      transaction.onerror = () => reject(
        transaction.error ?? new Error('indexeddb_read_failed'),
      );
      transaction.onabort = () => reject(
        transaction.error ?? new Error('indexeddb_read_aborted'),
      );
    });
  } finally {
    db.close();
  }
}

export async function updatePushState(
  mutate: (state: DurablePushState) => void,
): Promise<DurablePushState> {
  const db = await openPushStateDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(PUSH_STATE_STORE, 'readwrite');
      const store = transaction.objectStore(PUSH_STATE_STORE);
      const request = store.get(PUSH_STATE_KEY);
      let updated: DurablePushState | null = null;
      request.onsuccess = () => {
        try {
          const current = normalizeState(request.result);
          const draft: DurablePushState = {
            ...current,
            pendingDeleteTokens: [...current.pendingDeleteTokens],
          };
          mutate(draft);
          updated = normalizeState({
            ...draft,
            revision: current.revision + 1,
          });
          store.put(updated, PUSH_STATE_KEY);
        } catch (error) {
          transaction.abort();
          reject(
            error instanceof Error ? error : new Error('indexeddb_mutation_failed'),
          );
        }
      };
      request.onerror = () => reject(
        request.error ?? new Error('indexeddb_read_failed'),
      );
      transaction.oncomplete = () => {
        if (updated) resolve(updated);
        else reject(new Error('indexeddb_write_incomplete'));
      };
      transaction.onerror = () => reject(
        transaction.error ?? new Error('indexeddb_write_failed'),
      );
      transaction.onabort = () => reject(
        transaction.error ?? new Error('indexeddb_write_aborted'),
      );
    });
  } finally {
    db.close();
  }
}

function legacyPendingDeleteTokens(): string[] {
  let stored: string | null;
  try {
    stored = localStorage.getItem(LEGACY_PENDING_DELETE_KEY);
  } catch {
    return [];
  }
  if (!stored) return [];
  try {
    const value = JSON.parse(stored) as unknown;
    if (Array.isArray(value)) {
      return value
        .map((token) => safeString(token, 128, TOKEN_PATTERN))
        .filter((token): token is string => token !== null);
    }
  } catch {
    /* Earlier releases stored one pending token as plain text. */
  }
  const token = safeString(stored, 128, TOKEN_PATTERN);
  return token ? [token] : [];
}

export async function migrateLegacyPushState(): Promise<DurablePushState> {
  const current = await readPushState();
  if (current.legacyMigrated) return current;
  let token: string | null = null;
  let reconciledAt = 0;
  try {
    token = safeString(localStorage.getItem(LEGACY_TOKEN_KEY), 128, TOKEN_PATTERN);
    const storedAt = Number(localStorage.getItem(LEGACY_RECONCILED_AT_KEY) ?? 0);
    if (Number.isSafeInteger(storedAt) && storedAt > 0) reconciledAt = storedAt;
  } catch {
    /* IndexedDB remains the durable source if localStorage is unavailable. */
  }
  const pending = legacyPendingDeleteTokens();
  const state = await updatePushState((draft) => {
    if (draft.legacyMigrated) return;
    draft.token ??= token;
    if (draft.reconciledAt === 0) draft.reconciledAt = reconciledAt;
    draft.pendingDeleteTokens = [
      ...new Set([...draft.pendingDeleteTokens, ...pending]),
    ];
    draft.legacyMigrated = true;
  });
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_RECONCILED_AT_KEY);
    localStorage.removeItem(LEGACY_PENDING_DELETE_KEY);
  } catch {
    /* A completed IndexedDB migration is sufficient. */
  }
  return state;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

export async function pushSubscriptionFingerprint(
  subscription: PushSubscription,
  keyId: string,
): Promise<string> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth || !keyId) {
    throw new Error('invalid_subscription_fingerprint');
  }
  const canonical = JSON.stringify([
    keyId,
    json.endpoint,
    subscription.expirationTime,
    json.keys.p256dh,
    json.keys.auth,
  ]);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return base64Url(new Uint8Array(digest));
}

let fallbackLock: Promise<void> = Promise.resolve();

export function withPushLifecycleLock<T>(task: () => Promise<T>): Promise<T> {
  if ('locks' in navigator && navigator.locks) {
    return navigator.locks.request(PUSH_LIFECYCLE_LOCK, task);
  }
  const result = fallbackLock.then(task, task);
  fallbackLock = result.then(() => undefined, () => undefined);
  return result;
}

export function announcePushStateChange(): void {
  if (!('BroadcastChannel' in globalThis)) return;
  try {
    const channel = new BroadcastChannel(PUSH_STATE_CHANNEL);
    channel.postMessage({ type: 'push-state-changed', source: CONTEXT_ID });
    channel.close();
  } catch {
    /* Focus/pageshow reconciliation remains the fallback. */
  }
}

export function subscribeToPushStateChanges(listener: () => void): () => void {
  let channel: BroadcastChannel | null = null;
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; source?: unknown } | null;
    if (
      data?.type === 'push-state-changed' &&
      data.source !== CONTEXT_ID
    ) {
      listener();
    }
  };
  try {
    if ('BroadcastChannel' in globalThis) {
      channel = new BroadcastChannel(PUSH_STATE_CHANNEL);
      channel.addEventListener('message', onMessage);
    }
  } catch {
    channel = null;
  }
  const onServiceWorkerMessage = (event: MessageEvent) => onMessage(event);
  const serviceWorker = navigator.serviceWorker;
  if (typeof serviceWorker?.addEventListener === 'function') {
    serviceWorker.addEventListener('message', onServiceWorkerMessage);
  }
  return () => {
    channel?.removeEventListener('message', onMessage);
    channel?.close();
    if (typeof serviceWorker?.removeEventListener === 'function') {
      serviceWorker.removeEventListener('message', onServiceWorkerMessage);
    }
  };
}

export async function deletePushStateDatabaseForTests(): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  await fallbackLock.catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PUSH_STATE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('indexeddb_delete_failed'));
  });
}
