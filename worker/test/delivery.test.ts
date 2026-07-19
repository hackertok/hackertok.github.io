import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64Url } from '../src/crypto';
import {
  handleDelivery,
  recoverDeliveryWakes,
  sendSelfTest,
} from '../src/delivery';
import type { Bindings, SubscriptionRow } from '../src/types';

const bindings = env as unknown as Bindings;

async function validSubscriptionKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );
  return {
    p256dh: encodeBase64Url(publicKey),
    auth: encodeBase64Url(
      Uint8Array.from({ length: 16 }, (_, index) => index + 1),
    ),
  };
}

async function seedDelivery(options: {
  id?: number;
  endpoint?: string;
  attempts?: number;
  expiresAt?: number;
  vapidKeyId?: string;
  verifiedAt?: number | null;
} = {}): Promise<void> {
  const now = Date.now();
  const id = options.id ?? 1;
  const keys = await validSubscriptionKeys();
  const endpoint =
    options.endpoint ?? `https://fcm.googleapis.com/fcm/send/delivery-test-${id}`;
  const verifiedAt = Object.hasOwn(options, 'verifiedAt')
    ? options.verifiedAt ?? null
    : now;
  await bindings.PUSH_DB
    .prepare(
      `INSERT INTO subscriptions (
         id, token_hash, endpoint_hash, endpoint, p256dh, auth, vapid_key_id,
         created_at, activated_at, last_reconciled_at, verified_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8, ?9)`,
    )
    .bind(
      id,
      `token-${id}`,
      `endpoint-${id}`,
      endpoint,
      keys.p256dh,
      keys.auth,
      options.vapidKeyId ?? 'v1',
      now,
      verifiedAt,
    )
    .run();
  await bindings.PUSH_DB
    .prepare(
      `INSERT OR IGNORE INTO stories (
         story_id, title, score, verification_state, event_state,
         audience_high_water_id, event_created_at, expires_at,
         created_at, updated_at
       )
       VALUES (404, 'Delivery story', 1200, 'event', 'fanout_complete',
               1, ?1, ?2, ?1, ?1)`,
    )
    .bind(now, now + 12 * 60 * 60 * 1000)
    .run();
  await bindings.PUSH_DB
    .prepare(
      `INSERT INTO deliveries (
         id, story_id, subscription_id, state, attempts, next_attempt_at,
         expires_at, created_at, updated_at
       )
       VALUES (?1, 404, ?1, 'pending', ?2, ?3, ?4, ?3, ?3)`,
    )
    .bind(
      id,
      options.attempts ?? 0,
      now,
      options.expiresAt ?? now + 12 * 60 * 60 * 1000,
    )
    .run();
}

async function deliveryState(id = 1): Promise<{
  state: string;
  attempts: number;
  relay_status: number | null;
  result_class: string | null;
}> {
  const row = await bindings.PUSH_DB
    .prepare(
      `SELECT state, attempts, relay_status, result_class
         FROM deliveries
        WHERE id = ?1`,
    )
    .bind(id)
    .first<{
      state: string;
      attempts: number;
      relay_status: number | null;
      result_class: string | null;
    }>();
  if (!row) throw new Error('missing delivery');
  return row;
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await bindings.PUSH_DB.batch([
    bindings.PUSH_DB.prepare('DELETE FROM deliveries'),
    bindings.PUSH_DB.prepare('DELETE FROM stories'),
    bindings.PUSH_DB.prepare('DELETE FROM subscriptions'),
    bindings.PUSH_DB.prepare(
      `UPDATE app_state
          SET delivery_circuit_until = NULL,
              delivery_circuit_reason = NULL,
              queue_publishing_paused = 0`,
    ),
  ]);
});

