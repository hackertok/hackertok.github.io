import {
  CLEANUP_BATCH_SIZE,
  TERMINAL_DELIVERY_RETENTION_MS,
  TOMBSTONE_RETENTION_MS,
} from './constants';
import type { Bindings } from './types';

const STORY_DETAIL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function runCleanup(env: Bindings): Promise<void> {
  const now = Date.now();

  await env.PUSH_DB
    .prepare(
      `UPDATE subscriptions
          SET endpoint_hash = NULL,
              endpoint = NULL,
              p256dh = NULL,
              auth = NULL,
              disabled_at = COALESCE(disabled_at, ?1),
              disabled_reason = COALESCE(disabled_reason, 'subscription_expired'),
              tombstone_until = MAX(
                COALESCE(tombstone_until, 0),
                ?2
              )
        WHERE id IN (
          SELECT id
            FROM subscriptions
           WHERE disabled_at IS NULL
             AND expires_at IS NOT NULL
             AND expires_at <= ?1
           ORDER BY id
           LIMIT ?3
        )`,
    )
    .bind(now, now + TOMBSTONE_RETENTION_MS, CLEANUP_BATCH_SIZE)
    .run();

  const state = await env.PUSH_DB
    .prepare('SELECT cleanup_cursor FROM app_state WHERE id = 1')
    .first<{ cleanup_cursor: number }>();
  const cursor = state?.cleanup_cursor ?? 0;
  const rows = await env.PUSH_DB
    .prepare(
      `SELECT id
         FROM deliveries
        WHERE id > ?1
          AND state IN ('accepted', 'terminal')
          AND COALESCE(terminal_at, accepted_at, updated_at) <= ?2
        ORDER BY id
        LIMIT ?3`,
    )
    .bind(cursor, now - TERMINAL_DELIVERY_RETENTION_MS, CLEANUP_BATCH_SIZE)
    .all<{ id: number }>();

  const lastId = rows.results[rows.results.length - 1]?.id;
  if (lastId) {
    await env.PUSH_DB.batch([
      env.PUSH_DB
        .prepare(
          `DELETE FROM deliveries
            WHERE id > ?1
              AND id <= ?2
              AND state IN ('accepted', 'terminal')
              AND COALESCE(terminal_at, accepted_at, updated_at) <= ?3`,
        )
        .bind(cursor, lastId, now - TERMINAL_DELIVERY_RETENTION_MS),
      env.PUSH_DB
        .prepare(
          `UPDATE app_state
              SET cleanup_cursor = ?1,
                  updated_at = ?2
            WHERE id = 1`,
        )
        .bind(lastId, now),
    ]);
  } else if (cursor !== 0) {
    await env.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET cleanup_cursor = 0,
                updated_at = ?1
          WHERE id = 1`,
      )
      .bind(now)
      .run();
  }

  await env.PUSH_DB.batch([
    env.PUSH_DB
      .prepare(
        `DELETE FROM subscriptions
          WHERE id IN (
            SELECT id
              FROM subscriptions
             WHERE disabled_at IS NOT NULL
               AND tombstone_until IS NOT NULL
               AND tombstone_until <= ?1
               AND NOT EXISTS (
                 SELECT 1
                   FROM deliveries
                  WHERE deliveries.subscription_id = subscriptions.id
               )
             ORDER BY id
             LIMIT ?2
          )`,
      )
      .bind(now, CLEANUP_BATCH_SIZE),
    env.PUSH_DB
      .prepare(
        `UPDATE stories
            SET title = NULL,
                score = NULL,
                last_verification_error = NULL,
                updated_at = ?1
          WHERE story_id IN (
            SELECT story_id
              FROM stories
             WHERE event_state IN ('none', 'fanout_complete')
               AND updated_at <= ?2
               AND title IS NOT NULL
             ORDER BY story_id
             LIMIT ?3
          )`,
      )
      .bind(now, now - STORY_DETAIL_RETENTION_MS, CLEANUP_BATCH_SIZE),
  ]);
}
