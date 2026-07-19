import { FANOUT_LEASE_MS, FANOUT_PAGE_SIZE } from './constants';
import { randomId } from './crypto';
import type {
  Bindings,
  DeliveryMessage,
  FanoutMessage,
  StoryRow,
} from './types';

const STALE_WAKE_MS = 10 * 60 * 1000;

async function completeFanout(
  env: Bindings,
  storyId: number,
  leaseToken: string,
  now: number,
): Promise<void> {
  await env.PUSH_DB
    .prepare(
      `UPDATE stories
          SET event_state = 'fanout_complete',
              fanout_lease_token = NULL,
              fanout_lease_expires_at = NULL,
              fanout_wake_at = NULL,
              updated_at = ?1
        WHERE story_id = ?2
          AND fanout_lease_token = ?3`,
    )
    .bind(now, storyId, leaseToken)
    .run();
}

export async function handleFanout(
  env: Bindings,
  storyId: number,
): Promise<void> {
  if (!Number.isSafeInteger(storyId) || storyId <= 0) return;
  const now = Date.now();
  const leaseToken = randomId();
  const circuit = await env.PUSH_DB
    .prepare(
      `SELECT delivery_circuit_until, queue_publishing_paused
         FROM app_state
        WHERE id = 1`,
    )
    .first<{
      delivery_circuit_until: number | null;
      queue_publishing_paused: 0 | 1;
    }>();
  if (
    circuit?.queue_publishing_paused === 1 ||
    (circuit?.delivery_circuit_until ?? 0) > now
  ) return;

  await env.PUSH_DB
    .prepare(
      `UPDATE stories
          SET event_state = 'fanout_complete',
              fanout_wake_at = NULL,
              fanout_lease_token = NULL,
              fanout_lease_expires_at = NULL,
              updated_at = ?1
        WHERE story_id = ?2
          AND event_state IN ('fanout_pending', 'fanout_active')
          AND expires_at <= ?1`,
    )
    .bind(now, storyId)
    .run();

  const story = await env.PUSH_DB
    .prepare(
      `UPDATE stories
          SET event_state = 'fanout_active',
              fanout_lease_token = ?1,
              fanout_lease_expires_at = ?2,
              fanout_wake_at = NULL,
              updated_at = ?3
        WHERE story_id = ?4
          AND event_state IN ('fanout_pending', 'fanout_active')
          AND expires_at > ?3
          AND (
            fanout_lease_token IS NULL
            OR fanout_lease_expires_at IS NULL
            OR fanout_lease_expires_at <= ?3
          )
        RETURNING *`,
    )
    .bind(leaseToken, now + FANOUT_LEASE_MS, now, storyId)
    .first<StoryRow>();
  if (!story) return;

  const highWater = story.audience_high_water_id ?? 0;
  if (highWater <= story.fanout_cursor) {
    await completeFanout(env, storyId, leaseToken, now);
    return;
  }

  const subscriptions = await env.PUSH_DB
    .prepare(
      `SELECT id
         FROM subscriptions
        WHERE disabled_at IS NULL
          AND id > ?1
          AND id <= ?2
        ORDER BY id
        LIMIT ?3`,
    )
    .bind(story.fanout_cursor, highWater, FANOUT_PAGE_SIZE)
    .all<{ id: number }>();

  if (!subscriptions.results.length) {
    await completeFanout(env, storyId, leaseToken, now);
    return;
  }

  const pageLastId =
    subscriptions.results[subscriptions.results.length - 1]?.id ?? story.fanout_cursor;
  await env.PUSH_DB
    .prepare(
      `INSERT OR IGNORE INTO deliveries (
         story_id, subscription_id, state, attempts, next_attempt_at,
         expires_at, created_at, updated_at
       )
       SELECT ?1, id, 'pending', 0, ?2, ?3, ?2, ?2
         FROM subscriptions
        WHERE disabled_at IS NULL
          AND id > ?4
          AND id <= ?5`,
    )
    .bind(storyId, now, story.expires_at, story.fanout_cursor, pageLastId)
    .run();

  const deliveries = await env.PUSH_DB
    .prepare(
      `SELECT id
         FROM deliveries
        WHERE story_id = ?1
          AND subscription_id > ?2
          AND subscription_id <= ?3
          AND state IN ('pending', 'retry', 'leased')
        ORDER BY id`,
    )
    .bind(storyId, story.fanout_cursor, pageLastId)
    .all<{ id: number }>();

  if (deliveries.results.length) {
    await (env.DELIVERY_QUEUE as Queue<DeliveryMessage>).sendBatch(
      deliveries.results.map(({ id }) => ({
        body: { kind: 'delivery' as const, deliveryId: id },
        contentType: 'json' as const,
      })),
    );
    await env.PUSH_DB
      .prepare(
        `UPDATE deliveries
            SET wake_at = ?1,
                updated_at = ?1
          WHERE story_id = ?2
            AND subscription_id > ?3
            AND subscription_id <= ?4
            AND state IN ('pending', 'retry', 'leased')`,
      )
      .bind(now, storyId, story.fanout_cursor, pageLastId)
      .run();
  }

  const isComplete =
    subscriptions.results.length < FANOUT_PAGE_SIZE || pageLastId >= highWater;
  await env.PUSH_DB
    .prepare(
      `UPDATE stories
          SET fanout_cursor = ?1,
              event_state = ?2,
              fanout_lease_token = NULL,
              fanout_lease_expires_at = NULL,
              fanout_wake_at = NULL,
              updated_at = ?3
        WHERE story_id = ?4
          AND fanout_lease_token = ?5`,
    )
    .bind(
      pageLastId,
      isComplete ? 'fanout_complete' : 'fanout_active',
      now,
      storyId,
      leaseToken,
    )
    .run();

  if (!isComplete) {
    const next: FanoutMessage = { kind: 'fanout', storyId };
    await (env.FANOUT_QUEUE as Queue<FanoutMessage>).send(next);
    await env.PUSH_DB
      .prepare(
        `UPDATE stories
            SET fanout_wake_at = ?1,
                updated_at = ?1
          WHERE story_id = ?2
            AND event_state = 'fanout_active'`,
      )
      .bind(now, storyId)
      .run();
  }
}

export async function recoverFanoutWakes(
  env: Bindings,
  limit = 3,
): Promise<void> {
  const now = Date.now();
  const rows = await env.PUSH_DB
    .prepare(
      `SELECT story_id
         FROM stories
        WHERE event_state IN ('fanout_pending', 'fanout_active')
          AND expires_at > ?1
        AND NOT EXISTS (
          SELECT 1
            FROM app_state
           WHERE id = 1
             AND (
               delivery_circuit_until > ?1
               OR queue_publishing_paused = 1
             )
        )
          AND (
            fanout_lease_expires_at IS NULL
            OR fanout_lease_expires_at <= ?1
          )
          AND (
            fanout_wake_at IS NULL
            OR fanout_wake_at <= ?2
          )
        ORDER BY story_id
        LIMIT ?3`,
    )
    .bind(now, now - STALE_WAKE_MS, limit)
    .all<{ story_id: number }>();

  for (const { story_id } of rows.results) {
    await (env.FANOUT_QUEUE as Queue<FanoutMessage>).send({
      kind: 'fanout',
      storyId: story_id,
    });
    await env.PUSH_DB
      .prepare(
        `UPDATE stories
            SET fanout_wake_at = ?1,
                updated_at = ?1
          WHERE story_id = ?2
            AND event_state IN ('fanout_pending', 'fanout_active')`,
      )
      .bind(now, story_id)
      .run();
  }
}
