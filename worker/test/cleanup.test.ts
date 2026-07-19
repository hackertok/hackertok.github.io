import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../src/cleanup';
import type { Bindings } from '../src/types';

const bindings = env as unknown as Bindings;

beforeEach(async () => {
  await bindings.PUSH_DB.batch([
    bindings.PUSH_DB.prepare('DELETE FROM deliveries'),
    bindings.PUSH_DB.prepare('DELETE FROM stories'),
    bindings.PUSH_DB.prepare('DELETE FROM subscriptions'),
    bindings.PUSH_DB.prepare(
      `UPDATE app_state
          SET cleanup_cursor = 0,
              updated_at = ?1
        WHERE id = 1`,
    ).bind(Date.now()),
  ]);
});

describe('bounded cleanup', () => {
  it('scrubs an expired browser subscription before retaining its tombstone', async () => {
    const now = Date.now();
    await bindings.PUSH_DB
      .prepare(
        `INSERT INTO subscriptions (
           id, token_hash, endpoint_hash, endpoint, p256dh, auth, vapid_key_id,
           created_at, activated_at, last_reconciled_at, expires_at
         )
         VALUES (
           1, 'token', 'endpoint-hash', 'https://fcm.googleapis.com/fcm/send/1',
           'p256dh', 'auth', 'v1', ?1, ?1, ?1, ?2
         )`,
      )
      .bind(now - 1000, now - 1)
      .run();

    await runCleanup(bindings);

    const row = await bindings.PUSH_DB
      .prepare(
        `SELECT endpoint, p256dh, auth, disabled_reason, tombstone_until
           FROM subscriptions
          WHERE id = 1`,
      )
      .first<{
        endpoint: string | null;
        p256dh: string | null;
        auth: string | null;
        disabled_reason: string | null;
        tombstone_until: number | null;
      }>();
    expect(row).toMatchObject({
      endpoint: null,
      p256dh: null,
      auth: null,
      disabled_reason: 'subscription_expired',
    });
    expect(row?.tombstone_until).toBeGreaterThan(now);
  });

  it('deletes old terminal deliveries before their expired subscription tombstone', async () => {
    const now = Date.now();
    const old = now - 31 * 24 * 60 * 60 * 1000;
    await bindings.PUSH_DB.batch([
      bindings.PUSH_DB
        .prepare(
          `INSERT INTO subscriptions (
             id, token_hash, vapid_key_id, created_at, activated_at,
             last_reconciled_at, disabled_at, disabled_reason, tombstone_until
           )
           VALUES (1, 'token', 'v1', ?1, ?1, ?1, ?1, 'user_opt_out', ?1)`,
        )
        .bind(old),
      bindings.PUSH_DB
        .prepare(
          `INSERT INTO stories (
             story_id, title, score, verification_state, event_state,
             event_created_at, expires_at, created_at, updated_at
           )
           VALUES (500, 'Old story', 1200, 'event', 'fanout_complete',
                   ?1, ?2, ?1, ?1)`,
        )
        .bind(old, old + 12 * 60 * 60 * 1000),
    ]);
    await bindings.PUSH_DB
      .prepare(
        `INSERT INTO deliveries (
           id, story_id, subscription_id, state, attempts, next_attempt_at,
           result_class, terminal_at, expires_at, created_at, updated_at
         )
         VALUES (1, 500, 1, 'terminal', 1, ?1, 'user_opt_out', ?1, ?2, ?1, ?1)`,
      )
      .bind(old, old + 12 * 60 * 60 * 1000)
      .run();

    await runCleanup(bindings);

    await expect(
      bindings.PUSH_DB
        .prepare('SELECT COUNT(*) AS count FROM deliveries')
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      bindings.PUSH_DB
        .prepare('SELECT COUNT(*) AS count FROM subscriptions')
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });
  });
});
