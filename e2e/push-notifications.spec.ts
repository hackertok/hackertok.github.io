import { test, expect } from './fixtures/test';
import { setupApiMocks } from './fixtures/api-mocks';
import type { BrowserContext, Page, Worker } from '@playwright/test';

async function controlledWorker(
  page: Page,
  context: BrowserContext,
): Promise<Worker> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15_000 },
  );
  return context.serviceWorkers()[0] ??
    context.waitForEvent('serviceworker', { timeout: 10_000 });
}

async function dispatchPush(
  worker: Worker,
  payload: unknown,
  raw = false,
): Promise<Array<{
  title: string;
  body: string | undefined;
  tag: string | undefined;
  data: unknown;
}>> {
  return worker.evaluate(async ({ value, rawPayload }) => {
    const pending: Promise<unknown>[] = [];
    const calls: Array<{
      title: string;
      body: string | undefined;
      tag: string | undefined;
      data: unknown;
    }> = [];
    const registration = globalThis.registration;
    Object.defineProperty(registration, 'showNotification', {
      configurable: true,
      value: async (title: string, options?: NotificationOptions) => {
        calls.push({
          title,
          body: options?.body,
          tag: options?.tag,
          data: options?.data,
        });
      },
    });
    let data: string | undefined;
    if (rawPayload) {
      data = String(value);
    } else if (value !== undefined) {
      data = JSON.stringify(value);
    }
    const event = new PushEvent('push', { data });
    Object.defineProperty(event, 'waitUntil', {
      value: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    });
    globalThis.dispatchEvent(event);
    await Promise.all(pending);
    delete (registration as unknown as Record<string, unknown>).showNotification;
    return calls;
  }, { value: payload, rawPayload: raw });
}

async function dispatchSubscriptionChange(
  worker: Worker,
  outcome: 'accepted' | 'retired' | 'offline',
): Promise<{
  authorization: string;
  body: {
    endpoint: string;
    expirationTime: null;
    keys: { p256dh: string; auth: string };
  } | null;
  state: {
    token: string | null;
    reconciledFingerprint: string | null;
    reconciledAt: number;
    repairReason: string | null;
    reconcilePending: boolean;
  };
}> {
  return worker.evaluate(async ({ responseOutcome }) => {
    const token = 'R'.repeat(43);
    const key = new Uint8Array(65);
    key[0] = 4;
    let binary = '';
    for (const byte of key) binary += String.fromCharCode(byte);
    const applicationServerKey = btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const initialState = {
      version: 1,
      token,
      reconciledFingerprint: 'A'.repeat(43),
      reconciledAt: Date.now(),
      pendingDeleteTokens: [],
      keyId: 'v1',
      applicationServerKey,
      apiOrigin: globalThis.location.origin,
      repairReason: null,
      reconcilePending: false,
      legacyMigrated: true,
      revision: 1,
    };
    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hackertok-push-state', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('state')) {
          request.result.createObjectStore('state');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const putState = async (value: typeof initialState) => {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('state', 'readwrite');
        transaction.objectStore('state').put(value, 'current');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    };
    const getState = async () => {
      const db = await openDb();
      const value = await new Promise<typeof initialState>((resolve, reject) => {
        const transaction = db.transaction('state', 'readonly');
        const request = transaction.objectStore('state').get('current');
        request.onsuccess = () => resolve(request.result as typeof initialState);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return value;
    };
    await putState(initialState);

    const subscriptionJson = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/rotated',
      expirationTime: null,
      keys: { p256dh: 'rotated-public', auth: 'rotated-auth' },
    };
    const subscription = {
      expirationTime: null,
      toJSON: () => subscriptionJson,
      unsubscribe: async () => true,
    };
    let authorization = '';
    let body: typeof subscriptionJson | null = null;
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (_input: RequestInfo | URL, init?: RequestInit) => {
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        body = JSON.parse(String(init?.body)) as typeof subscriptionJson;
        if (responseOutcome === 'offline') throw new TypeError('offline');
        if (responseOutcome === 'retired') {
          return new Response(JSON.stringify({ code: 'token_retired' }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(null, { status: 204 });
      },
    });

    try {
      const pending: Promise<unknown>[] = [];
      const event = new Event('pushsubscriptionchange');
      Object.defineProperties(event, {
        newSubscription: { value: subscription },
        waitUntil: {
          value: (promise: Promise<unknown>) => pending.push(promise),
        },
      });
      globalThis.dispatchEvent(event);
      await Promise.all(pending);
      const state = await getState();
      return {
        authorization,
        body,
        state: {
          token: state.token,
          reconciledFingerprint: state.reconciledFingerprint,
          reconciledAt: state.reconciledAt,
          repairReason: state.repairReason,
          reconcilePending: state.reconcilePending,
        },
      };
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: originalFetch,
      });
    }
  }, { responseOutcome: outcome });
}

