import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applicationServerKey,
  createPushToken,
  deletePushSubscription,
  fetchPushConfig,
  isPushApiConfigured,
  PushApiError,
  putPushSubscription,
  type PushConfig,
} from '../api/push';
import { getServiceWorkerRegistration } from '../pwa/serviceWorker';
import {
  STORY_INTERACTION_EVENT,
} from '../utils/storyInteraction';
import {
  VIEWED_DETAIL_TIMES_KEY,
  VIEWED_KEY,
  VIEWED_TITLE_TIMES_KEY,
} from '../utils/viewedItems';

const TOKEN_KEY = 'push:token';
const OFFER_HANDLED_KEY = 'push:offer-handled';
const RECONCILED_AT_KEY = 'push:reconciled-at';
const PENDING_DELETE_KEY = 'push:pending-delete';
const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STORAGE_PROBE_KEY = 'push:storage-probe';
let pendingDeleteFlush: Promise<void> | null = null;

export type PushNotificationStatus =
  | 'checking'
  | 'off'
  | 'enabling'
  | 'on'
  | 'sync-error'
  | 'denied'
  | 'unsupported'
  | 'offline'
  | 'not-ready'
  | 'capacity-full'
  | 'repair';

interface PushRuntime {
  config: PushConfig;
  applicationServerKey: Uint8Array<ArrayBuffer>;
  registration: ServiceWorkerRegistration;
  subscription: PushSubscription | null;
  needsRepair: boolean;
}

export interface PushNotificationsState {
  status: PushNotificationStatus;
  shouldOffer: boolean;
  isRepair: boolean;
  threshold: number;
  enable: () => void;
  dismiss: () => void;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Push remains best-effort if storage is unavailable. */
  }
}

function storageRemoveIfValue(key: string, expected: string): void {
  if (storageGet(key) === expected) storageRemove(key);
}

function canPersistPushState(): boolean {
  try {
    const previous = localStorage.getItem(STORAGE_PROBE_KEY);
    localStorage.setItem(STORAGE_PROBE_KEY, '1');
    const stored = localStorage.getItem(STORAGE_PROBE_KEY) === '1';
    if (previous === null) localStorage.removeItem(STORAGE_PROBE_KEY);
    else localStorage.setItem(STORAGE_PROBE_KEY, previous);
    return stored;
  } catch {
    return false;
  }
}

function pendingDeleteTokens(): string[] {
  const stored = storageGet(PENDING_DELETE_KEY);
  if (!stored) return [];
  try {
    const value = JSON.parse(stored) as unknown;
    if (Array.isArray(value)) {
      return [...new Set(value.filter(
        (token): token is string =>
          typeof token === 'string' && token.length > 0 && token.length <= 128,
      ))];
    }
  } catch {
    /* A single-token marker from an earlier release is intentionally plain text. */
  }
  return stored.length <= 128 ? [stored] : [];
}

function writePendingDeleteTokens(tokens: readonly string[]): void {
  const unique = [...new Set(tokens)];
  if (unique.length === 0) {
    storageRemove(PENDING_DELETE_KEY);
  } else if (unique.length === 1) {
    storageSet(PENDING_DELETE_KEY, unique[0] ?? '');
  } else {
    storageSet(PENDING_DELETE_KEY, JSON.stringify(unique));
  }
}

function enqueuePendingDelete(token: string): boolean {
  const tokens = pendingDeleteTokens();
  if (!tokens.includes(token)) tokens.push(token);
  writePendingDeleteTokens(tokens);
  return pendingDeleteTokens().includes(token);
}

function removePendingDelete(token: string): void {
  writePendingDeleteTokens(
    pendingDeleteTokens().filter((candidate) => candidate !== token),
  );
}

function hasStoryInteraction(): boolean {
  return [
    VIEWED_KEY,
    VIEWED_TITLE_TIMES_KEY,
    VIEWED_DETAIL_TIMES_KEY,
  ].some((key) => storageGet(key) !== null);
}

