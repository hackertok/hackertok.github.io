export interface PushConfig {
  enabled: boolean;
  threshold: number;
  keyId: string;
  applicationServerKey: string;
  turnstileSiteKey: string;
}

export interface SerializedPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface ErrorBody {
  error?: unknown;
}

export class PushApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.name = 'PushApiError';
    this.status = status;
    this.code = code;
  }
}

const configuredApiUrl = import.meta.env.VITE_PUSH_API_URL?.trim() ?? '';

export function isPushApiConfigured(): boolean {
  return configuredApiUrl.length > 0;
}

function apiUrl(path: string): string {
  if (!configuredApiUrl) throw new PushApiError(503, 'not_configured');
  return new URL(path, configuredApiUrl).href;
}

async function errorFromResponse(response: Response): Promise<PushApiError> {
  let code = 'request_failed';
  try {
    const body = await response.json() as ErrorBody;
    if (typeof body.error === 'string' && body.error.length <= 64) {
      code = body.error;
    }
  } catch {
    /* Keep the generic error code for malformed/non-JSON failures. */
  }
  return new PushApiError(response.status, code);
}

export async function fetchPushConfig(signal?: AbortSignal): Promise<PushConfig> {
  if (!configuredApiUrl) {
    return {
      enabled: false,
      threshold: 1000,
      keyId: '',
      applicationServerKey: '',
      turnstileSiteKey: '',
    };
  }
  const response = await fetch(apiUrl('/v1/push/config'), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);

  const value = await response.json() as Partial<PushConfig>;
  if (
    typeof value.enabled !== 'boolean' ||
    typeof value.threshold !== 'number' ||
    !Number.isSafeInteger(value.threshold) ||
    value.threshold !== 1000 ||
    typeof value.keyId !== 'string' ||
    value.keyId.length === 0 ||
    value.keyId.length > 64 ||
    typeof value.applicationServerKey !== 'string' ||
    value.applicationServerKey.length > 256 ||
    typeof value.turnstileSiteKey !== 'string' ||
    value.turnstileSiteKey.length > 256 ||
    (value.enabled && value.turnstileSiteKey.length === 0)
  ) {
    throw new PushApiError(502, 'invalid_config');
  }
  return value as PushConfig;
}

export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/') + padding;
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new PushApiError(502, 'invalid_config');
  }
  const key = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (key.byteLength !== 65 || key[0] !== 0x04) {
    throw new PushApiError(502, 'invalid_config');
  }
  return key;
}

export function createPushToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

export function serializeSubscription(
  subscription: PushSubscription,
): SerializedPushSubscription {
  const json = subscription.toJSON();
  if (
    !json.endpoint ||
    !json.keys?.p256dh ||
    !json.keys.auth
  ) {
    throw new PushApiError(400, 'invalid_subscription');
  }
  return {
    endpoint: json.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  };
}

export async function putPushSubscription(
  token: string,
  subscription: PushSubscription,
  turnstileToken?: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(apiUrl('/v1/push/subscription'), {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ...serializeSubscription(subscription),
      ...(turnstileToken ? { turnstileToken } : {}),
    }),
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
}

export async function deletePushSubscription(
  token: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(apiUrl('/v1/push/subscription'), {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
}
