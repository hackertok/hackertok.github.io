import { describe, expect, it } from 'vitest';
import {
  migrateLegacyPushState,
  pushSubscriptionFingerprint,
  readPushState,
  updatePushState,
  withPushLifecycleLock,
} from './pushState';

const TOKEN_A = 'A'.repeat(43);
const TOKEN_B = 'B'.repeat(43);

function subscription(endpoint: string): PushSubscription {
  return {
    endpoint,
    expirationTime: null,
    options: {
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([4]).buffer,
    },
    getKey: () => null,
    unsubscribe: async () => true,
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'public-key', auth: 'auth-secret' },
    }),
  };
}

describe('durable push state', () => {
  it('serializes transactional updates without losing pending tokens', async () => {
    await Promise.all([
      updatePushState((state) => {
        state.pendingDeleteTokens.push(TOKEN_A);
      }),
      updatePushState((state) => {
        state.pendingDeleteTokens.push(TOKEN_B);
      }),
    ]);

    const state = await readPushState();
    expect(state.pendingDeleteTokens).toEqual([TOKEN_A, TOKEN_B]);
    expect(state.revision).toBe(2);
  });

  it('atomically migrates the prior localStorage lifecycle record', async () => {
    localStorage.setItem('push:token', TOKEN_A);
    localStorage.setItem('push:reconciled-at', '1234');
    localStorage.setItem(
      'push:pending-delete',
      JSON.stringify([TOKEN_B]),
    );

    const state = await migrateLegacyPushState();

    expect(state).toMatchObject({
      token: TOKEN_A,
      reconciledAt: 1234,
      pendingDeleteTokens: [TOKEN_B],
    });
    expect(localStorage.getItem('push:token')).toBeNull();
    expect(localStorage.getItem('push:reconciled-at')).toBeNull();
    expect(localStorage.getItem('push:pending-delete')).toBeNull();
  });

  it('never resurrects a retired token from stale legacy storage', async () => {
    localStorage.setItem('push:token', TOKEN_A);
    await migrateLegacyPushState();
    await updatePushState((state) => {
      state.token = null;
      state.reconciledFingerprint = null;
      state.reconciledAt = 0;
    });
    localStorage.setItem('push:token', TOKEN_A);

    const state = await migrateLegacyPushState();

    expect(state.token).toBeNull();
  });

  it('fingerprints endpoint and key changes', async () => {
    const first = await pushSubscriptionFingerprint(
      subscription('https://fcm.googleapis.com/fcm/send/one'),
      'v1',
    );
    const same = await pushSubscriptionFingerprint(
      subscription('https://fcm.googleapis.com/fcm/send/one'),
      'v1',
    );
    const rotated = await pushSubscriptionFingerprint(
      subscription('https://fcm.googleapis.com/fcm/send/two'),
      'v1',
    );

    expect(first).toBe(same);
    expect(rotated).not.toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('serializes the no-Web-Locks fallback in one realm', async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    const first = withPushLifecycleLock(async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push('first:end');
    });
    const second = withPushLifecycleLock(async () => {
      order.push('second');
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });
});
