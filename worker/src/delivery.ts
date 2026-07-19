import { generateRequestDetails } from 'web-push-neo';
import {
  CLEANUP_BATCH_SIZE,
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_RETRY_AFTER_SECONDS,
} from './constants';
import { decodeBase64Url, randomId } from './crypto';
import { HttpError } from './http';
import { disableSubscriptionById } from './subscriptions';
import type {
  AlertPayload,
  Bindings,
  DeliveryMessage,
  DeliveryRow,
  StoryRow,
  SubscriptionRow,
} from './types';
import {
  matchingVapidPrivateKey,
  validateRelayEndpoint,
} from './validation';

const PUSH_TIMEOUT_MS = 10_000;
const STALE_WAKE_MS = 10 * 60 * 1000;
const AUTH_CIRCUIT_MS = 60 * 60 * 1000;
const SENDER_CIRCUIT_MS = 6 * 60 * 60 * 1000;
const RETRY_DELAYS_SECONDS = [30, 120, 600, 1800, 3600] as const;

export interface DeliveryOutcome {
  retryAfterSeconds?: number;
}

class SenderFault extends Error {
  constructor() {
    super('sender_fault');
    this.name = 'SenderFault';
  }
}

class DeviceKeyFault extends Error {
  constructor() {
    super('device_key_fault');
    this.name = 'DeviceKeyFault';
  }
}

async function privateVapidKey(env: Bindings): Promise<string> {
  const key = await matchingVapidPrivateKey(
    env.VAPID_PRIVATE_JWK,
    env.VAPID_PUBLIC_KEY,
  );
  if (!key) throw new SenderFault();
  return key;
}

function retryAfterSeconds(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(seconds));
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(
    MAX_RETRY_AFTER_SECONDS,
    Math.max(0, Math.ceil((date - Date.now()) / 1000)),
  );
}

