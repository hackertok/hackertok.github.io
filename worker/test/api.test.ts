import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApi } from '../src/api';
import { encodeBase64Url } from '../src/crypto';
import { disableSubscriptionByToken } from '../src/subscriptions';
import type { Bindings } from '../src/types';

const runtimeBindings = env as unknown as Bindings;
const permissiveRateLimiter = {
  limit: async () => ({ success: true }),
} as unknown as RateLimit;
const bindings = new Proxy(runtimeBindings, {
  get(target, property, receiver) {
    return property === 'PUSH_READ_RATE_LIMITER' ||
      property === 'PUSH_WRITE_RATE_LIMITER' ||
      property === 'PUSH_TEST_RATE_LIMITER'
      ? permissiveRateLimiter
      : Reflect.get(target, property, receiver) as unknown;
  },
});
const origin = 'https://hackertok.github.io';

function token(seed: number): string {
  return encodeBase64Url(Uint8Array.from({ length: 32 }, (_, index) => seed + index));
}

function subscription(seed: number): {
  endpoint: string;
  expirationTime: null;
  keys: { p256dh: string; auth: string };
  turnstileToken: string;
} {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/test-${seed}`,
    expirationTime: null,
    keys: {
      p256dh: bindings.VAPID_PUBLIC_KEY,
      auth: encodeBase64Url(
        Uint8Array.from({ length: 16 }, (_, index) => seed + index),
      ),
    },
    turnstileToken: `test-turnstile-${seed}`,
  };
}

function request(
  path: string,
  init: RequestInit = {},
): Request {
  return new Request(`https://push.example${path}`, {
    ...init,
    headers: {
      origin,
      ...init.headers,
    },
  });
}

