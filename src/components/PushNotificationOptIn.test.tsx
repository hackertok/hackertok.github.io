import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PushApiError } from '../api/push';
import { STORY_INTERACTION_EVENT } from '../utils/storyInteraction';
import { PushNotificationOptIn } from './PushNotificationOptIn';

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
    createPushToken: () => 'test-token',
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

function makeSubscription(keyByte = 0): PushSubscription {
  const applicationKey = new Uint8Array(65);
  applicationKey[0] = 4;
  applicationKey[1] = keyByte;
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test',
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
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
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
    expect(localStorage.getItem('push:token')).toBe('test-token');
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
    localStorage.setItem('push:token', 'existing-token');

    render(<PushNotificationOptIn />);
    await waitFor(() => {
      expect(mocks.putSubscription).toHaveBeenCalledWith(
        'existing-token',
        currentSubscription,
      );
    });
    expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('offers a transient repair action for a mismatched VAPID key', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription(99);
    localStorage.setItem('push:token', 'existing-token');
    localStorage.setItem('push:offer-handled', '1');

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Repair alerts' }),
    );

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalled());
    expect(mocks.order).toEqual(['unsubscribe', 'subscribe', 'put']);
    expect(mocks.putSubscription).toHaveBeenCalledWith(
      'existing-token',
      currentSubscription,
    );
    expect(localStorage.getItem('push:token')).toBe('existing-token');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('challenges a known local token only when the backend no longer knows it', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription(99);
    localStorage.setItem('push:token', 'existing-token');
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
      'existing-token',
      currentSubscription,
    ]);
    expect(mocks.putSubscription.mock.calls[1]).toEqual([
      'existing-token',
      currentSubscription,
      'turnstile-token',
    ]);
    expect(mocks.requestTurnstile).toHaveBeenCalledOnce();
  });

  it('keeps an intact installation reconciled when new enrollment is full', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', 'existing-token');
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
        'existing-token',
        currentSubscription,
      );
    });
    expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
  });

  it('retires the backend token when browser permission is denied', async () => {
    permission = 'denied';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', 'existing-token');

    render(<PushNotificationOptIn />);

    await waitFor(() => {
      expect(currentSubscription?.unsubscribe).toHaveBeenCalled();
      expect(mocks.deleteSubscription).toHaveBeenCalledWith('existing-token');
    });
    expect(localStorage.getItem('push:token')).toBeNull();
    expect(localStorage.getItem('push:pending-delete')).toBeNull();
    expect(localStorage.getItem('push:offer-handled')).toBe('1');
  });

  it('keeps and later flushes a denied installation deletion while offline', async () => {
    permission = 'denied';
    currentSubscription = makeSubscription();
    localStorage.setItem('push:token', 'existing-token');
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    mocks.deleteSubscription.mockRejectedValue(new TypeError('offline'));

    render(<PushNotificationOptIn />);

    await waitFor(() => {
      expect(localStorage.getItem('push:pending-delete')).toBe('existing-token');
    });
    expect(localStorage.getItem('push:token')).toBeNull();

    mocks.deleteSubscription.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event('online'));

    await waitFor(() => {
      expect(localStorage.getItem('push:pending-delete')).toBeNull();
    });
  });

  it('uses a fresh token when a repaired server tombstone rejects the old one', async () => {
    permission = 'granted';
    currentSubscription = makeSubscription(99);
    localStorage.setItem('push:token', 'existing-token');
    localStorage.setItem('push:offer-handled', '1');
    mocks.putSubscription
      .mockRejectedValueOnce(new PushApiError(409, 'subscription_conflict'))
      .mockResolvedValueOnce(undefined);

    render(<PushNotificationOptIn />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Repair alerts' }),
    );

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledTimes(2));
    expect(mocks.putSubscription.mock.calls[0]?.[0]).toBe('existing-token');
    expect(mocks.deleteSubscription).toHaveBeenCalledWith('existing-token');
    expect(mocks.putSubscription.mock.calls[1]?.[0]).toBe('test-token');
    expect(localStorage.getItem('push:token')).toBe('test-token');
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
      expect(mocks.deleteSubscription).toHaveBeenCalledWith('test-token');
    });
    expect(localStorage.getItem('push:token')).toBeNull();
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
      expect(mocks.deleteSubscription).toHaveBeenCalledWith('test-token');
    });
    expect(localStorage.getItem('push:token')).toBeNull();
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
    expect(localStorage.getItem('push:token')).toBe('test-token');
    expect(currentSubscription).not.toBeNull();

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(mocks.putSubscription).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem('push:reconciled-at')).not.toBeNull();
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
    localStorage.setItem('push:pending-delete', 'old-token');
    let resolveDelete: (() => void) | undefined;
    mocks.deleteSubscription.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveDelete = resolve;
      }),
    );

    render(<PushNotificationOptIn />);
    await waitFor(() => {
      expect(mocks.deleteSubscription).toHaveBeenCalledWith('old-token');
    });
    localStorage.setItem(
      'push:pending-delete',
      JSON.stringify(['old-token', 'new-token']),
    );
    resolveDelete?.();

    await waitFor(() => {
      expect(localStorage.getItem('push:pending-delete')).toBe('new-token');
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

  it('does not enroll when durable token storage is unavailable', async () => {
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

      await waitFor(() => {
        expect(screen.queryByTestId('push-notification-opt-in')).toBeNull();
      });
      expect(mocks.fetchConfig).not.toHaveBeenCalled();
      expect(requestPermission).not.toHaveBeenCalled();
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