async function openCircuit(
  db: D1Database,
  until: number,
  reason: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE app_state
          SET delivery_circuit_reason = CASE
                WHEN COALESCE(delivery_circuit_until, 0) >= ?1
                  THEN COALESCE(delivery_circuit_reason, ?2)
                ELSE ?2
              END,
              delivery_circuit_until = MAX(COALESCE(delivery_circuit_until, 0), ?1),
              updated_at = ?3
        WHERE id = 1`,
    )
    .bind(until, reason, now)
    .run();
}

async function buildAndSend(
  env: Bindings,
  subscription: SubscriptionRow,
  payload: AlertPayload | { version: 1; test: true },
  topic: string,
  ttlSeconds: number,
): Promise<Response> {
  if (!subscription.endpoint || !subscription.p256dh || !subscription.auth) {
    throw new SenderFault();
  }
  let endpoint: string;
  let request: Awaited<ReturnType<typeof generateRequestDetails>>;
  try {
    endpoint = validateRelayEndpoint(subscription.endpoint, env);
    try {
      await crypto.subtle.importKey(
        'raw',
        decodeBase64Url(subscription.p256dh),
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
    } catch {
      throw new DeviceKeyFault();
    }
    request = await generateRequestDetails(
      {
        endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      {
        TTL: Math.max(1, Math.min(86_400, ttlSeconds)),
        urgency: 'normal',
        topic,
        vapidDetails: {
          subject: env.VAPID_SUBJECT,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: await privateVapidKey(env),
        },
      },
    );
    if (validateRelayEndpoint(request.endpoint, env) !== endpoint) {
      throw new SenderFault();
    }
  } catch (error) {
    if (error instanceof DeviceKeyFault) throw error;
    if (error instanceof SenderFault) throw error;
    throw new SenderFault();
  }

  return fetch(request.endpoint, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
}

async function fencedUpdate(
  db: D1Database,
  deliveryId: number,
  leaseToken: string,
  sql: string,
  bindings: readonly unknown[],
): Promise<void> {
  await db
    .prepare(
      `${sql}
        WHERE id = ?${bindings.length + 1}
          AND lease_token = ?${bindings.length + 2}`,
    )
    .bind(...bindings, deliveryId, leaseToken)
    .run();
}

async function terminalize(
  db: D1Database,
  deliveryId: number,
  leaseToken: string,
  now: number,
  status: number | null,
  resultClass: string,
): Promise<void> {
  await fencedUpdate(
    db,
    deliveryId,
    leaseToken,
    `UPDATE deliveries
        SET state = 'terminal',
            relay_status = ?1,
            result_class = ?2,
            terminal_at = ?3,
            lease_token = NULL,
            lease_expires_at = NULL,
            wake_at = NULL,
            updated_at = ?3`,
    [status, resultClass, now],
  );
}

async function accepted(
  db: D1Database,
  deliveryId: number,
  leaseToken: string,
  now: number,
  status: number,
): Promise<void> {
  await fencedUpdate(
    db,
    deliveryId,
    leaseToken,
    `UPDATE deliveries
        SET state = 'accepted',
            relay_status = ?1,
            result_class = 'accepted',
            accepted_at = ?2,
            lease_token = NULL,
            lease_expires_at = NULL,
            wake_at = NULL,
            updated_at = ?2`,
    [status, now],
  );
}

async function scheduleRetry(
  db: D1Database,
  delivery: DeliveryRow,
  leaseToken: string,
  now: number,
  status: number | null,
  resultClass: string,
  requestedDelay?: number | null,
): Promise<DeliveryOutcome> {
  if (delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
    await terminalize(
      db,
      delivery.id,
      leaseToken,
      now,
      status,
      'retry_exhausted',
    );
    return {};
  }

  const fallback =
    RETRY_DELAYS_SECONDS[
      Math.min(delivery.attempts - 1, RETRY_DELAYS_SECONDS.length - 1)
    ] ?? 3600;
  const delaySeconds = Math.max(1, requestedDelay ?? fallback);
  const nextAttempt = now + delaySeconds * 1000;
  if (nextAttempt >= delivery.expires_at) {
    await terminalize(db, delivery.id, leaseToken, now, status, 'expired');
    return {};
  }

  await fencedUpdate(
    db,
    delivery.id,
    leaseToken,
    `UPDATE deliveries
        SET state = 'retry',
            next_attempt_at = ?1,
            wake_at = ?2,
            relay_status = ?3,
            result_class = ?4,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = ?2`,
    [nextAttempt, now, status, resultClass],
  );
  return { retryAfterSeconds: delaySeconds };
}

async function pauseDelivery(
  db: D1Database,
  deliveryId: number,
  leaseToken: string,
  now: number,
  status: number | null,
  resultClass: string,
  resumeAt: number,
): Promise<void> {
  await fencedUpdate(
    db,
    deliveryId,
    leaseToken,
    `UPDATE deliveries
        SET state = 'paused',
            next_attempt_at = ?1,
            relay_status = ?2,
            result_class = ?3,
            lease_token = NULL,
            lease_expires_at = NULL,
            wake_at = NULL,
            updated_at = ?4`,
    [resumeAt, status, resultClass, now],
  );
}

async function currentDeliveryGate(
  db: D1Database,
  now: number,
): Promise<{ circuitDelay: number | null; queuePublishingPaused: boolean }> {
  const row = await db
    .prepare(
      `SELECT delivery_circuit_until, queue_publishing_paused
         FROM app_state
        WHERE id = 1`,
    )
    .first<{
      delivery_circuit_until: number | null;
      queue_publishing_paused: 0 | 1;
    }>();
  const circuitDelay =
    row?.delivery_circuit_until && row.delivery_circuit_until > now
      ? Math.max(1, Math.ceil((row.delivery_circuit_until - now) / 1000))
      : null;
  return {
    circuitDelay,
    queuePublishingPaused: row?.queue_publishing_paused === 1,
  };
}

export async function handleDelivery(
  env: Bindings,
  deliveryId: number,
): Promise<DeliveryOutcome> {
  if (!Number.isSafeInteger(deliveryId) || deliveryId <= 0) return {};
  const now = Date.now();
  const { circuitDelay, queuePublishingPaused } = await currentDeliveryGate(
    env.PUSH_DB,
    now,
  );
  if (queuePublishingPaused) return {};
  if (circuitDelay) return { retryAfterSeconds: circuitDelay };

  const leaseToken = randomId();
  const delivery = await env.PUSH_DB
    .prepare(
      `UPDATE deliveries
          SET state = 'leased',
              attempts = attempts + 1,
              lease_token = ?1,
              lease_expires_at = ?2,
              wake_at = NULL,
              updated_at = ?3
        WHERE id = ?4
          AND expires_at > ?3
          AND (
            (state IN ('pending', 'retry') AND next_attempt_at <= ?3)
            OR (state = 'leased' AND lease_expires_at <= ?3)
          )
        RETURNING *`,
    )
    .bind(leaseToken, now + DELIVERY_LEASE_MS, now, deliveryId)
    .first<DeliveryRow>();
  if (!delivery) return {};

  const [story, subscription] = await Promise.all([
    env.PUSH_DB
      .prepare('SELECT * FROM stories WHERE story_id = ?1')
      .bind(delivery.story_id)
      .first<StoryRow>(),
    env.PUSH_DB
      .prepare(
        `SELECT *
           FROM subscriptions
          WHERE id = ?1
            AND disabled_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?2)`,
      )
      .bind(delivery.subscription_id, now)
      .first<SubscriptionRow>(),
  ]);

  if (
    story?.verification_state !== 'event' ||
    !story.title ||
    !story.score ||
    !subscription?.endpoint
  ) {
    await terminalize(
      env.PUSH_DB,
      delivery.id,
      leaseToken,
      now,
      null,
      'inactive',
    );
    return {};
  }

  if (subscription.vapid_key_id !== env.VAPID_KEY_ID) {
    const disabled = await disableSubscriptionById(
      env.PUSH_DB,
      delivery.subscription_id,
      'vapid_key_rotated',
      now,
      subscription.endpoint_hash ?? undefined,
      subscription.vapid_key_id,
      subscription.last_reconciled_at,
    );
    if (!disabled) {
      return scheduleRetry(
        env.PUSH_DB,
        delivery,
        leaseToken,
        now,
        null,
        'subscription_rotated',
        1,
      );
    }
    await terminalize(
      env.PUSH_DB,
      delivery.id,
      leaseToken,
      now,
      null,
      'vapid_key_rotated',
    );
    return {};
  }

  const payload: AlertPayload = {
    version: 1,
    id: story.story_id,
    title: story.title,
    score: story.score,
  };

  let response: Response;
  try {
    response = await buildAndSend(
      env,
      subscription,
      payload,
      `hn-${story.story_id}`,
      Math.ceil((delivery.expires_at - now) / 1000),
    );
  } catch (error) {
    if (error instanceof DeviceKeyFault) {
      const disabled = await disableSubscriptionById(
        env.PUSH_DB,
        delivery.subscription_id,
        'invalid_device_key',
        now,
        subscription.endpoint_hash ?? undefined,
        subscription.vapid_key_id,
        subscription.last_reconciled_at,
      );
      if (!disabled) {
        return scheduleRetry(
          env.PUSH_DB,
          delivery,
          leaseToken,
          now,
          null,
          'subscription_rotated',
          1,
        );
      }
      await terminalize(
        env.PUSH_DB,
        delivery.id,
        leaseToken,
        now,
        null,
        'invalid_device_key',
      );
      return {};
    }
    if (error instanceof SenderFault) {
      const resumeAt = now + SENDER_CIRCUIT_MS;
      await openCircuit(env.PUSH_DB, resumeAt, 'sender_or_payload_fault', now);
      await pauseDelivery(
        env.PUSH_DB,
        delivery.id,
        leaseToken,
        now,
        null,
        'sender_or_payload_fault',
        resumeAt,
      );
      return {};
    }
    return scheduleRetry(
      env.PUSH_DB,
      delivery,
      leaseToken,
      now,
      null,
      'timeout_or_network',
    );
  }

  const status = response.status;
  if (status >= 200 && status < 300) {
    await accepted(env.PUSH_DB, delivery.id, leaseToken, now, status);
    return {};
  }
  if (status === 404 || status === 410) {
    const disabled = await disableSubscriptionById(
      env.PUSH_DB,
      delivery.subscription_id,
      'relay_gone',
      now,
      subscription.endpoint_hash ?? undefined,
      subscription.vapid_key_id,
      subscription.last_reconciled_at,
    );
    if (!disabled) {
      return scheduleRetry(
        env.PUSH_DB,
        delivery,
        leaseToken,
        now,
        status,
        'subscription_rotated',
        1,
      );
    }
    await terminalize(
      env.PUSH_DB,
      delivery.id,
      leaseToken,
      now,
      status,
      'subscription_gone',
    );
    return {};
  }
  if (status === 408 || status === 429 || status >= 500) {
    return scheduleRetry(
      env.PUSH_DB,
      delivery,
      leaseToken,
      now,
      status,
      'relay_transient',
      retryAfterSeconds(response),
    );
  }
  if (status === 401 || status === 403) {
    const resumeAt = now + AUTH_CIRCUIT_MS;
    await openCircuit(env.PUSH_DB, resumeAt, 'vapid_or_provider_auth', now);
    await pauseDelivery(
      env.PUSH_DB,
      delivery.id,
      leaseToken,
      now,
      status,
      'vapid_or_provider_auth',
      resumeAt,
    );
    return {};
  }
  if (status === 400 || status === 413 || (status >= 300 && status < 400)) {
    const resumeAt = now + SENDER_CIRCUIT_MS;
    await openCircuit(env.PUSH_DB, resumeAt, 'sender_or_payload_fault', now);
    await pauseDelivery(
      env.PUSH_DB,
      delivery.id,
      leaseToken,
      now,
      status,
      'sender_or_payload_fault',
      resumeAt,
    );
    return {};
  }

  await terminalize(
    env.PUSH_DB,
    delivery.id,
    leaseToken,
    now,
    status,
    'relay_terminal',
  );
  return {};
}

export async function sendSelfTest(
  env: Bindings,
  subscription: SubscriptionRow,
): Promise<void> {
  const now = Date.now();
  if (subscription.expires_at !== null && subscription.expires_at <= now) {
    const disabled = await disableSubscriptionById(
      env.PUSH_DB,
      subscription.id,
      'subscription_expired',
      now,
      subscription.endpoint_hash ?? undefined,
      subscription.vapid_key_id,
      subscription.last_reconciled_at,
    );
    if (!disabled) throw new HttpError(503, 'relay_unavailable', 1);
    throw new HttpError(410, 'subscription_gone');
  }
  if (subscription.vapid_key_id !== env.VAPID_KEY_ID) {
    const disabled = await disableSubscriptionById(
      env.PUSH_DB,
      subscription.id,
      'vapid_key_rotated',
      now,
      subscription.endpoint_hash ?? undefined,
      subscription.vapid_key_id,
      subscription.last_reconciled_at,
    );
    if (!disabled) throw new HttpError(503, 'relay_unavailable', 1);
    throw new HttpError(410, 'subscription_gone');
  }
  const { circuitDelay } = await currentDeliveryGate(env.PUSH_DB, now);
  if (circuitDelay) {
    throw new HttpError(503, 'sender_unavailable', circuitDelay);
  }
  let response: Response;
  try {
    response = await buildAndSend(
      env,
      subscription,
      { version: 1, test: true },
      'hackertok-test',
      300,
    );
  } catch (error) {
    if (error instanceof DeviceKeyFault) {
      const disabled = await disableSubscriptionById(
        env.PUSH_DB,
        subscription.id,
        'invalid_device_key',
        now,
        subscription.endpoint_hash ?? undefined,
        subscription.vapid_key_id,
        subscription.last_reconciled_at,
      );
      if (!disabled) throw new HttpError(503, 'relay_unavailable', 1);
      throw new HttpError(410, 'subscription_gone');
    }
    if (error instanceof SenderFault) {
      await openCircuit(
        env.PUSH_DB,
        now + SENDER_CIRCUIT_MS,
        'sender_or_payload_fault',
        now,
      );
      throw new HttpError(503, 'sender_unavailable', 3600);
    }
    throw new HttpError(503, 'relay_unavailable', 60);
  }

  if (response.status >= 200 && response.status < 300) return;
  if (response.status === 404 || response.status === 410) {
    const disabled = await disableSubscriptionById(
      env.PUSH_DB,
      subscription.id,
      'relay_gone',
      now,
      subscription.endpoint_hash ?? undefined,
      subscription.vapid_key_id,
      subscription.last_reconciled_at,
    );
    if (!disabled) throw new HttpError(503, 'relay_unavailable', 1);
    throw new HttpError(410, 'subscription_gone');
  }
  if (response.status === 401 || response.status === 403) {
    await openCircuit(
      env.PUSH_DB,
      now + AUTH_CIRCUIT_MS,
      'vapid_or_provider_auth',
      now,
    );
    throw new HttpError(503, 'sender_unavailable', 3600);
  }
  if (
    response.status === 400 ||
    response.status === 413 ||
    (response.status >= 300 && response.status < 400)
  ) {
    await openCircuit(
      env.PUSH_DB,
      now + SENDER_CIRCUIT_MS,
      'sender_or_payload_fault',
      now,
    );
    throw new HttpError(503, 'sender_unavailable', 3600);
  }
  throw new HttpError(
    503,
    'relay_unavailable',
    retryAfterSeconds(response) ?? 60,
  );
}

export async function recoverDeliveryWakes(
  env: Bindings,
  limit = 10,
): Promise<void> {
  const now = Date.now();
  await env.PUSH_DB.batch([
    env.PUSH_DB
      .prepare(
        `UPDATE deliveries
            SET state = 'terminal',
                result_class = 'expired',
                terminal_at = ?1,
                lease_token = NULL,
                lease_expires_at = NULL,
                wake_at = NULL,
                updated_at = ?1
          WHERE id IN (
            SELECT id
              FROM deliveries
             WHERE state IN ('pending', 'retry', 'leased', 'paused')
               AND expires_at <= ?1
             ORDER BY id
             LIMIT ?2
          )`,
      )
      .bind(now, CLEANUP_BATCH_SIZE),
    env.PUSH_DB
      .prepare(
        `UPDATE deliveries
            SET state = 'retry',
                wake_at = NULL,
                updated_at = ?1
          WHERE state = 'paused'
            AND next_attempt_at <= ?1
            AND NOT EXISTS (
              SELECT 1
                FROM app_state
               WHERE id = 1
                 AND (
                   delivery_circuit_until > ?1
                   OR queue_publishing_paused = 1
                 )
            )`,
      )
      .bind(now),
    env.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET delivery_circuit_until = NULL,
                delivery_circuit_reason = NULL,
                updated_at = ?1
          WHERE id = 1
            AND delivery_circuit_until <= ?1`,
      )
      .bind(now),
  ]);

  const rows = await env.PUSH_DB
    .prepare(
      `SELECT id
         FROM deliveries
        WHERE expires_at > ?1
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
            (state IN ('pending', 'retry') AND next_attempt_at <= ?1)
            OR (state = 'leased' AND lease_expires_at <= ?1)
          )
          AND (wake_at IS NULL OR wake_at <= ?2)
        ORDER BY next_attempt_at, id
        LIMIT ?3`,
    )
    .bind(now, now - STALE_WAKE_MS, limit)
    .all<{ id: number }>();

  for (const { id } of rows.results) {
    const message: DeliveryMessage = { kind: 'delivery', deliveryId: id };
    await (env.DELIVERY_QUEUE as Queue<DeliveryMessage>).send(message);
    await env.PUSH_DB
      .prepare(
        `UPDATE deliveries
            SET wake_at = ?1,
                updated_at = ?1
          WHERE id = ?2
            AND state IN ('pending', 'retry', 'leased')`,
      )
      .bind(now, id)
      .run();
  }
}