function isIosBrowserTab(): boolean {
  const iosDevice =
    /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iosDevice) return false;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

function isSupported(): boolean {
  return (
    isPushApiConfigured() &&
    typeof window !== 'undefined' &&
    window.isSecureContext !== false &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    !isIosBrowserTab() &&
    canPersistPushState()
  );
}

function keyMatches(
  subscription: PushSubscription,
  expected: Uint8Array,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return (
    bytes.byteLength === expected.byteLength &&
    bytes.every((byte, index) => byte === expected[index])
  );
}

function markOfferHandled(): void {
  storageSet(OFFER_HANDLED_KEY, '1');
}

function isDefinitivePutFailure(error: unknown): error is PushApiError {
  return error instanceof PushApiError && (
    error.code === 'capacity_full' ||
    error.code === 'subscription_conflict' ||
    [400, 401, 403, 404, 409, 410, 413, 415, 422].includes(error.status)
  );
}

async function retireToken(token: string): Promise<void> {
  const queued = enqueuePendingDelete(token);
  let deleted = false;
  if (queued) {
    await flushPendingDelete();
    deleted = !pendingDeleteTokens().includes(token);
  } else if (navigator.onLine) {
    try {
      await deletePushSubscription(token);
      deleted = true;
    } catch {
      /* Keep the current token so a later lifecycle refresh can retry. */
    }
  }
  if (deleted || pendingDeleteTokens().includes(token)) {
    storageRemoveIfValue(TOKEN_KEY, token);
    if (storageGet(TOKEN_KEY) === null) storageRemove(RECONCILED_AT_KEY);
  }
}

async function flushPendingDelete(): Promise<void> {
  if (!navigator.onLine) return;
  pendingDeleteFlush ??= (async () => {
    for (const token of pendingDeleteTokens()) {
      try {
        await deletePushSubscription(token);
        removePendingDelete(token);
      } catch {
        /* Keep this token queued for the next lifecycle refresh. */
      }
    }
  })().finally(() => {
    pendingDeleteFlush = null;
  });
  await pendingDeleteFlush;
}

