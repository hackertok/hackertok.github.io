import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELIVERY_QUEUE_NAME, FANOUT_QUEUE_NAME } from '../src/constants';
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
