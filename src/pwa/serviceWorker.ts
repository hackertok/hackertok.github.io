const DEFAULT_TIMEOUT_MS = 8_000;
const SERVICE_WORKER_URL = import.meta.env.DEV
  ? '/sw.js?push-dev=1'
  : '/sw.js';

let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(message));
      },
    );
  });
}

export function supportsServiceWorkers(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function getServiceWorkerRegistration(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServiceWorkerRegistration> {
  if (!supportsServiceWorkers()) {
    return Promise.reject(new Error('service_worker_unsupported'));
  }

  registrationPromise ??= (async () => {
    const registered = await withTimeout(
      navigator.serviceWorker.register(SERVICE_WORKER_URL),
      timeoutMs,
      'service_worker_registration_timeout',
    );
    if (registered.active) return registered;
    return withTimeout(
      navigator.serviceWorker.ready,
      timeoutMs,
      'service_worker_ready_timeout',
    );
  })().catch((error: unknown) => {
    registrationPromise = null;
    throw error;
  });

  return registrationPromise;
}

export function preloadServiceWorkerRegistration(): void {
  if (!supportsServiceWorkers()) return;
  void getServiceWorkerRegistration().catch(() => {
    /* Progressive enhancement: the app remains usable without a service worker. */
  });
}

export function resetServiceWorkerRegistrationForTests(): void {
  registrationPromise = null;
}
