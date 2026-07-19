import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleFanout, recoverFanoutWakes } from '../src/fanout';
import type { Bindings } from '../src/types';

const bindings = env as unknown as Bindings;

async function seedSubscription(id: number, now: number): Promise<void> {
  await bindings.PUSH_DB
    .prepare(
      `INSERT INTO subscriptions (
         id, token_hash, endpoint_hash, endpoint, p256dh, auth, vapid_key_id,
         created_at, activated_at, last_reconciled_at
       )
       VALUES (?1, ?2, ?3, ?4, 'p256dh', 'auth', 'v1', ?5, ?5, ?5)`,
    )
    .bind(
      id,
      `token-${id}`,
      `endpoint-${id}`,
      `https://fcm.googleapis.com/fcm/send/${id}`,
      now,
    )
    .run();
}

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

describe('fan-out', () => {
  it('creates one durable delivery per active subscription and completes', async () => {
    const now = Date.now();
    for (let id = 1; id <= 3; id += 1) {
      await seedSubscription(id, now);
    }
    await bindings.PUSH_DB
      .prepare(
        `INSERT INTO stories (
           story_id, title, score, verification_state, event_state,
           audience_high_water_id, event_created_at, expires_at,
           created_at, updated_at
         )
         VALUES (303, 'Story 303', 1001, 'event', 'fanout_pending',
                 3, ?1, ?2, ?1, ?1)`,
      )
      .bind(now, now + 12 * 60 * 60 * 1000)
      .run();

    await handleFanout(bindings, 303);

    const deliveries = await bindings.PUSH_DB
      .prepare(
        `SELECT subscription_id, state
           FROM deliveries
          WHERE story_id = 303
          ORDER BY subscription_id`,
      )
      .all<{ subscription_id: number; state: string }>();
    expect(deliveries.results).toEqual([
      { subscription_id: 1, state: 'pending' },
      { subscription_id: 2, state: 'pending' },
      { subscription_id: 3, state: 'pending' },
    ]);

    const story = await bindings.PUSH_DB
      .prepare(
        `SELECT event_state, fanout_cursor
           FROM stories
          WHERE story_id = 303`,
      )
      .first<{ event_state: string; fanout_cursor: number }>();
    expect(story).toEqual({ event_state: 'fanout_complete', fanout_cursor: 3 });

    await handleFanout(bindings, 303);
    const count = await bindings.PUSH_DB
      .prepare(
        'SELECT COUNT(*) AS count FROM deliveries WHERE story_id = 303',
      )
      .first<{ count: number }>();
    expect(count?.count).toBe(3);
  });

  it('keyset-pages only the audience captured at event creation', async () => {
    const now = Date.now();
    for (let id = 1; id <= 56; id += 1) {
      await seedSubscription(id, now);
    }
    await bindings.PUSH_DB
      .prepare(
        `INSERT INTO stories (
           story_id, title, score, verification_state, event_state,
           audience_high_water_id, event_created_at, expires_at,
           created_at, updated_at
         )
         VALUES (304, 'Paged story', 1001, 'event', 'fanout_pending',
                 55, ?1, ?2, ?1, ?1)`,
      )
      .bind(now, now + 12 * 60 * 60 * 1000)
      .run();

    await handleFanout(bindings, 304);
    const halfway = await bindings.PUSH_DB
      .prepare(
        `SELECT event_state, fanout_cursor
           FROM stories
          WHERE story_id = 304`,
      )
      .first<{ event_state: string; fanout_cursor: number }>();
    expect(halfway).toEqual({ event_state: 'fanout_active', fanout_cursor: 50 });

    await handleFanout(bindings, 304);
    const deliveries = await bindings.PUSH_DB
      .prepare(
        `SELECT COUNT(*) AS count, MAX(subscription_id) AS maximum
           FROM deliveries
          WHERE story_id = 304`,
      )
      .first<{ count: number; maximum: number }>();
    expect(deliveries).toEqual({ count: 55, maximum: 55 });
  });

  it('recovers a committed story whose queue wake was lost', async () => {
    const now = Date.now();
    await bindings.PUSH_DB
      .prepare(
        `INSERT INTO stories (
           story_id, title, score, verification_state, event_state,
           audience_high_water_id, event_created_at, expires_at,
           created_at, updated_at
         )
         VALUES (305, 'Recoverable story', 1001, 'event', 'fanout_pending',
                 0, ?1, ?2, ?1, ?1)`,
      )
      .bind(now, now + 12 * 60 * 60 * 1000)
      .run();

    await recoverFanoutWakes(bindings);

    const story = await bindings.PUSH_DB
      .prepare(
        `SELECT fanout_wake_at
           FROM stories
          WHERE story_id = 305`,
      )
      .first<{ fanout_wake_at: number | null }>();
    expect(story?.fanout_wake_at).not.toBeNull();
  });

  it('leaves fan-out durable without publishing while the circuit is open', async () => {
    const now = Date.now();
    await bindings.PUSH_DB.batch([
      bindings.PUSH_DB
        .prepare(
          `UPDATE app_state
              SET delivery_circuit_until = ?1,
                  delivery_circuit_reason = 'test'
            WHERE id = 1`,
        )
        .bind(now + 60_000),
      bindings.PUSH_DB
        .prepare(
          `INSERT INTO stories (
             story_id, title, score, verification_state, event_state,
             audience_high_water_id, event_created_at, expires_at,
             created_at, updated_at
           )
           VALUES (306, 'Paused story', 1001, 'event', 'fanout_pending',
                   0, ?1, ?2, ?1, ?1)`,
        )
        .bind(now, now + 12 * 60 * 60 * 1000),
    ]);

    await handleFanout(bindings, 306);
    await recoverFanoutWakes(bindings);

    const story = await bindings.PUSH_DB
      .prepare(
        `SELECT event_state, fanout_wake_at
           FROM stories
          WHERE story_id = 306`,
      )
      .first<{ event_state: string; fanout_wake_at: number | null }>();
    expect(story).toEqual({
      event_state: 'fanout_pending',
      fanout_wake_at: null,
    });
  });

  it('honors the operator Queue-budget pause without losing durable work', async () => {
    const now = Date.now();
    await bindings.PUSH_DB.batch([
      bindings.PUSH_DB.prepare(
        `UPDATE app_state
            SET queue_publishing_paused = 1
          WHERE id = 1`,
      ),
      bindings.PUSH_DB
        .prepare(
          `INSERT INTO stories (
             story_id, title, score, verification_state, event_state,
             audience_high_water_id, event_created_at, expires_at,
             created_at, updated_at
           )
           VALUES (307, 'Budget-paused story', 1001, 'event', 'fanout_pending',
                   0, ?1, ?2, ?1, ?1)`,
        )
        .bind(now, now + 12 * 60 * 60 * 1000),
    ]);

    await handleFanout(bindings, 307);
    await recoverFanoutWakes(bindings);

    const story = await bindings.PUSH_DB
      .prepare(
        `SELECT event_state, fanout_wake_at
           FROM stories
          WHERE story_id = 307`,
      )
      .first<{ event_state: string; fanout_wake_at: number | null }>();
    expect(story).toEqual({
      event_state: 'fanout_pending',
      fanout_wake_at: null,
    });
  });
});
