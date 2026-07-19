import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applicationServerKey,
  createPushToken,
  deletePushSubscription,
  fetchPushConfig,
  isPushApiConfigured,
  pushApiOrigin,
  PushApiError,
  putPushSubscription,
  type PushConfig,
} from '../api/push';
import { requestEnrollmentTurnstile } from '../api/turnstile';
import {
  announcePushStateChange,
  migrateLegacyPushState,
  pushSubscriptionFingerprint,
  readPushState,
  subscribeToPushStateChanges,
  updatePushState,
  withPushLifecycleLock,
  type DurablePushState,
  type PushRepairReason,
} from '../pwa/pushState';
import { getServiceWorkerRegistration } from '../pwa/serviceWorker';
import { STORY_INTERACTION_EVENT } from '../utils/storyInteraction';
import {
  VIEWED_DETAIL_TIMES_KEY,
  VIEWED_KEY,
  VIEWED_TITLE_TIMES_KEY,
} from '../utils/viewedItems';

const OFFER_HANDLED_KEY = 'push:offer-handled';
const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const API_TIMEOUT_MS = 10_000;

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

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The lifecycle record is stored transactionally in IndexedDB. */
  }
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
    'indexedDB' in window &&
    !isIosBrowserTab()
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

function requestSignal(): AbortSignal {
  return AbortSignal.timeout(API_TIMEOUT_MS);
}

function isDefinitivePutFailure(error: unknown): error is PushApiError {
  return error instanceof PushApiError && (
    error.code === 'capacity_full' ||
    [400, 401, 403, 404, 409, 410, 413, 415, 422].includes(error.status)
  );
}

class AdmissionChallengeError extends Error {
  constructor() {
    super('admission_challenge_failed');
    this.name = 'AdmissionChallengeError';
  }
}

async function putWithAdmission(
  token: string,
  subscription: PushSubscription,
  turnstileSiteKey: string,
  mayAlreadyExist: boolean,
): Promise<void> {
  if (mayAlreadyExist) {
    try {
      await putPushSubscription(token, subscription, undefined, requestSignal());
      return;
    } catch (error) {
      if (
        !(error instanceof PushApiError) ||
        error.code !== 'turnstile_required'
      ) {
        throw error;
      }
    }
  }

  let turnstileToken: string;
  try {
    turnstileToken = await requestEnrollmentTurnstile(turnstileSiteKey);
  } catch {
    throw new AdmissionChallengeError();
  }
  await putPushSubscription(
    token,
    subscription,
    turnstileToken,
    requestSignal(),
  );
}

async function persistConfig(config: PushConfig): Promise<void> {
  const apiOrigin = pushApiOrigin();
  if (!apiOrigin || !config.applicationServerKey) {
    throw new Error('push_config_unavailable');
  }
  await updatePushState((state) => {
    state.keyId = config.keyId;
    state.applicationServerKey = config.applicationServerKey;
    state.apiOrigin = apiOrigin;
  });
}

async function saveReconciled(
  token: string,
  subscription: PushSubscription,
  config: PushConfig,
): Promise<void> {
  const fingerprint = await pushSubscriptionFingerprint(subscription, config.keyId);
  await updatePushState((state) => {
    if (state.token && state.token !== token) {
      throw new Error('push_state_changed');
    }
    state.token = token;
    state.reconciledFingerprint = fingerprint;
    state.reconciledAt = Date.now();
    state.repairReason = null;
    state.reconcilePending = false;
    state.keyId = config.keyId;
    state.applicationServerKey = config.applicationServerKey;
    state.apiOrigin = pushApiOrigin();
  });
  announcePushStateChange();
}

async function markRepair(
  reason: PushRepairReason,
  expectedToken?: string | null,
): Promise<DurablePushState> {
  let changed = false;
  const state = await updatePushState((draft) => {
    if (expectedToken !== undefined && draft.token !== expectedToken) return;
    if (
      draft.repairReason === reason &&
      draft.reconcilePending &&
      draft.reconciledAt === 0
    ) {
      return;
    }
    draft.repairReason = reason;
    draft.reconcilePending = true;
    draft.reconciledAt = 0;
    changed = true;
  });
  if (changed) announcePushStateChange();
  return state;
}

async function markReconcilePending(expectedToken: string): Promise<void> {
  let changed = false;
  await updatePushState((state) => {
    if (state.token !== expectedToken) return;
    if (state.reconcilePending) return;
    state.reconcilePending = true;
    changed = true;
  });
  if (changed) announcePushStateChange();
}

