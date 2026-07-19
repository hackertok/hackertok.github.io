import { API_BODY_LIMIT, relayHosts } from './constants';
import { decodeBase64Url } from './crypto';
import { HttpError } from './http';
import type { Bindings, PushSubscriptionInput } from './types';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readLimitedBody(request: Request): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > API_BODY_LIMIT) {
        await reader.cancel();
        throw new HttpError(413, 'body_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HttpError(415, 'json_required');
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > API_BODY_LIMIT) {
    throw new HttpError(413, 'body_too_large');
  }

  const body = await readLimitedBody(request);

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export async function requireEmptyBody(request: Request): Promise<void> {
  if (!request.body) return;
  const body = await readLimitedBody(request);
  if (body.length > 0) throw new HttpError(400, 'body_not_allowed');
}

function hostAllowed(hostname: string, configuredHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return configuredHosts.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === allowed;
  });
}

export function validateRelayEndpoint(endpoint: unknown, env: Bindings): string {
  if (typeof endpoint !== 'string' || endpoint.length < 16 || endpoint.length > 2048) {
    throw new HttpError(400, 'invalid_subscription');
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HttpError(400, 'invalid_subscription');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !hostAllowed(url.hostname, relayHosts(env))
  ) {
    throw new HttpError(400, 'invalid_subscription');
  }

  return url.href;
}

function validateKey(value: unknown, expectedLength: number, requireUncompressed = false): string {
  if (typeof value !== 'string' || value.length > 256) {
    throw new HttpError(400, 'invalid_subscription');
  }

  let decoded: Uint8Array;
  try {
    decoded = decodeBase64Url(value);
  } catch {
    throw new HttpError(400, 'invalid_subscription');
  }

  if (
    decoded.byteLength !== expectedLength ||
    (requireUncompressed && decoded[0] !== 0x04)
  ) {
    throw new HttpError(400, 'invalid_subscription');
  }
  return value;
}

async function validateP256dh(value: unknown): Promise<string> {
  const encoded = validateKey(value, 65, true);
  try {
    await crypto.subtle.importKey(
      'raw',
      decodeBase64Url(encoded),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
  } catch {
    throw new HttpError(400, 'invalid_subscription');
  }
  return encoded;
}

let cachedApplicationServerKey = '';
let cachedApplicationServerKeyResult: Promise<boolean> | null = null;

export async function validateApplicationServerKey(value: string): Promise<boolean> {
  if (
    value === cachedApplicationServerKey &&
    cachedApplicationServerKeyResult
  ) {
    return cachedApplicationServerKeyResult;
  }
  cachedApplicationServerKey = value;
  cachedApplicationServerKeyResult = (async () => {
    try {
      const key = decodeBase64Url(value);
      if (key.byteLength !== 65 || key[0] !== 0x04) return false;
      await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      return true;
    } catch {
      return false;
    }
  })();
  return cachedApplicationServerKeyResult;
}

let cachedVapidPair = '';
let cachedVapidPairResult: Promise<string | null> | null = null;

export async function matchingVapidPrivateKey(
  value: string,
  applicationServerKey: string,
): Promise<string | null> {
  const cacheKey = `${value}\u0000${applicationServerKey}`;
  if (cacheKey === cachedVapidPair && cachedVapidPairResult) {
    return cachedVapidPairResult;
  }
  cachedVapidPair = cacheKey;
  cachedVapidPairResult = (async () => {
    try {
      if (value.length > 4096) return null;
      const jwk = JSON.parse(value) as Record<string, unknown>;
      if (
        jwk.kty !== 'EC' ||
        jwk.crv !== 'P-256' ||
        typeof jwk.x !== 'string' ||
        typeof jwk.y !== 'string' ||
        typeof jwk.d !== 'string'
      ) {
        return null;
      }
      const x = decodeBase64Url(jwk.x);
      const y = decodeBase64Url(jwk.y);
      const d = decodeBase64Url(jwk.d);
      const publicKey = decodeBase64Url(applicationServerKey);
      if (
        x.byteLength !== 32 ||
        y.byteLength !== 32 ||
        d.byteLength !== 32 ||
        publicKey.byteLength !== 65 ||
        publicKey[0] !== 0x04
      ) {
        return null;
      }
      for (let index = 0; index < 32; index += 1) {
        if (publicKey[index + 1] !== x[index]) return null;
        if (publicKey[index + 33] !== y[index]) return null;
      }

      const [privateKey, verificationKey] = await Promise.all([
        crypto.subtle.importKey(
          'jwk',
          jwk as JsonWebKey,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['sign'],
        ),
        crypto.subtle.importKey(
          'raw',
          publicKey,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify'],
        ),
      ]);
      const challenge = new TextEncoder().encode('hackertok-vapid-key-check');
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        challenge,
      );
      const matches = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        verificationKey,
        signature,
        challenge,
      );
      return matches ? jwk.d : null;
    } catch {
      return null;
    }
  })();
  return cachedVapidPairResult;
}

export async function validateSubscription(
  input: unknown,
  env: Bindings,
): Promise<PushSubscriptionInput> {
  if (!isObject(input) || !isObject(input.keys)) {
    throw new HttpError(400, 'invalid_subscription');
  }

  const expirationTime = input.expirationTime;
  if (
    expirationTime !== null &&
    expirationTime !== undefined &&
    (
      typeof expirationTime !== 'number' ||
      !Number.isSafeInteger(expirationTime) ||
      expirationTime <= Date.now()
    )
  ) {
    throw new HttpError(400, 'invalid_subscription');
  }

  return {
    endpoint: validateRelayEndpoint(input.endpoint, env),
    expirationTime: typeof expirationTime === 'number' ? expirationTime : null,
    keys: {
      p256dh: await validateP256dh(input.keys.p256dh),
      auth: validateKey(input.keys.auth, 16),
    },
  };
}
