import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PushApiError } from '../api/push';
import {
  pushSubscriptionFingerprint,
  readPushState,
  updatePushState,
} from '../pwa/pushState';
import { STORY_INTERACTION_EVENT } from '../utils/storyInteraction';
import { PushNotificationOptIn } from './PushNotificationOptIn';

const GENERATED_TOKEN = 'G'.repeat(43);
const EXISTING_TOKEN = 'E'.repeat(43);
const OLD_TOKEN = 'O'.repeat(43);
const NEW_TOKEN = 'N'.repeat(43);

const mocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  putSubscription: vi.fn(),
  deleteSubscription: vi.fn(),
  requestTurnstile: vi.fn(),
  getRegistration: vi.fn(),
  order: [] as string[],
}));

vi.mock('../api/turnstile', () => ({
  TURNSTILE_CONTAINER_ID: 'hackertok-turnstile',
  requestEnrollmentTurnstile: mocks.requestTurnstile,
}));

vi.mock('../api/push', () => {
  class PushApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  return {
    PushApiError,
    isPushApiConfigured: () => true,
    fetchPushConfig: mocks.fetchConfig,
    putPushSubscription: mocks.putSubscription,
    deletePushSubscription: mocks.deleteSubscription,
    createPushToken: () => 'G'.repeat(43),
    pushApiOrigin: () => 'https://push.example',
    applicationServerKey: () => {
      const key = new Uint8Array(65);
      key[0] = 4;
      return key;
    },
  };
});

vi.mock('../pwa/serviceWorker', () => ({
  getServiceWorkerRegistration: mocks.getRegistration,
}));

function makeSubscription(
  keyByte = 0,
  endpoint = 'https://fcm.googleapis.com/fcm/send/test',
): PushSubscription {
  const applicationKey = new Uint8Array(65);
  applicationKey[0] = 4;
  applicationKey[1] = keyByte;
  return {
    endpoint,
    expirationTime: null,
    options: {
      userVisibleOnly: true,
      applicationServerKey: applicationKey.buffer,
    },
    getKey: vi.fn(),
    unsubscribe: vi.fn().mockImplementation(async () => {
      mocks.order.push('unsubscribe');
      return true;
    }),
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'public', auth: 'auth' },
    }),
  };
}

let permission: NotificationPermission;
let requestPermission: ReturnType<
  typeof vi.fn<() => Promise<NotificationPermission>>
>;
let currentSubscription: PushSubscription | null;
let registration: ServiceWorkerRegistration;

beforeEach(() => {
  permission = 'default';
  currentSubscription = null;
  mocks.order.length = 0;
  mocks.fetchConfig.mockReset().mockResolvedValue({
    enabled: true,
    threshold: 1000,
    keyId: 'v1',
    applicationServerKey: 'public-key',
    turnstileSiteKey: 'turnstile-site-key',
  });
  mocks.putSubscription.mockReset().mockImplementation(async () => {
    mocks.order.push('put');
  });
  mocks.deleteSubscription.mockReset().mockResolvedValue(undefined);
  mocks.requestTurnstile.mockReset().mockImplementation(async () => {
    mocks.order.push('turnstile');
    return 'turnstile-token';
  });

  requestPermission = vi.fn().mockImplementation(async () => {
    mocks.order.push('permission');
    permission = 'granted';
    return 'granted';
  });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      get permission() {
        return permission;
      },
      requestPermission,
    },
  });
  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    value: class PushManager {},
  });
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {},
  });

  registration = {
    pushManager: {
      getSubscription: vi.fn(async () => currentSubscription),
      subscribe: vi.fn(async () => {
        mocks.order.push('subscribe');
        currentSubscription = makeSubscription();
        return currentSubscription;
      }),
    },
  } as unknown as ServiceWorkerRegistration;
  mocks.getRegistration.mockReset().mockResolvedValue(registration);
});

