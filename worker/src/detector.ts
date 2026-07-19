import {
  DEFAULT_RECHECK_MS,
  DETECTOR_LEASE_MS,
  EVENT_TTL_MS,
  MAX_BOOTSTRAP_VERIFICATION_ATTEMPTS,
  MAX_FIREBASE_CHECKS_PER_RUN,
  discoveryWindowDays,
  storyThreshold,
} from './constants';
import { randomId } from './crypto';
import type { Bindings, FanoutMessage } from './types';

const SOURCE_TIMEOUT_MS = 10_000;

interface AlgoliaHit {
  objectID?: unknown;
  created_at_i?: unknown;
}

interface AlgoliaPage {
  hits?: unknown;
  page?: unknown;
  nbPages?: unknown;
}

type FirebaseResult =
  | { kind: 'qualified'; id: number; title: string; score: number; createdAt: number }
  | { kind: 'below'; id: number; score: number; createdAt: number | null }
  | { kind: 'invalid'; id: number }
  | { kind: 'transient'; id: number };

function safePositiveInt(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0
    ? number
    : null;
}

function parseAlgoliaPage(value: unknown): {
  ids: { id: number; createdAt: number | null }[];
  page: number;
  totalPages: number;
} {
  if (typeof value !== 'object' || value === null) throw new Error('algolia_shape');
  const page = value as AlgoliaPage;
  if (!Array.isArray(page.hits)) throw new Error('algolia_shape');

  const ids = new Map<number, number | null>();
  for (const raw of page.hits) {
    if (typeof raw !== 'object' || raw === null) continue;
    const hit = raw as AlgoliaHit;
    const id = safePositiveInt(hit.objectID);
    if (!id) continue;
    const createdAt = safePositiveInt(hit.created_at_i);
    ids.set(id, createdAt);
  }

  if (
    typeof page.page !== 'number' ||
    !Number.isSafeInteger(page.page) ||
    page.page < 0 ||
    page.page > 100
  ) {
    throw new Error('algolia_shape');
  }
  const currentPage = page.page;
  if (
    typeof page.nbPages !== 'number' ||
    !Number.isSafeInteger(page.nbPages) ||
    page.nbPages < 0 ||
    page.nbPages > 100
  ) {
    throw new Error('algolia_shape');
  }
  const totalPages = page.nbPages;
  return {
    ids: [...ids].map(([id, createdAt]) => ({ id, createdAt })),
    page: currentPage,
    totalPages,
  };
}

async function fetchAlgoliaPage(
  fromSeconds: number,
  toSeconds: number,
  threshold: number,
  page: number,
): Promise<ReturnType<typeof parseAlgoliaPage>> {
  const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
  url.searchParams.set('tags', 'story');
  url.searchParams.set(
    'numericFilters',
    `created_at_i>=${fromSeconds},created_at_i<=${toSeconds},points>${threshold}`,
  );
  url.searchParams.set('hitsPerPage', '1000');
  url.searchParams.set('page', String(page));

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`algolia_${response.status}`);
  const result = parseAlgoliaPage(await response.json());
  if (result.page !== page) throw new Error('algolia_page_mismatch');
  return result;
}

async function insertCandidates(
  db: D1Database,
  candidates: readonly { id: number; createdAt: number | null }[],
  now: number,
  phase: 'BOOTSTRAPPING' | 'ACTIVE',
  leaseToken: string,
): Promise<void> {
  if (!candidates.length) return;
  const encoded = JSON.stringify(candidates);
  await db
    .prepare(
      `WITH parsed AS (
         SELECT CAST(json_extract(value, '$.id') AS INTEGER) AS story_id,
                CASE
                  WHEN json_type(value, '$.createdAt') = 'null' THEN NULL
                  ELSE CAST(json_extract(value, '$.createdAt') AS INTEGER)
                END AS hn_created_at
           FROM json_each(?1)
       ),
       incoming AS (
         SELECT story_id, MAX(hn_created_at) AS hn_created_at
           FROM parsed
          WHERE story_id > 0
          GROUP BY story_id
       )
       INSERT INTO stories (
         story_id, hn_created_at, verification_state, next_check_at,
         created_at, updated_at
       )
       SELECT story_id, hn_created_at, 'candidate', ?2, ?2, ?2
         FROM incoming
        WHERE EXISTS (
          SELECT 1
            FROM app_state
           WHERE id = 1
             AND phase = ?3
             AND detector_lease_token = ?4
        )
       ON CONFLICT(story_id) DO UPDATE SET
         hn_created_at = COALESCE(stories.hn_created_at, excluded.hn_created_at),
         updated_at = CASE
           WHEN stories.verification_state = 'candidate' THEN excluded.updated_at
           ELSE stories.updated_at
         END`,
    )
    .bind(encoded, now, phase, leaseToken)
    .run();
}

