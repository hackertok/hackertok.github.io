import { allowedOrigins } from './constants';
import type { Bindings } from './types';

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-resource-policy': 'same-site',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;

  constructor(status: number, code: string, retryAfter?: number) {
    super(code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function responseHeaders(origin?: string): Headers {
  const headers = new Headers(SECURITY_HEADERS);
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  return headers;
}

export function requestOrigin(request: Request, env: Bindings): string {
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).has(origin)) {
    throw new HttpError(403, 'origin_not_allowed');
  }
  return origin;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  origin?: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = responseHeaders(origin);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function emptyResponse(
  status: number,
  origin?: string,
  extraHeaders?: HeadersInit,
): Response {
  const headers = responseHeaders(origin);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(null, { status, headers });
}

export function errorResponse(error: unknown, origin?: string): Response {
  if (error instanceof HttpError) {
    const headers = error.retryAfter
      ? { 'retry-after': String(error.retryAfter) }
      : undefined;
    return jsonResponse({ error: error.code }, error.status, origin, headers);
  }

  console.error(JSON.stringify({ event: 'request_failed', errorClass: 'internal' }));
  return jsonResponse({ error: 'internal_error' }, 500, origin);
}

export function preflight(request: Request, env: Bindings): Response {
  const origin = requestOrigin(request, env);
  const requestedMethod = request.headers.get('access-control-request-method');
  if (!requestedMethod || !['GET', 'PUT', 'POST', 'DELETE'].includes(requestedMethod)) {
    throw new HttpError(405, 'method_not_allowed');
  }

  const headers = responseHeaders(origin);
  headers.set('access-control-allow-methods', 'GET, PUT, POST, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', 'Authorization, Content-Type');
  headers.set('access-control-max-age', '600');
  return new Response(null, { status: 204, headers });
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

export async function enforceRateLimit(
  limiter: RateLimit,
  keys: readonly string[],
): Promise<void> {
  for (const key of keys) {
    const result = await limiter.limit({ key });
    if (!result.success) throw new HttpError(429, 'rate_limited', 60);
  }
}