async function flushPendingDeletes(): Promise<void> {
  if (!navigator.onLine) return;
  const snapshot = await readPushState();
  for (const token of snapshot.pendingDeleteTokens) {
    try {
      await deletePushSubscription(token, requestSignal());
      await updatePushState((state) => {
        state.pendingDeleteTokens = state.pendingDeleteTokens.filter(
          (candidate) => candidate !== token,
        );
      });
      announcePushStateChange();
    } catch {
      /* The durable queue is retried by a later lifecycle refresh. */
    }
  }
}

async function retireToken(token: string): Promise<void> {
  let queued = false;
  await updatePushState((state) => {
    if (
      state.token !== token &&
      !state.pendingDeleteTokens.includes(token)
    ) {
      return;
    }
    if (!state.pendingDeleteTokens.includes(token)) {
      state.pendingDeleteTokens.push(token);
    }
    if (state.token === token) {
      state.token = null;
      state.reconciledFingerprint = null;
      state.reconciledAt = 0;
      state.repairReason = null;
      state.reconcilePending = false;
    }
    queued = true;
  });
  if (!queued) return;
  announcePushStateChange();
  await flushPendingDeletes();
}

async function setEnrollmentToken(
  token: string,
  config: PushConfig,
): Promise<void> {
  await updatePushState((state) => {
    state.token = token;
    state.reconciledFingerprint = null;
    state.reconciledAt = 0;
    state.repairReason = null;
    state.reconcilePending = true;
    state.keyId = config.keyId;
    state.applicationServerKey = config.applicationServerKey;
    state.apiOrigin = pushApiOrigin();
  });
  announcePushStateChange();
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

  const applyRuntime = useCallback((
    next: PushRuntime | null,
    nextStatus: PushNotificationStatus,
    generation?: number,
  ) => {
    if (
      generation !== undefined &&
      generation !== refreshGeneration.current
    ) {
      return;
    }
    runtimeRef.current = next;
    setRuntime(next);
    setStatus(nextStatus);
  }, []);

  const refresh = useCallback(() => {
    if (enrollmentInFlight.current) {
      refreshPending.current = true;
      return;
    }
    const generation = ++refreshGeneration.current;
    if (!isSupported()) {
      applyRuntime(
        null,
        isPushApiConfigured() ? 'unsupported' : 'not-ready',
        generation,
      );
      return;
    }

    setStatus((current) => {
      if (!navigator.onLine) return 'offline';
      return current === 'on' ? current : 'checking';
    });

    void withPushLifecycleLock(async () => {
      let state = await migrateLegacyPushState();
      const registration = await getServiceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();

      if (Notification.permission === 'denied') {
        if (subscription) {
          await subscription.unsubscribe().catch(() => false);
        }
        if (state.token) await retireToken(state.token);
        await flushPendingDeletes();
        markOfferHandled();
        setOfferHandled(true);
        applyRuntime(null, 'denied', generation);
        return;
      }

      if (!navigator.onLine) {
        applyRuntime(null, 'offline', generation);
        return;
      }

      await flushPendingDeletes();
      const config = await fetchPushConfig(requestSignal());
      if (hasStoryInteraction()) setEngaged(true);
      if (!config.applicationServerKey) {
        applyRuntime(null, 'not-ready', generation);
        return;
      }
      await persistConfig(config);
      const expectedKey = applicationServerKey(config.applicationServerKey);
      subscription = await registration.pushManager.getSubscription();
      state = await readPushState();

      if (!subscription) {
        const hadToken = state.token !== null;
        if (state.token) await retireToken(state.token);
        const needsRepair =
          Notification.permission === 'granted' &&
          (hadToken || state.repairReason !== null || config.enabled);
        if (needsRepair) await markRepair('subscription_missing', null);
        const next: PushRuntime = {
          config,
          applicationServerKey: expectedKey,
          registration,
          subscription: null,
          needsRepair,
        };
        applyRuntime(
          next,
          needsRepair ? 'repair' : config.enabled ? 'off' : 'not-ready',
          generation,
        );
        return;
      }

      if (!keyMatches(subscription, expectedKey)) {
        await markRepair('rotation_failed', state.token);
        const next: PushRuntime = {
          config,
          applicationServerKey: expectedKey,
          registration,
          subscription,
          needsRepair: true,
        };
        applyRuntime(next, 'repair', generation);
        return;
      }

      if (!state.token) {
        await markRepair('subscription_missing', null);
        const next: PushRuntime = {
          config,
          applicationServerKey: expectedKey,
          registration,
          subscription,
          needsRepair: true,
        };
        applyRuntime(next, 'repair', generation);
        return;
      }

      const next: PushRuntime = {
        config,
        applicationServerKey: expectedKey,
        registration,
        subscription,
        needsRepair: state.repairReason !== null,
      };
      if (state.repairReason !== null) {
        applyRuntime(next, 'repair', generation);
        return;
      }
      const fingerprint = await pushSubscriptionFingerprint(
        subscription,
        config.keyId,
      );
      const needsReconcile =
        state.reconcilePending ||
        state.repairReason !== null ||
        state.reconciledFingerprint !== fingerprint ||
        Date.now() - state.reconciledAt >= RECONCILE_INTERVAL_MS;
      if (!needsReconcile) {
        applyRuntime(next, 'on', generation);
        return;
      }

      applyRuntime(next, 'on', generation);
      const token = state.token;
      try {
        await putPushSubscription(
          token,
          subscription,
          undefined,
          requestSignal(),
        );
        await saveReconciled(token, subscription, config);
      } catch (error) {
        if (
          error instanceof PushApiError &&
          (
            error.code === 'token_retired' ||
            error.code === 'endpoint_conflict' ||
            error.code === 'turnstile_required'
          )
        ) {
          const reason: PushRepairReason =
            error.code === 'endpoint_conflict'
              ? 'endpoint_conflict'
              : error.code === 'token_retired'
                ? 'token_retired'
                : 'subscription_missing';
          await markRepair(reason, token);
          applyRuntime({ ...next, needsRepair: true }, 'repair', generation);
          return;
        }
        await markReconcilePending(token);
        applyRuntime(
          next,
          navigator.onLine ? 'sync-error' : 'offline',
          generation,
        );
      }
    }).catch(() => {
      applyRuntime(
        runtimeRef.current,
        navigator.onLine ? 'sync-error' : 'offline',
        generation,
      );
    });
  }, [applyRuntime]);

  useEffect(() => {
    refresh();
    const onRefresh = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const unsubscribeState = subscribeToPushStateChanges(onRefresh);
    window.addEventListener('focus', onRefresh);
    window.addEventListener('pageshow', onRefresh);
    window.addEventListener('online', onRefresh);
    window.addEventListener('offline', onRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      refreshGeneration.current += 1;
      unsubscribeState();
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

    let permissionRequest: Promise<NotificationPermission>;
    if (Notification.permission === 'default') {
      // This must remain synchronous with the click; awaiting the cross-tab lock
      // first would consume the browser's transient user activation.
      permissionRequest = Notification.requestPermission();
    } else {
      permissionRequest = Promise.resolve(Notification.permission);
    }

    void permissionRequest
      .then(async (permission) => {
        markOfferHandled();
        setOfferHandled(true);
        if (permission !== 'granted') {
          setStatus(permission === 'denied' ? 'denied' : 'off');
          return;
        }

        await withPushLifecycleLock(async () => {
          await migrateLegacyPushState();
          await flushPendingDeletes();
          const config = await fetchPushConfig(requestSignal());
          if (!config.applicationServerKey) throw new Error('push_not_ready');
          await persistConfig(config);
          const expectedKey = applicationServerKey(config.applicationServerKey);
          const registration = await getServiceWorkerRegistration();
          let subscription = await registration.pushManager.getSubscription();
          const state = await readPushState();

          if (subscription && keyMatches(subscription, expectedKey) && state.token) {
            const fingerprint = await pushSubscriptionFingerprint(
              subscription,
              config.keyId,
            );
            if (
              state.repairReason === null &&
              !state.reconcilePending &&
              state.reconciledFingerprint === fingerprint
            ) {
              const next: PushRuntime = {
                config,
                applicationServerKey: expectedKey,
                registration,
                subscription,
                needsRepair: false,
              };
              applyRuntime(next, 'on');
              return;
            }
          }

          let createdSubscription = false;
          const mustReplaceSubscription = Boolean(
            subscription && (
              !keyMatches(subscription, expectedKey) ||
              state.repairReason === 'endpoint_conflict' ||
              !state.token
            ),
          );
          const resubscribedForConflict =
            mustReplaceSubscription &&
            state.repairReason === 'endpoint_conflict';
          if (subscription && mustReplaceSubscription) {
            const unsubscribed = await subscription.unsubscribe();
            if (!unsubscribed) throw new Error('push_unsubscribe_failed');
            subscription = null;
            createdSubscription = true;
          }
          if (!subscription) {
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: expectedKey,
            });
            createdSubscription = true;
          }

          const previousToken = state.token;
          let token =
            !previousToken || state.repairReason === 'token_retired' ||
              state.repairReason === 'endpoint_conflict'
              ? createPushToken()
              : previousToken;
          if (previousToken && previousToken !== token) {
            await retireToken(previousToken);
          }
          await setEnrollmentToken(token, config);
          const next: PushRuntime = {
            config,
            applicationServerKey: expectedKey,
            registration,
            subscription,
            needsRepair: false,
          };
          applyRuntime(next, 'enabling');

          const submit = async (mayAlreadyExist: boolean) => {
            await putWithAdmission(
              token,
              subscription!,
              config.turnstileSiteKey,
              mayAlreadyExist,
            );
            await saveReconciled(token, subscription!, config);
          };

          try {
            await submit(previousToken === token);
            applyRuntime(next, 'on');
            return;
          } catch (initialError) {
            let enrollmentError: unknown = initialError;

            if (
              enrollmentError instanceof PushApiError &&
              enrollmentError.code === 'token_retired' &&
              previousToken === token
            ) {
              await retireToken(token);
              token = createPushToken();
              await setEnrollmentToken(token, config);
              try {
                await submit(false);
                applyRuntime(next, 'on');
                return;
              } catch (replacementError) {
                enrollmentError = replacementError;
              }
            }

            if (
              enrollmentError instanceof PushApiError &&
              enrollmentError.code === 'endpoint_conflict' &&
              !resubscribedForConflict
            ) {
              const latest = await readPushState();
              if (latest.token && latest.token !== token) {
                token = latest.token;
                try {
                  await submit(true);
                  applyRuntime(next, 'on');
                  return;
                } catch (winnerError) {
                  enrollmentError = winnerError;
                }
              } else {
                const unsubscribed = await subscription.unsubscribe();
                if (unsubscribed) {
                  subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: expectedKey,
                  });
                  createdSubscription = true;
                  await retireToken(token);
                  token = createPushToken();
                  await setEnrollmentToken(token, config);
                  try {
                    await submit(false);
                    const recovered = { ...next, subscription };
                    applyRuntime(recovered, 'on');
                    return;
                  } catch (replacementError) {
                    enrollmentError = replacementError;
                  }
                }
              }
            }

            if (enrollmentError instanceof AdmissionChallengeError) {
              await markRepair('subscription_missing', token);
              applyRuntime(
                { ...next, subscription, needsRepair: true },
                'sync-error',
              );
              return;
            }

            if (
              enrollmentError instanceof PushApiError &&
              (
                enrollmentError.code === 'token_retired' ||
                enrollmentError.code === 'endpoint_conflict'
              )
            ) {
              await markRepair(enrollmentError.code, token);
              applyRuntime(
                { ...next, subscription, needsRepair: true },
                'repair',
              );
              return;
            }

            if (isDefinitivePutFailure(enrollmentError)) {
              if (createdSubscription) {
                await subscription.unsubscribe().catch(() => false);
              }
              await retireToken(token);
              await markRepair('subscription_missing', null);
              applyRuntime(
                { ...next, subscription: null, needsRepair: true },
                enrollmentError.code === 'capacity_full'
                  ? 'capacity-full'
                  : 'sync-error',
              );
              return;
            }

            await markReconcilePending(token);
            applyRuntime(next, 'sync-error');
          }
        });
      })
      .catch(async () => {
        const latest = runtimeRef.current;
        try {
          const state = await readPushState();
          await markRepair('rotation_failed', state.token);
        } catch {
          /* IndexedDB failures are reported as an unsupported installation. */
        }
        if (latest && Notification.permission === 'granted') {
          applyRuntime({ ...latest, needsRepair: true }, 'sync-error');
        } else {
          setStatus('sync-error');
        }
      })
      .finally(() => {
        enrollmentInFlight.current = false;
        if (refreshPending.current) {
          refreshPending.current = false;
          refresh();
        }
      });
  }, [applyRuntime, refresh, status]);

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
