import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getServiceWorkerRegistration,
  resetServiceWorkerRegistrationForTests,
} from './serviceWorker';

function installServiceWorkerMock(value: {
  register: () => Promise<ServiceWorkerRegistration>;
  ready: Promise<ServiceWorkerRegistration>;
}): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  resetServiceWorkerRegistrationForTests();
  vi.useRealTimers();
});

describe('service worker registration', () => {
  it('reuses an active bounded registration', async () => {
    const registration = {
      active: {},
    } as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);
    installServiceWorkerMock({
      register,
      ready: Promise.resolve(registration),
    });

    await expect(getServiceWorkerRegistration()).resolves.toBe(registration);
    await expect(getServiceWorkerRegistration()).resolves.toBe(registration);
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js?push-dev=1');
  });

  it('rejects instead of waiting forever for readiness', async () => {
    vi.useFakeTimers();
    const registration = { active: null } as unknown as ServiceWorkerRegistration;
    installServiceWorkerMock({
      register: vi.fn().mockResolvedValue(registration),
      ready: new Promise<ServiceWorkerRegistration>(() => {
        /* Deliberately unresolved. */
      }),
    });

    const pending = getServiceWorkerRegistration(100);
    void pending.catch(() => {
      /* Attach a handler before advancing timers to avoid an unhandled rejection. */
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).rejects.toThrow('service_worker_ready_timeout');
  });
});
