import type { Bindings } from './types';

export const FANOUT_QUEUE_NAME = 'hackertok-push-fanout';
export const DELIVERY_QUEUE_NAME = 'hackertok-push-delivery';

export const API_BODY_LIMIT = 8 * 1024;
export const FANOUT_PAGE_SIZE = 50;
export const EVENT_TTL_MS = 12 * 60 * 60 * 1000;
export const DELIVERY_LEASE_MS = 30 * 1000;
export const FANOUT_LEASE_MS = 30 * 1000;
export const DETECTOR_LEASE_MS = 4 * 60 * 1000;
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const TERMINAL_DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DELIVERY_ATTEMPTS = 6;
export const MAX_RETRY_AFTER_SECONDS = 60 * 60;
export const DEFAULT_RECHECK_MS = 5 * 60 * 1000;
export const MAX_FIREBASE_CHECKS_PER_RUN = 35;
export const MAX_BOOTSTRAP_VERIFICATION_ATTEMPTS = 12;
export const CLEANUP_BATCH_SIZE = 100;

function boundedInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function subscriptionCap(env: Bindings): number {
  return boundedInt(env.SUBSCRIPTION_CAP, 350, 1, 10_000);
}

export function storyThreshold(env: Bindings): number {
  const threshold = boundedInt(env.STORY_THRESHOLD, 1000, 1, 1_000_000);
  if (threshold !== 1000) {
    throw new Error('STORY_THRESHOLD must remain 1000');
  }
  return threshold;
}

export function discoveryWindowDays(env: Bindings): number {
  return boundedInt(env.DISCOVERY_WINDOW_DAYS, 30, 1, 365);
}

export function allowedOrigins(env: Bindings): ReadonlySet<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function relayHosts(env: Bindings): readonly string[] {
  return env.RELAY_HOST_ALLOWLIST.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}
