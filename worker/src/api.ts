import { subscriptionCap, storyThreshold } from './constants';
import { bearerToken, sha256Base64Url } from './crypto';
import {
  clientIp,
  emptyResponse,
  enforceRateLimit,
  HttpError,
  jsonResponse,
  preflight,
  requestOrigin,
} from './http';
import { sendSelfTest } from './delivery';
import {
  appState,
  disableSubscriptionByToken,
  putSubscription,
  subscriptionByTokenHash,
} from './subscriptions';
import {
  enrollmentTurnstileToken,
  turnstileConfigured,
  turnstileSiteKey,
  verifyEnrollmentTurnstile,
} from './turnstile';
import type { Bindings } from './types';
import {
  readJsonBody,
  matchingVapidPrivateKey,
  requireEmptyBody,
  validateApplicationServerKey,
  validateSubscription,
} from './validation';

const SUBSCRIPTION_PATH = '/v1/push/subscription';
const CONFIG_PATH = '/v1/push/config';
const SELF_TEST_PATH = '/v1/push/self-test';
const READY_PATH = '/health/ready';

async function requireToken(request: Request): Promise<{
  token: string;
  tokenHash: string;
}> {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'unauthorized');
  return { token, tokenHash: await sha256Base64Url(token) };
}

async function configResponse(request: Request, env: Bindings): Promise<Response> {
  const origin = requestOrigin(request, env);
  await enforceRateLimit(env.PUSH_READ_RATE_LIMITER, [
    'global',
    `ip:${clientIp(request)}`,
  ]);
  const state = await appState(env.PUSH_DB);
  const keyValid = await validateApplicationServerKey(env.VAPID_PUBLIC_KEY);
  const senderConfigured =
    keyValid &&
    (await matchingVapidPrivateKey(
      env.VAPID_PRIVATE_JWK,
      env.VAPID_PUBLIC_KEY,
    )) !== null;
  const admissionConfigured = turnstileConfigured(env);
  const enabled =
    state.phase === 'ACTIVE' &&
    senderConfigured &&
    admissionConfigured &&
    state.active_subscription_count < subscriptionCap(env);

  return jsonResponse(
    {
      enabled,
      threshold: storyThreshold(env),
      keyId: env.VAPID_KEY_ID,
      applicationServerKey: senderConfigured ? env.VAPID_PUBLIC_KEY : '',
      turnstileSiteKey: admissionConfigured ? turnstileSiteKey(env) : '',
    },
    200,
    origin,
  );
}

async function putResponse(request: Request, env: Bindings): Promise<Response> {
  const origin = requestOrigin(request, env);
  const { tokenHash } = await requireToken(request);
  await enforceRateLimit(env.PUSH_WRITE_RATE_LIMITER, [
    'global',
    `ip:${clientIp(request)}`,
    `token:${tokenHash}`,
  ]);

  const state = await appState(env.PUSH_DB);
  if (state.phase !== 'ACTIVE') throw new HttpError(503, 'not_ready', 300);
  if (
    !(await validateApplicationServerKey(env.VAPID_PUBLIC_KEY)) ||
    (await matchingVapidPrivateKey(
      env.VAPID_PRIVATE_JWK,
      env.VAPID_PUBLIC_KEY,
    )) === null
  ) {
    throw new HttpError(503, 'not_ready', 300);
  }
  const input = await readJsonBody(request);
  const existing = await subscriptionByTokenHash(env.PUSH_DB, tokenHash);
  if (!existing) {
    if (!turnstileConfigured(env)) throw new HttpError(503, 'not_ready', 300);
    await verifyEnrollmentTurnstile(
      env,
      enrollmentTurnstileToken(input),
      origin,
    );
  }
  const subscription = await validateSubscription(input, env);
  const endpointHash = await sha256Base64Url(subscription.endpoint);
  const result = await putSubscription(
    env,
    tokenHash,
    endpointHash,
    subscription,
    Date.now(),
    subscriptionCap(env),
  );
  return emptyResponse(result.created ? 201 : 204, origin);
}

async function deleteResponse(request: Request, env: Bindings): Promise<Response> {
  const origin = requestOrigin(request, env);
  const { tokenHash } = await requireToken(request);
  await enforceRateLimit(env.PUSH_WRITE_RATE_LIMITER, [
    'global',
    `ip:${clientIp(request)}`,
    `token:${tokenHash}`,
  ]);
  await requireEmptyBody(request);
  await disableSubscriptionByToken(
    env,
    tokenHash,
    'user_opt_out',
    Date.now(),
    subscriptionCap(env) * 3,
  );
  return emptyResponse(204, origin);
}

async function selfTestResponse(request: Request, env: Bindings): Promise<Response> {
  const origin = requestOrigin(request, env);
  const { tokenHash } = await requireToken(request);
  await enforceRateLimit(env.PUSH_TEST_RATE_LIMITER, [
    'global',
    `ip:${clientIp(request)}`,
    `token:${tokenHash}`,
  ]);
  await requireEmptyBody(request);
  const subscription = await subscriptionByTokenHash(env.PUSH_DB, tokenHash);
  if (subscription?.disabled_at != null || !subscription?.endpoint) {
    throw new HttpError(404, 'subscription_not_found');
  }
  await sendSelfTest(env, subscription);
  return emptyResponse(202, origin);
}

async function readiness(request: Request, env: Bindings): Promise<Response> {
  try {
    await enforceRateLimit(env.PUSH_READ_RATE_LIMITER, [
      'global',
      `ip:${clientIp(request)}`,
    ]);
    const state = await appState(env.PUSH_DB);
    const senderConfigured =
      await validateApplicationServerKey(env.VAPID_PUBLIC_KEY) &&
      (await matchingVapidPrivateKey(
        env.VAPID_PRIVATE_JWK,
        env.VAPID_PUBLIC_KEY,
      )) !== null;
    return emptyResponse(
      state.phase === 'ACTIVE' &&
        senderConfigured &&
        turnstileConfigured(env)
        ? 204
        : 503,
      undefined,
      { 'x-hackertok-release': env.RELEASE_VERSION },
    );
  } catch {
    return emptyResponse(503, undefined, {
      'x-hackertok-release': env.RELEASE_VERSION,
    });
  }
}

export async function handleApi(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    if (!url.pathname.startsWith('/v1/push/')) {
      throw new HttpError(404, 'not_found');
    }
    return preflight(request, env);
  }

  if (url.pathname === READY_PATH && request.method === 'GET') {
    return readiness(request, env);
  }
  if (url.pathname === CONFIG_PATH && request.method === 'GET') {
    return configResponse(request, env);
  }
  if (url.pathname === SUBSCRIPTION_PATH && request.method === 'PUT') {
    return putResponse(request, env);
  }
  if (url.pathname === SUBSCRIPTION_PATH && request.method === 'DELETE') {
    return deleteResponse(request, env);
  }
  if (url.pathname === SELF_TEST_PATH && request.method === 'POST') {
    return selfTestResponse(request, env);
  }

  throw new HttpError(404, 'not_found');
}