async function verifyFirebaseStory(
  id: number,
  threshold: number,
): Promise<FirebaseResult> {
  try {
    const response = await fetch(
      `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
      {
        headers: { accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      },
    );
    if (response.status === 404) return { kind: 'invalid', id };
    if (!response.ok) return { kind: 'transient', id };
    const value: unknown = await response.json();
    if (value === null) return { kind: 'invalid', id };
    if (typeof value !== 'object') {
      return { kind: 'transient', id };
    }

    const item = value as Record<string, unknown>;
    const itemId = safePositiveInt(item.id);
    const score = safePositiveInt(item.score);
    const createdAt = safePositiveInt(item.time);
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (
      itemId !== id ||
      item.type !== 'story' ||
      item.dead === true ||
      item.deleted === true ||
      !title ||
      title.length > 300 ||
      score === null
    ) {
      return { kind: 'invalid', id };
    }
    if (score <= threshold) {
      return { kind: 'below', id, score, createdAt };
    }
    return {
      kind: 'qualified',
      id,
      title,
      score,
      createdAt: createdAt ?? 0,
    };
  } catch {
    return { kind: 'transient', id };
  }
}

async function persistVerification(
  env: Bindings,
  result: FirebaseResult,
  phase: 'BOOTSTRAPPING' | 'ACTIVE',
  now: number,
  leaseToken: string,
): Promise<boolean> {
  if (result.kind === 'qualified') {
    if (phase === 'BOOTSTRAPPING') {
      await env.PUSH_DB
        .prepare(
          `UPDATE stories
              SET title = ?1,
                  score = ?2,
                  hn_created_at = COALESCE(?3, hn_created_at),
                  verified_at = ?4,
                  verification_attempts = verification_attempts + 1,
                  verification_state = 'seeded',
                  last_verification_error = NULL,
                  next_check_at = NULL,
                  updated_at = ?4
            WHERE story_id = ?5
              AND verification_state = 'candidate'
              AND EXISTS (
                SELECT 1
                  FROM app_state
                 WHERE id = 1
                   AND phase = ?6
                   AND detector_lease_token = ?7
              )`,
        )
        .bind(
          result.title,
          result.score,
          result.createdAt || null,
          now,
          result.id,
          phase,
          leaseToken,
        )
        .run();
      return false;
    }

    const created = await env.PUSH_DB
      .prepare(
        `UPDATE stories
            SET title = ?1,
                score = ?2,
                hn_created_at = COALESCE(?3, hn_created_at),
                verified_at = ?4,
                verification_attempts = verification_attempts + 1,
                verification_state = 'event',
                last_verification_error = NULL,
                next_check_at = NULL,
                event_state = 'fanout_pending',
                audience_high_water_id = COALESCE(
                  (SELECT MAX(id) FROM subscriptions WHERE disabled_at IS NULL),
                  0
                ),
                fanout_cursor = 0,
                fanout_wake_at = NULL,
                event_created_at = ?4,
                expires_at = ?5,
                updated_at = ?4
          WHERE story_id = ?6
            AND verification_state = 'candidate'
            AND EXISTS (
              SELECT 1
                FROM app_state
               WHERE id = 1
                 AND phase = ?7
                 AND detector_lease_token = ?8
            )
          RETURNING story_id`,
      )
      .bind(
        result.title,
        result.score,
        result.createdAt || null,
        now,
        now + EVENT_TTL_MS,
        result.id,
        phase,
        leaseToken,
      )
      .first<{ story_id: number }>();
    return Boolean(created);
  }

  if (result.kind === 'below') {
    await env.PUSH_DB
      .prepare(
        `UPDATE stories
            SET score = ?1,
                hn_created_at = COALESCE(?2, hn_created_at),
                verified_at = ?3,
                verification_attempts = verification_attempts + 1,
                last_verification_error = 'score_below_threshold',
                next_check_at = ?4,
                updated_at = ?3
          WHERE story_id = ?5
            AND verification_state = 'candidate'
            AND EXISTS (
              SELECT 1
                FROM app_state
               WHERE id = 1
                 AND phase = ?6
                 AND detector_lease_token = ?7
            )`,
      )
      .bind(
        result.score,
        result.createdAt,
        now,
        now + DEFAULT_RECHECK_MS,
        result.id,
        phase,
        leaseToken,
      )
      .run();
    return false;
  }

  if (result.kind === 'invalid') {
    await env.PUSH_DB
      .prepare(
        `UPDATE stories
            SET verified_at = ?1,
                verification_attempts = verification_attempts + 1,
                verification_state = 'seeded',
                last_verification_error = 'invalid_item',
                next_check_at = NULL,
                updated_at = ?1
          WHERE story_id = ?2
            AND verification_state = 'candidate'
            AND EXISTS (
              SELECT 1
                FROM app_state
               WHERE id = 1
                 AND phase = ?3
                 AND detector_lease_token = ?4
            )`,
      )
      .bind(now, result.id, phase, leaseToken)
      .run();
    return false;
  }

  if (phase === 'BOOTSTRAPPING') {
    await env.PUSH_DB
      .prepare(
        `UPDATE stories
            SET verification_attempts = verification_attempts + 1,
                verification_state = CASE
                  WHEN verification_attempts + 1 >= ?1 THEN 'seeded'
                  ELSE 'candidate'
                END,
                last_verification_error = CASE
                  WHEN verification_attempts + 1 >= ?1
                    THEN 'bootstrap_verification_deferred'
                  ELSE 'transient'
                END,
                next_check_at = CASE
                  WHEN verification_attempts + 1 >= ?1 THEN NULL
                  ELSE ?2
                END,
                updated_at = ?3
          WHERE story_id = ?4
            AND verification_state = 'candidate'
            AND EXISTS (
              SELECT 1
                FROM app_state
               WHERE id = 1
                 AND phase = 'BOOTSTRAPPING'
                 AND detector_lease_token = ?5
            )`,
      )
      .bind(
        MAX_BOOTSTRAP_VERIFICATION_ATTEMPTS,
        now + DEFAULT_RECHECK_MS,
        now,
        result.id,
        leaseToken,
      )
      .run();
    return false;
  }

  await env.PUSH_DB
    .prepare(
      `UPDATE stories
          SET verification_attempts = verification_attempts + 1,
              last_verification_error = 'transient',
              next_check_at = ?1,
              updated_at = ?2
        WHERE story_id = ?3
          AND verification_state = 'candidate'
          AND EXISTS (
            SELECT 1
              FROM app_state
             WHERE id = 1
               AND phase = ?4
               AND detector_lease_token = ?5
          )`,
    )
    .bind(now + DEFAULT_RECHECK_MS, now, result.id, phase, leaseToken)
    .run();
  return false;
}

async function verifyCandidates(
  env: Bindings,
  phase: 'BOOTSTRAPPING' | 'ACTIVE',
  now: number,
  leaseToken: string,
): Promise<{ transientCount: number }> {
  const condition = phase === 'BOOTSTRAPPING'
    ? `(verification_attempts = 0 OR last_verification_error = 'transient')`
    : `(next_check_at IS NULL OR next_check_at <= ?1)`;
  const statement = env.PUSH_DB.prepare(
    `SELECT story_id
       FROM stories
      WHERE verification_state = 'candidate'
        AND ${condition}
      ORDER BY verification_attempts, COALESCE(next_check_at, 0), story_id
      LIMIT ${MAX_FIREBASE_CHECKS_PER_RUN}`,
  );
  const rows = phase === 'ACTIVE'
    ? await statement.bind(now).all<{ story_id: number }>()
    : await statement.all<{ story_id: number }>();

  const results = await Promise.all(
    rows.results.map(({ story_id }) => verifyFirebaseStory(story_id, storyThreshold(env))),
  );
  const circuit = await env.PUSH_DB
    .prepare(
      `SELECT delivery_circuit_until, queue_publishing_paused
         FROM app_state
        WHERE id = 1`,
    )
    .first<{
      delivery_circuit_until: number | null;
      queue_publishing_paused: 0 | 1;
    }>();
  const queuePublishingPaused =
    circuit?.queue_publishing_paused === 1 ||
    (circuit?.delivery_circuit_until ?? 0) > now;
  let transientCount = 0;
  for (const result of results) {
    if (result.kind === 'transient') transientCount += 1;
    const eventCreated = await persistVerification(
      env,
      result,
      phase,
      now,
      leaseToken,
    );
    if (!eventCreated || queuePublishingPaused) continue;

    const message: FanoutMessage = { kind: 'fanout', storyId: result.id };
    try {
      await (env.FANOUT_QUEUE as Queue<FanoutMessage>).send(message);
      await env.PUSH_DB
        .prepare(
          `UPDATE stories
              SET fanout_wake_at = ?1,
                  updated_at = ?1
            WHERE story_id = ?2
              AND event_state IN ('fanout_pending', 'fanout_active')`,
        )
        .bind(now, result.id)
        .run();
    } catch {
      console.warn(JSON.stringify({ event: 'fanout_wake_failed', storyId: result.id }));
    }
  }
  return { transientCount };
}

async function bootstrap(env: Bindings, leaseToken: string, now: number): Promise<void> {
  const windowMs = discoveryWindowDays(env) * 24 * 60 * 60 * 1000;
  await env.PUSH_DB
    .prepare(
      `UPDATE app_state
          SET bootstrap_from = COALESCE(bootstrap_from, ?1),
              bootstrap_to = COALESCE(bootstrap_to, ?2),
              updated_at = ?2
        WHERE id = 1
          AND detector_lease_token = ?3`,
    )
    .bind(now - windowMs, now, leaseToken)
    .run();

  const state = await env.PUSH_DB
    .prepare(
      `SELECT bootstrap_from, bootstrap_to, bootstrap_page, bootstrap_total_pages
         FROM app_state
        WHERE id = 1
          AND detector_lease_token = ?1`,
    )
    .bind(leaseToken)
    .first<{
      bootstrap_from: number;
      bootstrap_to: number;
      bootstrap_page: number;
      bootstrap_total_pages: number | null;
    }>();
  if (!state) return;

  const enumerationComplete =
    state.bootstrap_total_pages !== null &&
    state.bootstrap_page >= state.bootstrap_total_pages;
  if (!enumerationComplete) {
    const page = await fetchAlgoliaPage(
      Math.floor(state.bootstrap_from / 1000),
      Math.floor(state.bootstrap_to / 1000),
      storyThreshold(env),
      state.bootstrap_page,
    );
    await insertCandidates(
      env.PUSH_DB,
      page.ids,
      now,
      'BOOTSTRAPPING',
      leaseToken,
    );
    await env.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET bootstrap_page = ?1,
                bootstrap_total_pages = ?2,
                updated_at = ?3
          WHERE id = 1
            AND detector_lease_token = ?4`,
      )
      .bind(page.page + 1, page.totalPages, now, leaseToken)
      .run();
  }

  await verifyCandidates(env, 'BOOTSTRAPPING', now, leaseToken);

  const latest = await env.PUSH_DB
    .prepare(
      `SELECT bootstrap_page, bootstrap_total_pages
         FROM app_state
        WHERE id = 1
          AND detector_lease_token = ?1`,
    )
    .bind(leaseToken)
    .first<{ bootstrap_page: number; bootstrap_total_pages: number | null }>();
  const unresolved = await env.PUSH_DB
    .prepare(
      `SELECT COUNT(*) AS count
         FROM stories
        WHERE verification_state = 'candidate'
          AND (verification_attempts = 0 OR last_verification_error = 'transient')`,
    )
    .first<{ count: number }>();

  if (
    latest?.bootstrap_total_pages !== null &&
    latest !== null &&
    latest.bootstrap_page >= latest.bootstrap_total_pages &&
    (unresolved?.count ?? 0) === 0
  ) {
    await env.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET phase = 'ACTIVE',
                last_successful_scan_at = ?1,
                updated_at = ?1
          WHERE id = 1
            AND phase = 'BOOTSTRAPPING'
            AND detector_lease_token = ?2`,
      )
      .bind(now, leaseToken)
      .run();
  }
}

async function activeScan(
  env: Bindings,
  leaseToken: string,
  now: number,
): Promise<void> {
  const toSeconds = Math.floor(now / 1000);
  const fromSeconds =
    toSeconds - discoveryWindowDays(env) * 24 * 60 * 60;
  await env.PUSH_DB
    .prepare(
      `UPDATE stories
          SET verification_state = 'seeded',
              last_verification_error = 'discovery_window_expired',
              next_check_at = NULL,
              updated_at = ?1
        WHERE verification_state = 'candidate'
          AND hn_created_at IS NOT NULL
          AND hn_created_at < ?2
          AND EXISTS (
            SELECT 1
              FROM app_state
             WHERE id = 1
               AND phase = 'ACTIVE'
               AND detector_lease_token = ?3
          )`,
    )
    .bind(now, fromSeconds, leaseToken)
    .run();
  const first = await fetchAlgoliaPage(
    fromSeconds,
    toSeconds,
    storyThreshold(env),
    0,
  );
  const candidates = [...first.ids];
  if (first.totalPages > 10) throw new Error('algolia_page_bound');
  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await fetchAlgoliaPage(
      fromSeconds,
      toSeconds,
      storyThreshold(env),
      page,
    );
    candidates.push(...next.ids);
  }
  await insertCandidates(env.PUSH_DB, candidates, now, 'ACTIVE', leaseToken);
  const verification = await verifyCandidates(
    env,
    'ACTIVE',
    now,
    leaseToken,
  );
  const remaining = await env.PUSH_DB
    .prepare(
      `SELECT COUNT(*) AS count
         FROM stories
        WHERE verification_state = 'candidate'
          AND (next_check_at IS NULL OR next_check_at <= ?1)`,
    )
    .bind(now)
    .first<{ count: number }>();
  if (
    verification.transientCount === 0 &&
    (remaining?.count ?? 0) === 0
  ) {
    await env.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET last_successful_scan_at = ?1,
                updated_at = ?1
          WHERE id = 1
            AND phase = 'ACTIVE'
            AND detector_lease_token = ?2`,
      )
      .bind(now, leaseToken)
      .run();
  }
}

export async function runDetector(env: Bindings): Promise<void> {
  const now = Date.now();
  const leaseToken = randomId();
  const lease = await env.PUSH_DB
    .prepare(
      `UPDATE app_state
          SET detector_lease_token = ?1,
              detector_lease_expires_at = ?2,
              updated_at = ?3
        WHERE id = 1
          AND (
            detector_lease_token IS NULL
            OR detector_lease_expires_at IS NULL
            OR detector_lease_expires_at <= ?3
          )
        RETURNING phase`,
    )
    .bind(leaseToken, now + DETECTOR_LEASE_MS, now)
    .first<{ phase: 'BOOTSTRAPPING' | 'ACTIVE' }>();
  if (!lease) return;

  try {
    if (lease.phase === 'BOOTSTRAPPING') {
      await bootstrap(env, leaseToken, now);
    } else {
      await activeScan(env, leaseToken, now);
    }
  } finally {
    await env.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET detector_lease_token = NULL,
                detector_lease_expires_at = NULL,
                updated_at = ?1
          WHERE id = 1
            AND detector_lease_token = ?2`,
      )
      .bind(Date.now(), leaseToken)
      .run();
  }
}