async function activate(): Promise<void> {
  await bindings.PUSH_DB
    .prepare(
      `UPDATE app_state
          SET phase = 'ACTIVE',
              updated_at = ?1
        WHERE id = 1`,
    )
    .bind(Date.now())
    .run();
}

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
    if (
      url ===
      'https://challenges.cloudflare.com/turnstile/v0/siteverify'
    ) {
      return Response.json({
        success: true,
        action: 'push-enrollment',
        hostname: 'hackertok.github.io',
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  await bindings.PUSH_DB.batch([
    bindings.PUSH_DB.prepare('DELETE FROM deliveries'),
    bindings.PUSH_DB.prepare('DELETE FROM stories'),
    bindings.PUSH_DB.prepare('DELETE FROM subscriptions'),
    bindings.PUSH_DB.prepare(
      `UPDATE app_state
          SET phase = 'BOOTSTRAPPING',
              bootstrap_from = NULL,
              bootstrap_to = NULL,
              bootstrap_page = 0,
              bootstrap_total_pages = NULL,
              detector_lease_token = NULL,
              detector_lease_expires_at = NULL,
              delivery_circuit_until = NULL,
              delivery_circuit_reason = NULL,
              queue_publishing_paused = 0,
              last_successful_scan_at = NULL,
              cleanup_cursor = 0,
              updated_at = ?1
        WHERE id = 1`,
    ).bind(Date.now()),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('push API', () => {
  it('keeps readiness data-free and independent of browser CORS', async () => {
    const pending = await handleApi(
      new Request('https://push.example/health/ready'),
      bindings,
    );
    expect(pending.status).toBe(503);
    expect(pending.headers.get('x-hackertok-release')).toBe(
      bindings.RELEASE_VERSION,
    );
    await expect(pending.text()).resolves.toBe('');
    expect(pending.headers.get('cache-control')).toBe('no-store');
    expect(pending.headers.get('access-control-allow-origin')).toBeNull();

    await activate();
    const ready = await handleApi(
      new Request('https://push.example/health/ready'),
      bindings,
    );
    expect(ready.status).toBe(204);
    expect(ready.headers.get('x-hackertok-release')).toBe(
      bindings.RELEASE_VERSION,
    );
    await expect(ready.text()).resolves.toBe('');
  });

  it('keeps readiness and enrollment closed when the private VAPID key mismatches', async () => {
    await activate();
    const privateJwk = JSON.parse(
      bindings.VAPID_PRIVATE_JWK,
    ) as Record<string, unknown>;
    const mismatchedPrivateJwk = JSON.stringify({
      ...privateJwk,
      d: encodeBase64Url(new Uint8Array(32).fill(1)),
    });
    const misconfigured = new Proxy(bindings, {
      get(target, property, receiver) {
        return property === 'VAPID_PRIVATE_JWK'
          ? mismatchedPrivateJwk
          : Reflect.get(target, property, receiver) as unknown;
      },
    });

    const ready = await handleApi(
      new Request('https://push.example/health/ready'),
      misconfigured,
    );
    expect(ready.status).toBe(503);
    const config = await handleApi(request('/v1/push/config'), misconfigured);
    await expect(config.json()).resolves.toMatchObject({
      enabled: false,
      applicationServerKey: '',
    });
    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token(9)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(subscription(9)),
        }),
        misconfigured,
      ),
    ).rejects.toMatchObject({ status: 503, code: 'not_ready' });
  });

  it('keeps config disabled until bootstrap completes', async () => {
    const response = await handleApi(request('/v1/push/config'), bindings);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: false,
      threshold: 1000,
      turnstileSiteKey: bindings.TURNSTILE_SITE_KEY,
    });
  });

  it('rejects Cloudflare test credentials without the local-only override', async () => {
    await activate();
    const production = new Proxy(bindings, {
      get(target, property, receiver) {
        if (property === 'RELEASE_VERSION') return 'production-release';
        if (property === 'ALLOW_TURNSTILE_TEST_KEYS') return undefined;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const ready = await handleApi(
      new Request('https://push.example/health/ready'),
      production,
    );
    expect(ready.status).toBe(503);
    const config = await handleApi(request('/v1/push/config'), production);
    await expect(config.json()).resolves.toMatchObject({
      enabled: false,
      turnstileSiteKey: '',
    });
  });

  it('creates, reconciles, and tombstones an anonymous subscription', async () => {
    await activate();
    const bearer = token(10);
    const body = JSON.stringify(subscription(10));
    const siteverify = vi.mocked(globalThis.fetch);
    const first = await handleApi(
      request('/v1/push/subscription', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        body,
      }),
      bindings,
    );
    expect(first.status).toBe(201);
    expect(siteverify).toHaveBeenCalledOnce();
    const firstRow = await bindings.PUSH_DB
      .prepare('SELECT id, verified_at FROM subscriptions')
      .first<{ id: number; verified_at: number | null }>();
    expect(firstRow?.verified_at).toBeNull();
    await bindings.PUSH_DB
      .prepare('UPDATE subscriptions SET verified_at = ?1')
      .bind(Date.now())
      .run();
    siteverify.mockClear();
    const reconciled: Partial<ReturnType<typeof subscription>> = subscription(11);
    delete reconciled.turnstileToken;

    const second = await handleApi(
      request('/v1/push/subscription', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(reconciled),
      }),
      bindings,
    );
    expect(second.status).toBe(204);
    expect(siteverify).not.toHaveBeenCalled();

    const count = await bindings.PUSH_DB
      .prepare(
        `SELECT COUNT(*) AS count, MAX(id) AS id, MAX(endpoint) AS endpoint,
                MAX(verified_at) AS verified_at
           FROM subscriptions`,
      )
      .first<{
        count: number;
        id: number;
        endpoint: string;
        verified_at: number | null;
      }>();
    expect(count).toEqual({
      count: 1,
      id: firstRow?.id,
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-11',
      verified_at: null,
    });

    const removed = await handleApi(
      request('/v1/push/subscription', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${bearer}` },
      }),
      bindings,
    );
    expect(removed.status).toBe(204);

    const row = await bindings.PUSH_DB
      .prepare(
        `SELECT endpoint, p256dh, auth, disabled_at
           FROM subscriptions`,
      )
      .first<{
        endpoint: string | null;
        p256dh: string | null;
        auth: string | null;
        disabled_at: number | null;
      }>();
    expect(row).toMatchObject({ endpoint: null, p256dh: null, auth: null });
    expect(row?.disabled_at).not.toBeNull();
  });

  it('distinguishes an endpoint owned by another installation token', async () => {
    await activate();
    const first = subscription(15);
    const created = await handleApi(
      request('/v1/push/subscription', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token(15)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(first),
      }),
      bindings,
    );
    expect(created.status).toBe(201);

    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token(16)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ...subscription(16),
            endpoint: first.endpoint,
          }),
        }),
        bindings,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'endpoint_conflict',
    });
  });

  it('requires and validates Turnstile only for a new token', async () => {
    await activate();
    const input: Partial<ReturnType<typeof subscription>> = subscription(14);
    delete input.turnstileToken;
    const siteverify = vi.mocked(globalThis.fetch);
    siteverify.mockClear();

    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token(14)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(input),
        }),
        bindings,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: 'turnstile_required',
    });
    expect(siteverify).not.toHaveBeenCalled();

    siteverify.mockResolvedValueOnce(Response.json({
      success: false,
      action: 'push-enrollment',
      hostname: 'hackertok.github.io',
    }));
    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token(14)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(subscription(14)),
        }),
        bindings,
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: 'turnstile_rejected',
    });
    const row = await bindings.PUSH_DB
      .prepare('SELECT id FROM subscriptions')
      .first<{ id: number }>();
    expect(row).toBeNull();
  });

  it('tombstones an early opt-out so a delayed PUT cannot resurrect it', async () => {
    await activate();
    const bearer = token(12);
    const removed = await handleApi(
      request('/v1/push/subscription', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${bearer}` },
      }),
      bindings,
    );
    expect(removed.status).toBe(204);

    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(subscription(12)),
        }),
        bindings,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'token_retired',
    });
    await expect(
      bindings.PUSH_DB
        .prepare(
          `SELECT endpoint, disabled_reason
             FROM subscriptions
            WHERE token_hash IS NOT NULL`,
        )
        .first<{ endpoint: string | null; disabled_reason: string | null }>(),
    ).resolves.toEqual({
      endpoint: null,
      disabled_reason: 'user_opt_out',
    });
  });

  it('sends only the fixed self-test payload for the authenticated installation', async () => {
    await activate();
    const bearer = token(13);
    await handleApi(
      request('/v1/push/subscription', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(subscription(13)),
      }),
      bindings,
    );
    const relay = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 201 }),
    );
    relay.mockClear();

    const response = await handleApi(
      request('/v1/push/self-test', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
        },
      }),
      bindings,
    );

    expect(response.status).toBe(202);
    await expect(
      handleApi(
        request('/v1/push/self-test', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ title: 'attacker-controlled' }),
        }),
        bindings,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'body_not_allowed',
    });
    expect(relay).toHaveBeenCalledOnce();
    expect(relay.mock.calls[0]?.[0]).toBe(subscription(13).endpoint);
    expect(relay.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'manual',
    });
  });

  it('rejects untrusted origins and relay hosts', async () => {
    await activate();
    await expect(
      handleApi(
        new Request('https://push.example/v1/push/config', {
          headers: { origin: 'https://attacker.example' },
        }),
        bindings,
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token(20)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ...subscription(20),
            endpoint: 'https://attacker.example/push',
          }),
        }),
        bindings,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts Microsoft Edge WNS relay subdomains', async () => {
    await activate();
    const edgeSubscription = {
      ...subscription(30),
      endpoint: 'https://wns2-db5p.notify.windows.com/w/?token=test',
    };

    const response = await handleApi(
      request('/v1/push/subscription', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token(30)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(edgeSubscription),
      }),
      bindings,
    );

    expect(response.status).toBe(201);
  });

  it('accepts documented Apple push relay subdomains', async () => {
    await activate();
    const appleSubscription = {
      ...subscription(31),
      endpoint: 'https://web.push.apple.com/QHackerTokTest',
    };

    const response = await handleApi(
      request('/v1/push/subscription', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token(31)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(appleSubscription),
      }),
      bindings,
    );

    expect(response.status).toBe(201);
  });

  it('enforces the active subscription cap atomically', async () => {
    await activate();
    const limited = new Proxy(bindings, {
      get(target, property, receiver) {
        return property === 'SUBSCRIPTION_CAP'
          ? '1'
          : Reflect.get(target, property, receiver) as unknown;
      },
    });
    const create = (seed: number) => handleApi(
      request('/v1/push/subscription', {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token(seed)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(subscription(seed)),
      }),
      limited,
    );

    await expect(create(40)).resolves.toMatchObject({ status: 201 });
    const config = await handleApi(request('/v1/push/config'), limited);
    await expect(config.json()).resolves.toMatchObject({ enabled: false });
    await expect(create(41)).rejects.toMatchObject({
      status: 503,
      code: 'capacity_full',
    });
    await expect(
      bindings.PUSH_DB
        .prepare(
          `SELECT active_subscription_count AS count
             FROM app_state
            WHERE id = 1`,
        )
        .first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 1 });

    await handleApi(
      request('/v1/push/subscription', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token(40)}` },
      }),
      limited,
    );
    await expect(
      bindings.PUSH_DB
        .prepare(
          `SELECT active_subscription_count AS count
             FROM app_state
            WHERE id = 1`,
        )
        .first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });
  });

  it('bounds attacker-created opt-out tombstones without blocking admission', async () => {
    await activate();
    const limited = new Proxy(bindings, {
      get(target, property, receiver) {
        return property === 'SUBSCRIPTION_CAP'
          ? '1'
          : Reflect.get(target, property, receiver) as unknown;
      },
    });
    for (const seed of [60, 61, 62, 63]) {
      await handleApi(
        request('/v1/push/subscription', {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token(seed)}` },
        }),
        limited,
      );
    }

    const retained = await bindings.PUSH_DB
      .prepare(
        `SELECT COUNT(*) AS count,
                (
                  SELECT retained_subscription_count
                    FROM app_state
                   WHERE id = 1
                ) AS retained_count
           FROM subscriptions`,
      )
      .first<{ count: number; retained_count: number }>();
    expect(retained).toEqual({ count: 3, retained_count: 3 });
    const firstTombstone = await bindings.PUSH_DB
      .prepare(
        'SELECT token_hash, tombstone_until FROM subscriptions ORDER BY id LIMIT 1',
      )
      .first<{ token_hash: string; tombstone_until: number }>();
    if (!firstTombstone) throw new Error('missing tombstone');
    await disableSubscriptionByToken(
      limited,
      firstTombstone.token_hash,
      'user_opt_out',
      Date.now() + 24 * 60 * 60 * 1000,
      3,
    );
    const replayed = await bindings.PUSH_DB
      .prepare(
        'SELECT tombstone_until FROM subscriptions WHERE token_hash = ?1',
      )
      .bind(firstTombstone.token_hash)
      .first<{ tombstone_until: number }>();
    expect(replayed?.tombstone_until).toBe(firstTombstone.tombstone_until);
    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token(64)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(subscription(64)),
        }),
        limited,
      ),
    ).resolves.toMatchObject({ status: 201 });
  });

  it('rejects a streamed request body beyond 8 KB', async () => {
    await activate();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(8193)));
        controller.close();
      },
    });

    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token(50)}`,
            'content-type': 'application/json',
          },
          body: oversized,
        }),
        bindings,
      ),
    ).rejects.toMatchObject({
      status: 413,
      code: 'body_too_large',
    });
  });

  it('rejects a correctly sized p256dh value that is not on P-256', async () => {
    await activate();
    const invalid = subscription(91);
    invalid.keys.p256dh = encodeBase64Url(
      Uint8Array.from({ length: 65 }, (_, index) => (
        index === 0 ? 4 : index
      )),
    );

    await expect(
      handleApi(
        request('/v1/push/subscription', {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${token(91)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(invalid),
        }),
        bindings,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'invalid_subscription',
    });
  });
});
