import { describe, expect, it, vi } from 'vitest';
import {
  applicationServerKey,
  createPushToken,
  fetchPushConfig,
  pushApiOrigin,
  serializeSubscription,
} from './push';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

describe('push API helpers', () => {
  it('decodes and validates an uncompressed P-256 application key', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, index) => (
      index === 0 ? 4 : index
    ));
    expect(applicationServerKey(base64Url(bytes))).toEqual(bytes);
    expect(() => applicationServerKey(base64Url(bytes.slice(1)))).toThrow(
      'invalid_config',
    );
  });

  it('creates a 32-byte base64url bearer token', () => {
    const getRandomValues = vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      (array) => {
        (array as Uint8Array).fill(7);
        return array;
      },
    );
    const token = createPushToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('serializes only the browser subscription fields the API accepts', () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      expirationTime: null,
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/test',
        expirationTime: null,
        keys: { p256dh: 'public', auth: 'secret' },
      }),
    } as unknown as PushSubscription;
    expect(serializeSubscription(subscription)).toEqual({
      endpoint: subscription.endpoint,
      expirationTime: null,
      keys: { p256dh: 'public', auth: 'secret' },
    });
  });

  it('stays disabled when a preview build omits the API origin', async () => {
    expect(pushApiOrigin()).toBeNull();
    await expect(fetchPushConfig()).resolves.toEqual({
      enabled: false,
      threshold: 1000,
      keyId: '',
      applicationServerKey: '',
      turnstileSiteKey: '',
    });
  });
});