describe('native delivery', () => {
  it('quarantines a cutover insert from an older Worker', async () => {
    const now = Date.now();
    const keys = await validSubscriptionKeys();
    await bindings.PUSH_DB
      .prepare(
        `INSERT INTO subscriptions (
           token_hash, endpoint_hash, endpoint, p256dh, auth, vapid_key_id,
           created_at, activated_at, last_reconciled_at
         )
         VALUES ('legacy-token', 'legacy-endpoint',
                 'https://fcm.googleapis.com/fcm/send/legacy',
                 ?1, ?2, 'v1', ?3, ?3, ?3)`,
      )
      .bind(keys.p256dh, keys.auth, now)
      .run();

    const subscription = await bindings.PUSH_DB
      .prepare('SELECT verified_at FROM subscriptions WHERE token_hash = ?1')
      .bind('legacy-token')
      .first<{ verified_at: number | null }>();
    expect(subscription?.verified_at).toBe(0);
  });

  it('builds an RFC 8291 encrypted request and records relay acceptance', async () => {
    await seedDelivery({ verifiedAt: null });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 201 }),
    );

    const outcome = await handleDelivery(bindings, 1);
    expect(outcome).toEqual({});
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toContain('vapid t=');
    expect(headers.get('content-encoding')).toBe('aes128gcm');
    expect(headers.get('encryption')).toBeNull();
    expect(headers.get('crypto-key')).toBeNull();
    expect(headers.get('topic')).toBe('hn-404');
    if (!(init?.body instanceof Uint8Array)) {
      throw new Error('Expected an RFC 8188 binary body');
    }
    expect(init.body.byteLength).toBeGreaterThan(86);
    expect(init.body[20]).toBe(65);
    expect(await deliveryState()).toEqual({
      state: 'accepted',
      attempts: 1,
      relay_status: 201,
      result_class: 'accepted',
    });
    const subscription = await bindings.PUSH_DB
      .prepare('SELECT verified_at FROM subscriptions WHERE id = 1')
      .first<{ verified_at: number | null }>();
    expect(subscription?.verified_at).not.toBeNull();
  });

  it('scrubs a subscription when its relay endpoint is gone', async () => {
    await seedDelivery();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 410 }),
    );

    await handleDelivery(bindings, 1);
    expect((await deliveryState()).state).toBe('terminal');
    const subscription = await bindings.PUSH_DB
      .prepare(
        `SELECT endpoint, p256dh, auth, disabled_reason
           FROM subscriptions
          WHERE id = 1`,
      )
      .first<{
        endpoint: string | null;
        p256dh: string | null;
        auth: string | null;
        disabled_reason: string | null;
      }>();
    expect(subscription).toEqual({
      endpoint: null,
      p256dh: null,
      auth: null,
      disabled_reason: 'relay_gone',
    });
  });

  it('does not let a stale relay response disable a rotated endpoint', async () => {
    await seedDelivery();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await bindings.PUSH_DB
        .prepare(
          `UPDATE subscriptions
              SET endpoint_hash = 'rotated-hash',
                  endpoint = 'https://fcm.googleapis.com/fcm/send/rotated',
                  last_reconciled_at = ?1
            WHERE id = 1`,
        )
        .bind(Date.now())
        .run();
      return new Response(null, { status: 410 });
    });

    const outcome = await handleDelivery(bindings, 1);

    const subscription = await bindings.PUSH_DB
      .prepare(
        `SELECT endpoint, disabled_at
           FROM subscriptions
          WHERE id = 1`,
      )
      .first<{ endpoint: string | null; disabled_at: number | null }>();
    expect(subscription).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/rotated',
      disabled_at: null,
    });
    expect(outcome).toEqual({ retryAfterSeconds: 1 });
    expect(await deliveryState()).toMatchObject({
      state: 'retry',
      result_class: 'subscription_rotated',
    });
  });

  it('persists bounded retry timing for transient relay failures', async () => {
    await seedDelivery();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { 'retry-after': '2' },
      }),
    );

    const outcome = await handleDelivery(bindings, 1);
    expect(outcome).toEqual({ retryAfterSeconds: 2 });
    expect(await deliveryState()).toMatchObject({
      state: 'retry',
      attempts: 1,
      relay_status: 429,
      result_class: 'relay_transient',
    });
  });

  it('keeps one verified VAPID failure local while awaiting correlation', async () => {
    await seedDelivery();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await handleDelivery(bindings, 1);
    expect(await deliveryState()).toMatchObject({
      state: 'paused',
      relay_status: 403,
      result_class: 'relay_auth_suspect',
    });
    const state = await bindings.PUSH_DB
      .prepare(
        `SELECT delivery_circuit_until, delivery_circuit_reason
           FROM app_state
          WHERE id = 1`,
      )
      .first<{
        delivery_circuit_until: number | null;
        delivery_circuit_reason: string | null;
      }>();
    expect(state).toEqual({
      delivery_circuit_until: null,
      delivery_circuit_reason: null,
    });
    const subscription = await bindings.PUSH_DB
      .prepare('SELECT disabled_at FROM subscriptions WHERE id = 1')
      .first<{ disabled_at: number | null }>();
    expect(subscription?.disabled_at).toBeNull();
  });

  it('opens the auth circuit only after three verified subscriptions correlate', async () => {
    await seedDelivery({ id: 1 });
    await seedDelivery({ id: 2 });
    await seedDelivery({ id: 3 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await handleDelivery(bindings, 1);
    await handleDelivery(bindings, 2);
    await handleDelivery(bindings, 3);

    const state = await bindings.PUSH_DB
      .prepare(
        `SELECT delivery_circuit_until, delivery_circuit_reason
           FROM app_state
          WHERE id = 1`,
      )
      .first<{
        delivery_circuit_until: number | null;
        delivery_circuit_reason: string | null;
      }>();
    expect(state?.delivery_circuit_until).toBeGreaterThan(Date.now());
    expect(state?.delivery_circuit_reason).toBe('vapid_or_provider_auth');
    expect(await deliveryState(3)).toMatchObject({
      state: 'paused',
      result_class: 'relay_auth_suspect',
    });
  });

  it('isolates an unverified auth failure to that subscription', async () => {
    await seedDelivery({ verifiedAt: null });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await handleDelivery(bindings, 1);

    expect(await deliveryState()).toMatchObject({
      state: 'terminal',
      result_class: 'unverified_relay_auth_suspect',
    });
    const state = await bindings.PUSH_DB
      .prepare(
        `SELECT s.disabled_reason, a.delivery_circuit_until
           FROM subscriptions s
           CROSS JOIN app_state a
          WHERE s.id = 1 AND a.id = 1`,
      )
      .first<{
        disabled_reason: string | null;
        delivery_circuit_until: number | null;
      }>();
    expect(state).toEqual({
      disabled_reason: 'unverified_relay_rejected',
      delivery_circuit_until: null,
    });
  });

  it('keeps a legacy installation local and non-destructive until verified', async () => {
    await seedDelivery({ verifiedAt: 0 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await handleDelivery(bindings, 1);

    expect(await deliveryState()).toMatchObject({
      state: 'paused',
      result_class: 'relay_auth_suspect',
    });
    const state = await bindings.PUSH_DB
      .prepare(
        `SELECT s.disabled_at, s.verified_at, a.delivery_circuit_until
           FROM subscriptions s
           CROSS JOIN app_state a
          WHERE s.id = 1 AND a.id = 1`,
      )
      .first<{
        disabled_at: number | null;
        verified_at: number | null;
        delivery_circuit_until: number | null;
      }>();
    expect(state).toEqual({
      disabled_at: null,
      verified_at: 0,
      delivery_circuit_until: null,
    });
  });

  it('does not let a stale unverified rejection erase newer verification', async () => {
    await seedDelivery({ verifiedAt: null });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await bindings.PUSH_DB
        .prepare('UPDATE subscriptions SET verified_at = ?1 WHERE id = 1')
        .bind(Date.now())
        .run();
      return new Response(null, { status: 403 });
    });

    const outcome = await handleDelivery(bindings, 1);

    expect(outcome).toEqual({ retryAfterSeconds: 1 });
    expect(await deliveryState()).toMatchObject({
      state: 'retry',
      result_class: 'subscription_rotated',
    });
    const subscription = await bindings.PUSH_DB
      .prepare('SELECT disabled_at, verified_at FROM subscriptions WHERE id = 1')
      .first<{ disabled_at: number | null; verified_at: number | null }>();
    expect(subscription?.disabled_at).toBeNull();
    expect(subscription?.verified_at).toBeGreaterThan(0);
  });

  it('does not refresh stale fault evidence during recovery', async () => {
    const now = Date.now();
    await seedDelivery({ id: 1 });
    await seedDelivery({ id: 2 });
    await seedDelivery({ id: 3 });
    await bindings.PUSH_DB
      .prepare(
        `UPDATE deliveries
            SET state = 'paused',
                result_class = 'relay_auth_suspect',
                relay_fault_at = ?1,
                relay_fault_reconciled_at = (
                  SELECT last_reconciled_at
                    FROM subscriptions
                   WHERE subscriptions.id = deliveries.subscription_id
                ),
                next_attempt_at = ?2,
                updated_at = ?2
          WHERE id IN (1, 2)`,
      )
      .bind(now - 10 * 60 * 1000, now)
      .run();
    await recoverDeliveryWakes(bindings);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await handleDelivery(bindings, 3);

    const state = await bindings.PUSH_DB
      .prepare('SELECT delivery_circuit_until FROM app_state WHERE id = 1')
      .first<{ delivery_circuit_until: number | null }>();
    expect(state?.delivery_circuit_until).toBeNull();
  });

  it('bounds repeated verified relay suspects by the attempt budget', async () => {
    await seedDelivery({ attempts: 5 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await handleDelivery(bindings, 1);

    expect(await deliveryState()).toMatchObject({
      state: 'terminal',
      attempts: 6,
      result_class: 'retry_exhausted',
    });
  });

  it('never opens the global circuit from a public self-test', async () => {
    await seedDelivery();
    const subscription = await bindings.PUSH_DB
      .prepare('SELECT * FROM subscriptions WHERE id = 1')
      .first<SubscriptionRow>();
    if (!subscription) throw new Error('missing subscription');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await expect(sendSelfTest(bindings, subscription)).rejects.toMatchObject({
      status: 503,
      code: 'relay_unavailable',
    });
    const state = await bindings.PUSH_DB
      .prepare(
        `SELECT delivery_circuit_until, delivery_circuit_reason
           FROM app_state
          WHERE id = 1`,
      )
      .first<{
        delivery_circuit_until: number | null;
        delivery_circuit_reason: string | null;
      }>();
    expect(state).toEqual({
      delivery_circuit_until: null,
      delivery_circuit_reason: null,
    });

    const locallyInvalid = {
      ...subscription,
      endpoint: 'https://attacker.example/push',
    };
    await expect(sendSelfTest(bindings, locallyInvalid)).rejects.toMatchObject({
      status: 503,
      code: 'sender_unavailable',
    });
    const unchanged = await bindings.PUSH_DB
      .prepare(
        `SELECT delivery_circuit_until, delivery_circuit_reason
           FROM app_state
          WHERE id = 1`,
      )
      .first<{
        delivery_circuit_until: number | null;
        delivery_circuit_reason: string | null;
      }>();
    expect(unchanged).toEqual({
      delivery_circuit_until: null,
      delivery_circuit_reason: null,
    });
  });

  it('pauses locally-invalid relay endpoints without making a request', async () => {
    await seedDelivery({ endpoint: 'https://attacker.example/push' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await handleDelivery(bindings, 1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await deliveryState()).toMatchObject({
      state: 'paused',
      result_class: 'sender_or_payload_fault',
    });
  });

  it('terminalizes a transient failure after the attempt budget', async () => {
    await seedDelivery({ attempts: 5 });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'));

    await handleDelivery(bindings, 1);
    expect(await deliveryState()).toMatchObject({
      state: 'terminal',
      attempts: 6,
      result_class: 'retry_exhausted',
    });
  });

  it('uses a fenced claim so duplicate queue wakes send only once', async () => {
    await seedDelivery();
    let release: ((response: Response) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );

    const first = handleDelivery(bindings, 1);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    await expect(handleDelivery(bindings, 1)).resolves.toEqual({});
    expect(fetchSpy).toHaveBeenCalledOnce();

    release?.(new Response(null, { status: 201 }));
    await expect(first).resolves.toEqual({});
    expect((await deliveryState()).state).toBe('accepted');
  });

  it('recovers a committed delivery whose queue wake was lost', async () => {
    await seedDelivery();

    await recoverDeliveryWakes(bindings);

    const delivery = await bindings.PUSH_DB
      .prepare('SELECT wake_at FROM deliveries WHERE id = 1')
      .first<{ wake_at: number | null }>();
    expect(delivery?.wake_at).not.toBeNull();
  });

  it('does not publish recovery wakes while the delivery circuit is open', async () => {
    await seedDelivery();
    await bindings.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET delivery_circuit_until = ?1,
                delivery_circuit_reason = 'test'
          WHERE id = 1`,
      )
      .bind(Date.now() + 60_000)
      .run();

    await recoverDeliveryWakes(bindings);

    const delivery = await bindings.PUSH_DB
      .prepare('SELECT wake_at FROM deliveries WHERE id = 1')
      .first<{ wake_at: number | null }>();
    expect(delivery?.wake_at).toBeNull();
  });

  it('terminalizes absolute expiry without contacting a relay', async () => {
    await seedDelivery({ expiresAt: Date.now() - 1 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await recoverDeliveryWakes(bindings);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await deliveryState()).toMatchObject({
      state: 'terminal',
      attempts: 0,
      result_class: 'expired',
    });
  });

  it('rejects redirects and opens the sender circuit', async () => {
    await seedDelivery();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.example/push' },
      }),
    );

    await handleDelivery(bindings, 1);

    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
    expect(await deliveryState()).toMatchObject({
      state: 'paused',
      relay_status: 302,
      result_class: 'relay_sender_suspect',
    });
  });

  it('terminalizes an ordinary relay 4xx without deleting the device', async () => {
    await seedDelivery();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 422 }),
    );

    await handleDelivery(bindings, 1);

    expect(await deliveryState()).toMatchObject({
      state: 'terminal',
      relay_status: 422,
      result_class: 'relay_terminal',
    });
    const subscription = await bindings.PUSH_DB
      .prepare('SELECT disabled_at FROM subscriptions WHERE id = 1')
      .first<{ disabled_at: number | null }>();
    expect(subscription?.disabled_at).toBeNull();
  });

  it('scrubs a subscription enrolled under a retired VAPID key', async () => {
    await seedDelivery({ vapidKeyId: 'retired' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await handleDelivery(bindings, 1);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await deliveryState()).toMatchObject({
      state: 'terminal',
      result_class: 'vapid_key_rotated',
    });
    const subscription = await bindings.PUSH_DB
      .prepare(
        `SELECT endpoint, disabled_reason
           FROM subscriptions
          WHERE id = 1`,
      )
      .first<{ endpoint: string | null; disabled_reason: string | null }>();
    expect(subscription).toEqual({
      endpoint: null,
      disabled_reason: 'vapid_key_rotated',
    });
  });

  it('isolates an invalid device curve point without opening the global circuit', async () => {
    await seedDelivery();
    const invalidPoint = encodeBase64Url(
      Uint8Array.from({ length: 65 }, (_, index) => (
        index === 0 ? 4 : index
      )),
    );
    await bindings.PUSH_DB
      .prepare('UPDATE subscriptions SET p256dh = ?1 WHERE id = 1')
      .bind(invalidPoint)
      .run();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await handleDelivery(bindings, 1);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await deliveryState()).toMatchObject({
      state: 'terminal',
      result_class: 'invalid_device_key',
    });
    const state = await bindings.PUSH_DB
      .prepare(
        `SELECT s.endpoint, s.disabled_reason, a.delivery_circuit_until
           FROM subscriptions s
           CROSS JOIN app_state a
          WHERE s.id = 1 AND a.id = 1`,
      )
      .first<{
        endpoint: string | null;
        disabled_reason: string | null;
        delivery_circuit_until: number | null;
      }>();
    expect(state).toEqual({
      endpoint: null,
      disabled_reason: 'invalid_device_key',
      delivery_circuit_until: null,
    });
  });
});