export function usePushNotifications(): PushNotificationsState {
  const [status, setStatus] = useState<PushNotificationStatus>('checking');
  const [runtime, setRuntime] = useState<PushRuntime | null>(null);
  const [engaged, setEngaged] = useState(hasStoryInteraction);
  const [offerHandled, setOfferHandled] = useState(
    () => storageGet(OFFER_HANDLED_KEY) === '1',
  );
  const runtimeRef = useRef<PushRuntime | null>(null);
  const refreshGeneration = useRef(0);
  const enrollmentInFlight = useRef(false);
  const refreshPending = useRef(false);

  const refresh = useCallback(() => {
    if (enrollmentInFlight.current) {
      refreshPending.current = true;
      return;
    }
    const generation = ++refreshGeneration.current;
    if (!isSupported()) {
      setRuntime(null);
      runtimeRef.current = null;
      setStatus(isPushApiConfigured() ? 'unsupported' : 'not-ready');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('checking');
      void (async () => {
        const token = storageGet(TOKEN_KEY);
        const registration = await getServiceWorkerRegistration().catch(
          () => null,
        );
        const subscription = registration
          ? await registration.pushManager.getSubscription().catch(() => null)
          : null;
        if (subscription) {
          await subscription.unsubscribe().catch(() => false);
        }
        if (token) await retireToken(token);
        await flushPendingDelete();
        if (generation !== refreshGeneration.current) return;
        runtimeRef.current = null;
        setRuntime(null);
        markOfferHandled();
        setOfferHandled(true);
        setStatus('denied');
      })();
      return;
    }

    setStatus((current) => {
      if (!navigator.onLine) return 'offline';
      return current === 'on' ? current : 'checking';
    });
    void (async () => {
      const registration = await getServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (generation !== refreshGeneration.current) return;
      const token = storageGet(TOKEN_KEY);

      if (Notification.permission === 'denied') {
        if (subscription) {
          await subscription.unsubscribe().catch(() => false);
        }
        if (token) await retireToken(token);
        await flushPendingDelete();
        runtimeRef.current = null;
        setRuntime(null);
        markOfferHandled();
        setOfferHandled(true);
        setStatus('denied');
        return;
      }

      if (!subscription && token) await retireToken(token);
      if (!navigator.onLine) {
        runtimeRef.current = null;
        setRuntime(null);
        setStatus('offline');
        return;
      }

      await flushPendingDelete();
      const config = await fetchPushConfig();
      if (generation !== refreshGeneration.current) return;
      if (hasStoryInteraction()) setEngaged(true);
      if (!config.applicationServerKey) {
        runtimeRef.current = null;
        setRuntime(null);
        setStatus('not-ready');
        return;
      }
      const expectedKey = applicationServerKey(config.applicationServerKey);

      if (!subscription) {
        const needsRepair =
          Notification.permission === 'granted' &&
          (token !== null || config.enabled);
        const next: PushRuntime = {
          config,
          applicationServerKey: expectedKey,
          registration,
          subscription: null,
          needsRepair,
        };
        runtimeRef.current = next;
        setRuntime(next);
        setStatus(
          next.needsRepair ? 'repair' : config.enabled ? 'off' : 'not-ready',
        );
        return;
      }

      const needsRepair = !token || !keyMatches(subscription, expectedKey);
      let currentSubscription: PushSubscription | null = subscription;
      if (needsRepair) {
        const unsubscribed = await subscription.unsubscribe().catch(() => false);
        if (generation !== refreshGeneration.current) return;
        if (unsubscribed) currentSubscription = null;
      }
      const next: PushRuntime = {
        config,
        applicationServerKey: expectedKey,
        registration,
        subscription: currentSubscription,
        needsRepair,
      };
      runtimeRef.current = next;
      setRuntime(next);
      if (needsRepair) {
        setStatus('repair');
        return;
      }

      setStatus('on');
      const reconciledAt = Number(storageGet(RECONCILED_AT_KEY) ?? 0);
      if (
        Number.isFinite(reconciledAt) &&
        Date.now() - reconciledAt < RECONCILE_INTERVAL_MS
      ) {
        return;
      }
      try {
        await putPushSubscription(token, subscription);
        storageSet(RECONCILED_AT_KEY, String(Date.now()));
      } catch {
        if (generation === refreshGeneration.current) setStatus('sync-error');
      }
    })().catch(() => {
      if (generation !== refreshGeneration.current) return;
      setStatus(navigator.onLine ? 'sync-error' : 'offline');
    });
  }, []);

  useEffect(() => {
    refresh();
    const onRefresh = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onRefresh);
    window.addEventListener('pageshow', onRefresh);
    window.addEventListener('online', onRefresh);
    window.addEventListener('offline', onRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      refreshGeneration.current += 1;
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('pageshow', onRefresh);
      window.removeEventListener('online', onRefresh);
      window.removeEventListener('offline', onRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const onInteraction = () => setEngaged(true);
    window.addEventListener(STORY_INTERACTION_EVENT, onInteraction);
    return () => window.removeEventListener(STORY_INTERACTION_EVENT, onInteraction);
  }, []);

  const dismiss = useCallback(() => {
    markOfferHandled();
    setOfferHandled(true);
    setStatus('off');
  }, []);

  const enable = useCallback(() => {
    const current = runtimeRef.current;
    if (
      !current ||
      enrollmentInFlight.current ||
      status === 'enabling' ||
      !navigator.onLine
    ) {
      return;
    }

    enrollmentInFlight.current = true;
    setStatus('enabling');
    const subscribe = async (): Promise<PushSubscription> => {
      const existing = current.subscription;
      if (existing && !current.needsRepair) return existing;
      if (existing) await existing.unsubscribe();
      return current.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: current.applicationServerKey,
      });
    };

    let enrollment: Promise<PushSubscription | null>;
    if (Notification.permission === 'granted') {
      enrollment = subscribe();
    } else if (Notification.permission === 'default') {
      enrollment = Notification.requestPermission().then((permission) => {
        markOfferHandled();
        setOfferHandled(true);
        return permission === 'granted' ? subscribe() : null;
      });
    } else {
      enrollment = Promise.resolve(null);
    }

    void enrollment
      .then(async (subscription) => {
        markOfferHandled();
        setOfferHandled(true);
        if (!subscription) {
          setStatus(Notification.permission === 'denied' ? 'denied' : 'off');
          return;
        }

        const previousToken = storageGet(TOKEN_KEY);
        let token = previousToken ?? createPushToken();
        if (!storageSet(TOKEN_KEY, token)) {
          await subscription.unsubscribe().catch(() => false);
          const repair = {
            ...current,
            subscription: null,
            needsRepair: true,
          };
          runtimeRef.current = repair;
          setRuntime(repair);
          setStatus('sync-error');
          return;
        }
        storageRemove(RECONCILED_AT_KEY);
        const next = { ...current, subscription, needsRepair: false };
        runtimeRef.current = next;
        setRuntime(next);
        try {
          await putPushSubscription(token, subscription);
          storageSet(RECONCILED_AT_KEY, String(Date.now()));
          setStatus('on');
        } catch (error) {
          let enrollmentError = error;
          if (
            previousToken &&
            enrollmentError instanceof PushApiError &&
            enrollmentError.code === 'subscription_conflict'
          ) {
            await retireToken(previousToken);
            token = createPushToken();
            if (!storageSet(TOKEN_KEY, token)) {
              await subscription.unsubscribe().catch(() => false);
              const repair = {
                ...next,
                subscription: null,
                needsRepair: true,
              };
              runtimeRef.current = repair;
              setRuntime(repair);
              setStatus('sync-error');
              return;
            }
            try {
              await putPushSubscription(token, subscription);
              storageSet(RECONCILED_AT_KEY, String(Date.now()));
              setStatus('on');
              return;
            } catch (replacementError) {
              enrollmentError = replacementError;
            }
          }
          if (isDefinitivePutFailure(enrollmentError)) {
            await subscription.unsubscribe().catch(() => false);
            await retireToken(token);
            const repair = {
              ...next,
              subscription: null,
              needsRepair: true,
            };
            runtimeRef.current = repair;
            setRuntime(repair);
            setStatus(
              enrollmentError.code === 'capacity_full'
                ? 'capacity-full'
                : 'sync-error',
            );
            return;
          }
          // The PUT may have committed before the response was lost. Keep the
          // token/subscription and reconcile idempotently on the next lifecycle event.
          setStatus('sync-error');
        }
      })
      .catch(() => {
        const latest = runtimeRef.current;
        if (latest && Notification.permission === 'granted') {
          const repair = {
            ...latest,
            needsRepair: true,
          };
          runtimeRef.current = repair;
          setRuntime(repair);
        }
        setStatus('sync-error');
      })
      .finally(() => {
        enrollmentInFlight.current = false;
        if (refreshPending.current) {
          refreshPending.current = false;
          refresh();
        }
      });
  }, [refresh, status]);

  const shouldOffer = useMemo(() => {
    if (!runtime || !navigator.onLine) return false;
    if (status === 'enabling') return true;
    if (runtime.needsRepair) return status === 'repair' || status === 'sync-error';
    if (!runtime.config.enabled) return false;
    return (
      !offerHandled &&
      engaged &&
      Notification.permission === 'default' &&
      status === 'off'
    );
  }, [engaged, offerHandled, runtime, status]);

  return {
    status,
    shouldOffer,
    isRepair: runtime?.needsRepair ?? false,
    threshold: runtime?.config.threshold ?? 1000,
    enable,
    dismiss,
  };
}