describe('PushNotificationOptIn', () => {
  it('appears only after story engagement and enrolls from its click', async () => {
    render(<PushNotificationOptIn />);
    await waitFor(() => expect(mocks.fetchConfig).toHaveBeenCalled());
    expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();

    window.dispatchEvent(new Event(STORY_INTERACTION_EVENT));
    expect(
      await screen.findByRole('button', { name: 'Enable alerts' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enable alerts' }));

    await waitFor(() => {
      expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
    });
    expect(mocks.order).toEqual(['permission', 'subscribe', 'turnstile', 'put']);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(localStorage.getItem('push:offer-handled')).toBe('1');
    await expect(readPushState()).resolves.toMatchObject({
      token: GENERATED_TOKEN,
    });
  });

  it('dismisses the one-time offer without requesting permission', async () => {
    localStorage.setItem('viewed', '[1]');
    render(<PushNotificationOptIn />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Dismiss notification offer',
      }),
    );
    expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(localStorage.getItem('push:offer-handled')).toBe('1');
  });

  it('keeps a repair action when anonymous admission cannot complete', async () => {
    localStorage.setItem('viewed', '[1]');
    mocks.requestTurnstile.mockRejectedValue(new Error('turnstile_unavailable'));
    render(<PushNotificationOptIn />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable alerts' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Repair alerts' }),
    ).toBeInTheDocument();
    expect(mocks.order).toEqual(['permission', 'subscribe']);
    expect(mocks.putSubscription).not.toHaveBeenCalled();
  });

  it('silently reconciles an intact existing subscription', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', EXISTING_TOKEN);

    render(<PushNotificationOptIn />);
    await waitFor(() => {
      expect(mocks.putSubscription).toHaveBeenCalledWith(
        EXISTING_TOKEN,
        currentSubscription,
        undefined,
        expect.any(AbortSignal),
      );
    });
    expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('bypasses the daily interval when the browser rotates the endpoint', async () => {
    permission = 'granted';
    const prior = makeSubscription(
      0,
      'https://fcm.googleapis.com/fcm/send/prior',
    );
    currentSubscription = makeSubscription(
      0,
      'https://fcm.googleapis.com/fcm/send/rotated',
    );
    const priorFingerprint = await pushSubscriptionFingerprint(prior, 'v1');
    await updatePushState((state) => {
      state.token = EXISTING_TOKEN;
      state.reconciledFingerprint = priorFingerprint;
      state.reconciledAt = Date.now();
      state.keyId = 'v1';
    });

    render(<PushNotificationOptIn />);

    await waitFor(() => {
      expect(mocks.putSubscription).toHaveBeenCalledWith(
        EXISTING_TOKEN,
        currentSubscription,
        undefined,
        expect.any(AbortSignal),
      );
    });
    expect(currentSubscription.unsubscribe).not.toHaveBeenCalled();
    expect((await readPushState()).reconciledFingerprint).not.toBe(
      priorFingerprint,
    );
  });

  it('serializes two concurrent opt-ins around one origin-wide subscription', async () => {
    const view = render(
      <>
        <PushNotificationOptIn />
        <PushNotificationOptIn />
      </>,
    );
    await waitFor(() => expect(mocks.fetchConfig).toHaveBeenCalledTimes(2));
    window.dispatchEvent(new Event(STORY_INTERACTION_EVENT));
    const buttons = await screen.findAllByRole('button', {
      name: 'Enable alerts',
    });

    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledOnce());
    await waitFor(() => {
      expect(
        screen.queryAllByRole('button', { name: 'Enable alerts' }),
      ).toHaveLength(0);
    });
    expect(registration.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(currentSubscription?.unsubscribe).not.toHaveBeenCalled();
    expect(requestPermission).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('requests permission before waiting for the lifecycle lock', async () => {
    localStorage.setItem('viewed', '[1]');
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    const lockRequest = vi.fn(
      async <T,>(
        _name: string,
        callback: () => Promise<T>,
      ): Promise<T> => {
        mocks.order.push('lock');
        return callback();
      },
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: lockRequest },
    });

    try {
      render(<PushNotificationOptIn />);
      const button = await screen.findByRole('button', {
        name: 'Enable alerts',
      }, { timeout: 10_000 });
      mocks.order.length = 0;
      lockRequest.mockClear();

      fireEvent.click(button);

      await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledOnce());
      expect(mocks.order.slice(0, 2)).toEqual(['permission', 'lock']);
      expect(lockRequest).toHaveBeenCalledOnce();
    } finally {
      if (descriptor) {
        Object.defineProperty(navigator, 'locks', descriptor);
      } else {
        Reflect.deleteProperty(navigator, 'locks');
      }
    }
  }, 15_000);

  it('does not unsubscribe a rotated endpoint when refresh finds a retired token', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', EXISTING_TOKEN);
    localStorage.setItem('push:offer-handled', '1');
    mocks.putSubscription
      .mockRejectedValueOnce(new PushApiError(409, 'token_retired'))
      .mockResolvedValueOnce(undefined);

    render(<PushNotificationOptIn />);

    const repair = await screen.findByRole(
      'button',
      { name: 'Repair alerts' },
      { timeout: 10_000 },
    );
    expect(currentSubscription.unsubscribe).not.toHaveBeenCalled();
    fireEvent.click(repair);

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledTimes(2));
    expect(currentSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(mocks.putSubscription.mock.calls[1]?.[0]).toBe(GENERATED_TOKEN);
  }, 15_000);

  it('defers endpoint-conflict replacement to the locked repair action', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', EXISTING_TOKEN);
    localStorage.setItem('push:offer-handled', '1');
    mocks.putSubscription
      .mockRejectedValueOnce(new PushApiError(409, 'endpoint_conflict'))
      .mockResolvedValueOnce(undefined);

    render(<PushNotificationOptIn />);

    const repair = await screen.findByRole(
      'button',
      { name: 'Repair alerts' },
      { timeout: 10_000 },
    );
    expect(currentSubscription.unsubscribe).not.toHaveBeenCalled();
    fireEvent.click(repair);

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledTimes(2));
    expect(mocks.order).toContain('unsubscribe');
    expect(registration.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(mocks.deleteSubscription).toHaveBeenCalledWith(
      EXISTING_TOKEN,
      expect.any(AbortSignal),
    );
    expect(mocks.putSubscription.mock.calls[1]?.[0]).toBe(GENERATED_TOKEN);
  }, 15_000);

  it('offers a transient repair action for a mismatched VAPID key', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription(99);
    localStorage.setItem('push:token', EXISTING_TOKEN);
    localStorage.setItem('push:offer-handled', '1');

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Repair alerts' }),
    );

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalled());
    expect(mocks.order).toEqual(['unsubscribe', 'subscribe', 'put']);
    expect(mocks.putSubscription).toHaveBeenCalledWith(
      EXISTING_TOKEN,
      currentSubscription,
      undefined,
      expect.any(AbortSignal),
    );
    await expect(readPushState()).resolves.toMatchObject({
      token: EXISTING_TOKEN,
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('challenges a known local token only when the backend no longer knows it', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription(99);
    localStorage.setItem('push:token', EXISTING_TOKEN);
    localStorage.setItem('push:offer-handled', '1');
    mocks.putSubscription
      .mockRejectedValueOnce(new PushApiError(403, 'turnstile_required'))
      .mockResolvedValueOnce(undefined);

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Repair alerts' }),
    );

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledTimes(2));
    expect(mocks.putSubscription.mock.calls[0]).toEqual([
      EXISTING_TOKEN,
      currentSubscription,
      undefined,
      expect.any(AbortSignal),
    ]);
    expect(mocks.putSubscription.mock.calls[1]).toEqual([
      EXISTING_TOKEN,
      currentSubscription,
      'turnstile-token',
      expect.any(AbortSignal),
    ]);
    expect(mocks.requestTurnstile).toHaveBeenCalledOnce();
  });

  it('keeps an intact installation reconciled when new enrollment is full', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', EXISTING_TOKEN);
    mocks.fetchConfig.mockResolvedValue({
      enabled: false,
      threshold: 1000,
      keyId: 'v1',
      applicationServerKey: 'public-key',
      turnstileSiteKey: 'turnstile-site-key',
    });

    render(<PushNotificationOptIn />);

    await waitFor(() => {
      expect(mocks.putSubscription).toHaveBeenCalledWith(
        EXISTING_TOKEN,
        currentSubscription,
        undefined,
        expect.any(AbortSignal),
      );
    });
    expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
  });

  it('retires the backend token when browser permission is denied', async () => {
    permission = 'denied';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', EXISTING_TOKEN);

    render(<PushNotificationOptIn />);

    await waitFor(() => {
      expect(currentSubscription?.unsubscribe).toHaveBeenCalled();
      expect(mocks.deleteSubscription).toHaveBeenCalledWith(
        EXISTING_TOKEN,
        expect.any(AbortSignal),
      );
    });
    await expect(readPushState()).resolves.toMatchObject({
      token: null,
      pendingDeleteTokens: [],
    });
    expect(localStorage.getItem('push:offer-handled')).toBe('1');
  });

  it('keeps and later flushes a denied installation deletion while offline', async () => {
    permission = 'denied';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', EXISTING_TOKEN);
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    mocks.deleteSubscription.mockRejectedValue(new TypeError('offline'));

    render(<PushNotificationOptIn />);

    await waitFor(async () => {
      expect((await readPushState()).pendingDeleteTokens).toEqual([
        EXISTING_TOKEN,
      ]);
    });
    await expect(readPushState()).resolves.toMatchObject({ token: null });

    mocks.deleteSubscription.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event('online'));

    await waitFor(async () => {
      expect((await readPushState()).pendingDeleteTokens).toEqual([]);
    });
  });

  it('uses a fresh token when a repaired server tombstone rejects the old one', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription(99);
    localStorage.setItem('push:token', EXISTING_TOKEN);
    localStorage.setItem('push:offer-handled', '1');
    mocks.putSubscription
      .mockRejectedValueOnce(new PushApiError(409, 'token_retired'))
      .mockResolvedValueOnce(undefined);

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Repair alerts' }),
    );

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledTimes(2));
    expect(mocks.putSubscription.mock.calls[0]?.[0]).toBe(EXISTING_TOKEN);
    expect(mocks.deleteSubscription).toHaveBeenCalledWith(
      EXISTING_TOKEN,
      expect.any(AbortSignal),
    );
    expect(mocks.putSubscription.mock.calls[1]?.[0]).toBe(GENERATED_TOKEN);
    await expect(readPushState()).resolves.toMatchObject({
      token: GENERATED_TOKEN,
    });
  });

  it('rolls back a subscription rejected by the admission cap', async () => {
    localStorage.setItem('viewed', '[1]');
    mocks.putSubscription.mockRejectedValue(
      new PushApiError(503, 'capacity_full'),
    );

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable alerts' }),
    );

    await waitFor(() => {
      expect(currentSubscription?.unsubscribe).toHaveBeenCalled();
      expect(mocks.deleteSubscription).toHaveBeenCalledWith(
        GENERATED_TOKEN,
        expect.any(AbortSignal),
      );
    });
    await expect(readPushState()).resolves.toMatchObject({ token: null });
    expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
  });

  it('rolls back a subscription after a definitive API validation rejection', async () => {
    localStorage.setItem('viewed', '[1]');
    mocks.putSubscription.mockRejectedValue(
      new PushApiError(400, 'invalid_subscription'),
    );

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable alerts' }),
    );

    await waitFor(() => {
      expect(currentSubscription?.unsubscribe).toHaveBeenCalled();
      expect(mocks.deleteSubscription).toHaveBeenCalledWith(
        GENERATED_TOKEN,
        expect.any(AbortSignal),
      );
    });
    await expect(readPushState()).resolves.toMatchObject({ token: null });
    expect(
      await screen.findByRole('button', { name: 'Repair alerts' }),
    ).toBeInTheDocument();
  });

  it('keeps an uncertain PUT and reconciles it on the next lifecycle event', async () => {
    localStorage.setItem('viewed', '[1]');
    mocks.putSubscription
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(undefined);

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable alerts' }),
    );

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledOnce());
    await expect(readPushState()).resolves.toMatchObject({
      token: GENERATED_TOKEN,
    });
    expect(currentSubscription).not.toBeNull();

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledTimes(2));
    expect((await readPushState()).reconciledAt).toBeGreaterThan(0);
  });

  it('defers focus reconciliation until gesture-driven enrollment finishes', async () => {
    localStorage.setItem('viewed', '[1]');
    let resolvePermission: (() => void) | undefined;
    requestPermission.mockImplementation(() => {
      mocks.order.push('permission');
      return new Promise<NotificationPermission>((resolve) => {
        resolvePermission = () => {
          permission = 'granted';
          resolve('granted');
        };
      });
    });

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable alerts' }),
    );
    await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());

    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(mocks.fetchConfig).toHaveBeenCalledOnce();
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();

    resolvePermission?.();
    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledOnce());
    expect(mocks.order).toEqual(['permission', 'subscribe', 'turnstile', 'put']);
  });

  it('does not let an older delete completion clear a newer pending token', async () => {
    permission = 'denied';
    localStorage.setItem('push:pending-delete', OLD_TOKEN);
    let resolveDelete: (() => void) | undefined;
    mocks.deleteSubscription.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    render(<PushNotificationOptIn />);
    await waitFor(() => {
      expect(mocks.deleteSubscription).toHaveBeenCalledWith(
        OLD_TOKEN,
        expect.any(AbortSignal),
      );
    });
    await updatePushState((state) => {
      state.pendingDeleteTokens.push(NEW_TOKEN);
    });
    resolveDelete?.();

    await waitFor(async () => {
      expect((await readPushState()).pendingDeleteTokens).toEqual([NEW_TOKEN]);
    });
  });

  it('offers repair when browser subscription creation fails after permission', async () => {
    localStorage.setItem('viewed', '[1]');
    registration.pushManager.subscribe = vi.fn(async () => {
      mocks.order.push('subscribe');
      throw new Error('subscription failed');
    });

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enable alerts' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Repair alerts' }),
    ).toBeInTheDocument();
    expect(mocks.order).toEqual(['permission', 'subscribe']);
    expect(mocks.putSubscription).not.toHaveBeenCalled();
  });

  it('does not fetch config or render controls in an unsupported browser', async () => {
    Reflect.deleteProperty(window, 'PushManager');
    localStorage.setItem('viewed', '[1]');

    render(<PushNotificationOptIn />);

    await waitFor(() => {
      expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
    });
    expect(mocks.fetchConfig).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('keeps durable enrollment available when localStorage is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const unavailableStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException('Storage unavailable', 'QuotaExceededError');
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: unavailableStorage,
    });

    try {
      render(<PushNotificationOptIn />);
      window.dispatchEvent(new Event(STORY_INTERACTION_EVENT));
      fireEvent.click(
        await screen.findByRole('button', { name: 'Enable alerts' }),
      );

      await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledOnce());
      await expect(readPushState()).resolves.toMatchObject({
        token: GENERATED_TOKEN,
      });
      expect(requestPermission).toHaveBeenCalledOnce();
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });

  it('does not offer push in an ordinary iOS browser tab', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    });
    try {
      localStorage.setItem('viewed', '[1]');
      render(<PushNotificationOptIn />);

      await waitFor(() => {
        expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
      });
      expect(mocks.fetchConfig).not.toHaveBeenCalled();
      expect(requestPermission).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(navigator, 'userAgent');
    }
  });
});