test.describe('Web Push service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test.beforeEach(async ({ browserName, page }) => {
    test.skip(browserName !== 'chromium', 'Synthetic push is validated in Chromium');
    await setupApiMocks(page);
  });

  test('shows validated story data and a safe malformed fallback', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const worker = await controlledWorker(page, context);

    const valid = await dispatchPush(worker, {
      version: 1,
      id: 12345,
      title: 'A highly ranked story',
      score: 1200,
    });
    expect(valid).toEqual([{
      title: 'A highly ranked story',
      body: '1,200 points on Hacker News',
      tag: 'hn-12345',
      data: { id: 12345 },
    }]);

    const invalid = await dispatchPush(worker, {
      version: 1,
      id: 12345,
      title: 'Unsafe threshold',
      score: 1000,
      url: 'https://attacker.example',
    });
    expect(invalid).toEqual([{
      title: 'HackerTok',
      body: 'Story alerts are ready.',
      tag: 'hackertok-alert',
      data: {},
    }]);

    for (const malformed of [
      await dispatchPush(worker, undefined),
      await dispatchPush(worker, { version: 2 }),
      await dispatchPush(worker, '{', true),
    ]) {
      expect(malformed).toEqual([{
        title: 'HackerTok',
        body: 'Story alerts are ready.',
        tag: 'hackertok-alert',
        data: {},
      }]);
    }
  });

  test('derives a same-origin item route on notification click', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const worker = await controlledWorker(page, context);
    const destination = await worker.evaluate(async () => {
      const pending: Promise<unknown>[] = [];
      let opened = '';
      Object.defineProperties(globalThis.clients, {
        matchAll: {
          configurable: true,
          value: async () => [],
        },
        openWindow: {
          configurable: true,
          value: async (url: string) => {
            opened = url;
            return null;
          },
        },
      });
      const event = new Event('notificationclick');
      Object.defineProperties(event, {
        notification: {
          value: {
            data: {
              id: 54321,
              url: 'https://attacker.example',
            },
            close: () => {},
          },
        },
        waitUntil: {
          value: (promise: Promise<unknown>) => {
            pending.push(promise);
          },
        },
      });
      globalThis.dispatchEvent(event);
      await Promise.all(pending);
      return opened;
    });

    expect(destination).toBe('http://localhost:4173/#/item/54321');
  });

  test('navigates an existing same-origin client on notification click', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const worker = await controlledWorker(page, context);
    const result = await worker.evaluate(async () => {
      const pending: Promise<unknown>[] = [];
      let navigated = '';
      let focused = false;
      let opened = false;
      const client = {
        url: `${globalThis.location.origin}/#/`,
        navigate: async (url: string) => {
          navigated = url;
          return client;
        },
        focus: async () => {
          focused = true;
          return client;
        },
      };
      Object.defineProperties(globalThis.clients, {
        matchAll: {
          configurable: true,
          value: async () => [client],
        },
        openWindow: {
          configurable: true,
          value: async () => {
            opened = true;
            return null;
          },
        },
      });
      const event = new Event('notificationclick');
      Object.defineProperties(event, {
        notification: {
          value: {
            data: { id: 65432 },
            close: () => {},
          },
        },
        waitUntil: {
          value: (promise: Promise<unknown>) => {
            pending.push(promise);
          },
        },
      });
      globalThis.dispatchEvent(event);
      await Promise.all(pending);
      return { navigated, focused, opened };
    });

    expect(result).toEqual({
      navigated: 'http://localhost:4173/#/item/65432',
      focused: true,
      opened: false,
    });
  });

  test('reconciles browser subscription rotation and queues recoverable failures', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    const worker = await controlledWorker(page, context);

    const accepted = await dispatchSubscriptionChange(worker, 'accepted');
    expect(accepted.authorization).toBe(`Bearer ${'R'.repeat(43)}`);
    expect(accepted.body?.endpoint).toContain('/rotated');
    expect(accepted.state.reconciledFingerprint).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(accepted.state.reconciledFingerprint).not.toBe('A'.repeat(43));
    expect(accepted.state.reconciledAt).toBeGreaterThan(0);
    expect(accepted.state.repairReason).toBeNull();
    expect(accepted.state.reconcilePending).toBe(false);

    const retired = await dispatchSubscriptionChange(worker, 'retired');
    expect(retired.state.token).toBe('R'.repeat(43));
    expect(retired.state.repairReason).toBe('token_retired');
    expect(retired.state.reconcilePending).toBe(true);

    const offline = await dispatchSubscriptionChange(worker, 'offline');
    expect(offline.state.token).toBe('R'.repeat(43));
    expect(offline.state.repairReason).toBeNull();
    expect(offline.state.reconcilePending).toBe(true);
  });
});
