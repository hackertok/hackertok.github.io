import { HttpError } from './http';
import type { Bindings } from './types';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'push-enrollment';
const TURNSTILE_TIMEOUT_MS = 10_000;
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;
const TEST_SITE_KEYS = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
]);
const TEST_SECRET_KEYS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

interface SiteverifyResult {
  success?: boolean;
  action?: string;
  hostname?: string;
}

function configuredValue(value: string | undefined, maxLength: number): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

export function turnstileSiteKey(env: Bindings): string | null {
  return configuredValue(env.TURNSTILE_SITE_KEY, 256);
}

export function turnstileConfigured(env: Bindings): boolean {
  const siteKey = turnstileSiteKey(env);
  const secretKey = configuredValue(env.TURNSTILE_SECRET_KEY, 512);
  if (!siteKey || !secretKey) return false;
  return env.ALLOW_TURNSTILE_TEST_KEYS === '1' ||
    (!TEST_SITE_KEYS.has(siteKey) && !TEST_SECRET_KEYS.has(secretKey));
}

export function enrollmentTurnstileToken(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>).turnstileToken;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_TURNSTILE_TOKEN_LENGTH
    ? trimmed
    : null;
}

export async function verifyEnrollmentTurnstile(
  env: Bindings,
  token: string | null,
  origin: string,
): Promise<void> {
  const secret = configuredValue(env.TURNSTILE_SECRET_KEY, 512);
  if (!turnstileSiteKey(env) || !secret) {
    throw new HttpError(503, 'admission_unavailable', 60);
  }
  if (!token) throw new HttpError(403, 'turnstile_required');

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret,
        response: token,
        idempotency_key: crypto.randomUUID(),
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(503, 'admission_unavailable', 60);
  }
  if (!response.ok) {
    throw new HttpError(503, 'admission_unavailable', 60);
  }

  let result: SiteverifyResult;
  try {
    result = await response.json<SiteverifyResult>();
  } catch {
    throw new HttpError(503, 'admission_unavailable', 60);
  }
  const expectedHostname = new URL(origin).hostname.toLowerCase();
  if (
    result.success !== true ||
    result.action !== TURNSTILE_ACTION ||
    result.hostname?.toLowerCase() !== expectedHostname
  ) {
    throw new HttpError(403, 'turnstile_rejected');
  }
}
