import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLEANUP_CRON,
  DELIVERY_QUEUE_NAME,
  DETECTOR_CRON,
  FANOUT_QUEUE_NAME,
  RECOVERY_CRON,
} from '../src/constants';
import worker from '../src/index';
import type { Bindings, WorkerQueueMessage } from '../src/types';

const bindings = env as unknown as Bindings;

function message(body: unknown) {
  return {
    body,
    ack: vi.fn<() => void>(),
    retry: vi.fn<(options?: { delaySeconds?: number }) => void>(),
  };
}

function batch(queue: string, messages: ReturnType<typeof message>[]) {
  return {
    queue,
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<WorkerQueueMessage>;
}

async function runScheduled(cron: string): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const context = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
  const controller = {
    cron,
    scheduledTime: Date.now(),
    noRetry: vi.fn(),
  } as unknown as ScheduledController;
  await worker.scheduled?.(controller, bindings, context);
  await Promise.all(pending);
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
              queue_publishing_paused = 0
        WHERE id = 1`,
    ),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('exported scheduled handler', () => {
  it('isolates detector, recovery, and cleanup D1 workloads by cron', async () => {
    await bindings.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET phase = 'ACTIVE',
                updated_at = ?1
          WHERE id = 1`,
      )
      .bind(Date.now())
      .run();
    const source = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ hits: [], page: 0, nbPages: 0 }),
    );

    await runScheduled(DETECTOR_CRON);
    expect(source).toHaveBeenCalledOnce();

    const now = Date.now();
    await bindings.PUSH_DB
      .prepare(
        `INSERT INTO subscriptions (
           token_hash, endpoint_hash, endpoint, p256dh, auth, vapid_key_id,
           created_at, activated_at, last_reconciled_at, expires_at
         )
         VALUES ('scheduled-token', 'scheduled-endpoint',
                 'https://fcm.googleapis.com/fcm/send/scheduled',
                 'p256dh', 'auth', 'v1', ?1, ?1, ?1, ?2)`,
      )
      .bind(now, now - 1)
      .run();

    await runScheduled(RECOVERY_CRON);
    let subscription = await bindings.PUSH_DB
      .prepare(
        `SELECT disabled_at
           FROM subscriptions
          WHERE token_hash = 'scheduled-token'`,
      )
      .first<{ disabled_at: number | null }>();
    expect(subscription?.disabled_at).toBeNull();

    await runScheduled(CLEANUP_CRON);
    subscription = await bindings.PUSH_DB
      .prepare(
        `SELECT disabled_at
           FROM subscriptions
          WHERE token_hash = 'scheduled-token'`,
      )
      .first<{ disabled_at: number | null }>();
    expect(subscription?.disabled_at).not.toBeNull();
  });
});

describe('exported queue handler', () => {
  it('acknowledges malformed and unknown-queue messages', async () => {
    const malformed = message({ kind: 'delivery', deliveryId: 0 });
    const unknown = message({ kind: 'delivery', deliveryId: 1 });

    await worker.queue?.(
      batch(DELIVERY_QUEUE_NAME, [malformed]),
      bindings,
    );
    await worker.queue?.(
      batch('unexpected-queue', [unknown]),
      bindings,
    );

    expect(malformed.ack).toHaveBeenCalledExactlyOnceWith();
    expect(malformed.retry).not.toHaveBeenCalled();
    expect(unknown.ack).toHaveBeenCalledExactlyOnceWith();
    expect(unknown.retry).not.toHaveBeenCalled();
  });

  it('routes delivery retry delays through Message.retry', async () => {
    await bindings.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET delivery_circuit_until = ?1
          WHERE id = 1`,
      )
      .bind(Date.now() + 60_000)
      .run();
    const queued = message({ kind: 'delivery', deliveryId: 123 });

    await worker.queue?.(
      batch(DELIVERY_QUEUE_NAME, [queued]),
      bindings,
    );

    expect(queued.ack).not.toHaveBeenCalled();
    expect(queued.retry).toHaveBeenCalledOnce();
    expect(queued.retry.mock.calls[0]?.[0]?.delaySeconds).toBeGreaterThan(0);
  });

  it('acknowledges Queue-budget-paused delivery wakes for durable recovery', async () => {
    await bindings.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET queue_publishing_paused = 1
          WHERE id = 1`,
      )
      .run();
    const queued = message({ kind: 'delivery', deliveryId: 123 });

    await worker.queue?.(
      batch(DELIVERY_QUEUE_NAME, [queued]),
      bindings,
    );

    expect(queued.ack).toHaveBeenCalledExactlyOnceWith();
    expect(queued.retry).not.toHaveBeenCalled();
  });

  it('acknowledges a valid fan-out wake after routing it', async () => {
    const queued = message({ kind: 'fanout', storyId: 123 });

    await worker.queue?.(
      batch(FANOUT_QUEUE_NAME, [queued]),
      bindings,
    );

    expect(queued.ack).toHaveBeenCalledExactlyOnceWith();
    expect(queued.retry).not.toHaveBeenCalled();
  });
});
