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
});
