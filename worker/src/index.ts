import { handleApi } from './api';
import { runCleanup } from './cleanup';
import {
  DELIVERY_QUEUE_NAME,
  FANOUT_QUEUE_NAME,
  allowedOrigins,
} from './constants';
import { runDetector } from './detector';
import { handleDelivery, recoverDeliveryWakes } from './delivery';
import { handleFanout, recoverFanoutWakes } from './fanout';
import { errorResponse } from './http';
import type {
  Bindings,
  DeliveryMessage,
  FanoutMessage,
  WorkerQueueMessage,
} from './types';

function safeOrigin(request: Request, env: Bindings): string | undefined {
  const origin = request.headers.get('origin') ?? '';
  return allowedOrigins(env).has(origin) ? origin : undefined;
}

function isFanoutMessage(value: unknown): value is FanoutMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<FanoutMessage>;
  return (
    message.kind === 'fanout' &&
    Number.isSafeInteger(message.storyId) &&
    (message.storyId ?? 0) > 0
  );
}

function isDeliveryMessage(value: unknown): value is DeliveryMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<DeliveryMessage>;
  return (
    message.kind === 'delivery' &&
    Number.isSafeInteger(message.deliveryId) &&
    (message.deliveryId ?? 0) > 0
  );
}

async function scheduledTask(env: Bindings): Promise<void> {
  const tasks: { name: string; run: () => Promise<void> }[] = [
    { name: 'recover_fanout', run: () => recoverFanoutWakes(env) },
    { name: 'recover_delivery', run: () => recoverDeliveryWakes(env) },
    { name: 'cleanup', run: () => runCleanup(env) },
    { name: 'detector', run: () => runDetector(env) },
  ];
  for (const task of tasks) {
    try {
      await task.run();
    } catch {
      console.error(JSON.stringify({ event: 'scheduled_task_failed', task: task.name }));
    }
  }
}

const worker = {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleApi(request, env);
    } catch (error) {
      return errorResponse(error, safeOrigin(request, env));
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(scheduledTask(env));
  },

  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (batch.queue === FANOUT_QUEUE_NAME) {
          if (!isFanoutMessage(message.body)) {
            message.ack();
            continue;
          }
          await handleFanout(env, message.body.storyId);
          message.ack();
          continue;
        }

        if (batch.queue === DELIVERY_QUEUE_NAME) {
          if (!isDeliveryMessage(message.body)) {
            message.ack();
            continue;
          }
          const outcome = await handleDelivery(env, message.body.deliveryId);
          if (outcome.retryAfterSeconds) {
            message.retry({ delaySeconds: outcome.retryAfterSeconds });
          } else {
            message.ack();
          }
          continue;
        }

        message.ack();
      } catch {
        console.error(JSON.stringify({
          event: 'queue_handler_failed',
          queue: batch.queue === FANOUT_QUEUE_NAME ? 'fanout' : 'delivery',
        }));
        message.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Bindings, WorkerQueueMessage>;

export default worker;
