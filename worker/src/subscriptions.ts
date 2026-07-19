import { TOMBSTONE_RETENTION_MS } from './constants';
import { HttpError } from './http';
import type {
  AppStateRow,
  Bindings,
  PushSubscriptionInput,
  SubscriptionRow,
} from './types';

export async function appState(db: D1Database): Promise<AppStateRow> {
  const state = await db
    .prepare(
      `SELECT phase, bootstrap_from, bootstrap_to, bootstrap_page,
              bootstrap_total_pages, detector_lease_token,
              detector_lease_expires_at, delivery_circuit_until,
              delivery_circuit_reason, queue_publishing_paused,
              active_subscription_count, last_successful_scan_at, cleanup_cursor
         FROM app_state
        WHERE id = 1`,
    )
    .first<AppStateRow>();
  if (!state) throw new Error('missing app_state');
  return state;
}

export async function putSubscription(
  env: Bindings,
  tokenHash: string,
  endpointHash: string,
  subscription: PushSubscriptionInput,
  now: number,
  cap: number,
): Promise<{ id: number; created: boolean }> {
  const existing = await env.PUSH_DB
    .prepare(
      `SELECT id, disabled_at
         FROM subscriptions
        WHERE token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<{ id: number; disabled_at: number | null }>();

  const endpointOwner = await env.PUSH_DB
    .prepare(
      `SELECT id
         FROM subscriptions
        WHERE endpoint_hash = ?1
          AND token_hash <> ?2
        LIMIT 1`,
    )
    .bind(endpointHash, tokenHash)
    .first<{ id: number }>();

  if (endpointOwner) throw new HttpError(409, 'subscription_conflict');

  const reconcileExisting = async (id: number): Promise<{
    id: number;
    created: false;
  }> => {
    const updated = await env.PUSH_DB
      .prepare(
        `UPDATE subscriptions
            SET endpoint_hash = ?1,
                endpoint = ?2,
                p256dh = ?3,
                auth = ?4,
                vapid_key_id = ?5,
                expires_at = ?6,
                activated_at = ?7,
                last_reconciled_at = MAX(last_reconciled_at + 1, ?7)
          WHERE id = ?8
            AND disabled_at IS NULL`,
      )
      .bind(
        endpointHash,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        env.VAPID_KEY_ID,
        subscription.expirationTime,
        now,
        id,
      )
      .run();
    if (updated.meta.changes !== 1) {
      throw new HttpError(409, 'subscription_conflict');
    }
    return { id, created: false };
  };

  if (existing) {
    if (existing.disabled_at !== null) {
      throw new HttpError(409, 'subscription_conflict');
    }
    return reconcileExisting(existing.id);
  }

  try {
    const inserted = await env.PUSH_DB
      .prepare(
        `INSERT INTO subscriptions (
           token_hash, endpoint_hash, endpoint, p256dh, auth, vapid_key_id,
           created_at, activated_at, last_reconciled_at, expires_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?7, ?8
          WHERE (
            SELECT active_subscription_count
              FROM app_state
             WHERE id = 1
          ) < ?9
         RETURNING id`,
      )
      .bind(
        tokenHash,
        endpointHash,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        env.VAPID_KEY_ID,
        now,
        subscription.expirationTime,
        cap,
      )
      .first<{ id: number }>();

    if (!inserted) {
      const raced = await env.PUSH_DB
        .prepare(
          `SELECT id, disabled_at
             FROM subscriptions
            WHERE token_hash = ?1`,
        )
        .bind(tokenHash)
        .first<{ id: number; disabled_at: number | null }>();
      if (raced?.disabled_at === null) return reconcileExisting(raced.id);
      if (raced) throw new HttpError(409, 'subscription_conflict');
      throw new HttpError(503, 'capacity_full', 3600);
    }
    return { id: inserted.id, created: true };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const raced = await env.PUSH_DB
      .prepare(
        `SELECT id, disabled_at
           FROM subscriptions
          WHERE token_hash = ?1`,
      )
      .bind(tokenHash)
      .first<{ id: number; disabled_at: number | null }>();
    if (raced?.disabled_at === null) return reconcileExisting(raced.id);
    if (raced) throw new HttpError(409, 'subscription_conflict');
    const conflictingEndpoint = await env.PUSH_DB
      .prepare(
        `SELECT id
           FROM subscriptions
          WHERE endpoint_hash = ?1
            AND token_hash <> ?2
          LIMIT 1`,
      )
      .bind(endpointHash, tokenHash)
      .first<{ id: number }>();
    if (conflictingEndpoint) {
      throw new HttpError(409, 'subscription_conflict');
    }
    throw error;
  }
}

export async function subscriptionByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<SubscriptionRow | null> {
  return db
    .prepare('SELECT * FROM subscriptions WHERE token_hash = ?1')
    .bind(tokenHash)
    .first<SubscriptionRow>();
}

export async function activeSubscriptionById(
  db: D1Database,
  id: number,
): Promise<SubscriptionRow | null> {
  return db
    .prepare(
      `SELECT *
         FROM subscriptions
        WHERE id = ?1
          AND disabled_at IS NULL
          AND endpoint IS NOT NULL`,
    )
    .bind(id)
    .first<SubscriptionRow>();
}

export async function disableSubscriptionByToken(
  env: Bindings,
  tokenHash: string,
  reason: string,
  now: number,
): Promise<void> {
  await env.PUSH_DB
    .prepare(
      `INSERT INTO subscriptions (
         token_hash, endpoint_hash, endpoint, p256dh, auth, vapid_key_id,
         created_at, activated_at, last_reconciled_at, expires_at,
         disabled_at, disabled_reason, tombstone_until
       )
       VALUES (?1, NULL, NULL, NULL, NULL, ?2, ?3, ?3, ?3, NULL, ?3, ?4, ?5)
       ON CONFLICT(token_hash) DO UPDATE SET
         endpoint_hash = NULL,
         endpoint = NULL,
         p256dh = NULL,
         auth = NULL,
         disabled_at = COALESCE(subscriptions.disabled_at, excluded.disabled_at),
         disabled_reason = COALESCE(
           subscriptions.disabled_reason,
           excluded.disabled_reason
         ),
         tombstone_until = MAX(
           COALESCE(subscriptions.tombstone_until, 0),
           excluded.tombstone_until
         )`,
    )
    .bind(
      tokenHash,
      env.VAPID_KEY_ID,
      now,
      reason,
      now + TOMBSTONE_RETENTION_MS,
    )
    .run();
}

export async function disableSubscriptionById(
  db: D1Database,
  id: number,
  reason: string,
  now: number,
  expectedEndpointHash?: string,
  expectedVapidKeyId?: string,
  expectedReconciledAt?: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE subscriptions
          SET endpoint_hash = NULL,
              endpoint = NULL,
              p256dh = NULL,
              auth = NULL,
              disabled_at = COALESCE(disabled_at, ?1),
              disabled_reason = COALESCE(disabled_reason, ?2),
              tombstone_until = MAX(COALESCE(tombstone_until, 0), ?3)
        WHERE id = ?4
          AND (?5 IS NULL OR endpoint_hash = ?5)
          AND (?6 IS NULL OR vapid_key_id = ?6)
          AND (?7 IS NULL OR last_reconciled_at = ?7)`,
    )
    .bind(
      now,
      reason,
      now + TOMBSTONE_RETENTION_MS,
      id,
      expectedEndpointHash ?? null,
      expectedVapidKeyId ?? null,
      expectedReconciledAt ?? null,
    )
    .run();
  return result.meta.changes > 0;
}
