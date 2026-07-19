import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  D1_FREE_QUERY_LIMIT,
  DETECTOR_D1_QUERY_HEADROOM,
  DETECTOR_D1_QUERY_UPPER_BOUND,
  MAX_BOOTSTRAP_VERIFICATION_ATTEMPTS,
  MAX_FIREBASE_CHECKS_PER_RUN,
} from '../src/constants';
import { runDetector } from '../src/detector';
import type { Bindings } from '../src/types';

const bindings = env as unknown as Bindings;

function algoliaResponse(
  ids: readonly number[],
  page = 0,
  totalPages = 1,
): Response {
  return Response.json({
    hits: ids.map((id) => ({
      objectID: String(id),
      created_at_i: Math.floor(Date.now() / 1000),
      points: 1001,
    })),
    page,
    nbPages: totalPages,
  });
}

function firebaseResponse(id: number, score: number): Response {
  return Response.json({
    id,
    type: 'story',
    title: `Story ${id}`,
    score,
    time: Math.floor(Date.now() / 1000),
  });
}

function mockSources(
  ids: readonly number[],
  scores: Readonly<Record<number, number>>,
): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'hn.algolia.com') return algoliaResponse(ids);
    if (url.hostname === 'hacker-news.firebaseio.com') {
      const id = Number(/\/item\/(\d+)\.json$/u.exec(url.pathname)?.[1]);
      const score = scores[id];
      if (score === undefined) return new Response(null, { status: 503 });
      return firebaseResponse(id, score);
    }
    return new Response(null, { status: 500 });
  });
}

beforeEach(async () => {
  await bindings.PUSH_DB.batch([
    bindings.PUSH_DB.prepare('DELETE FROM deliveries'),
    bindings.PUSH_DB.prepare('DELETE FROM stories'),
    bindings.PUSH_DB.prepare('DELETE FROM subscriptions'),
    bindings.PUSH_DB.prepare(
      `UPDATE app_state
          SET phase = 'BOOTSTRAPPING',
              bootstrap_from = NULL,
              bootstrap_to = NULL,
              bootstrap_page = 0,
              bootstrap_total_pages = NULL,
              detector_lease_token = NULL,
              detector_lease_expires_at = NULL,
              delivery_circuit_until = NULL,
              delivery_circuit_reason = NULL,
              queue_publishing_paused = 0,
              last_successful_scan_at = NULL,
              updated_at = ?1
        WHERE id = 1`,
    ).bind(Date.now()),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detector', () => {
  it('seeds qualifying bootstrap stories without fan-out', async () => {
    mockSources([101], { 101: 1200 });
    await runDetector(bindings);

    const story = await bindings.PUSH_DB
      .prepare(
        `SELECT verification_state, event_state, score
           FROM stories
          WHERE story_id = 101`,
      )
      .first<{
        verification_state: string;
        event_state: string;
        score: number;
      }>();
    expect(story).toEqual({
      verification_state: 'seeded',
      event_state: 'none',
      score: 1200,
    });

    const state = await bindings.PUSH_DB
      .prepare('SELECT phase FROM app_state WHERE id = 1')
      .first<{ phase: string }>();
    expect(state?.phase).toBe('ACTIVE');
  });

  it('finishes bootstrap safely after bounded transient verification failures', async () => {
    mockSources([109], {});

    for (
      let attempt = 0;
      attempt < MAX_BOOTSTRAP_VERIFICATION_ATTEMPTS;
      attempt += 1
    ) {
      await runDetector(bindings);
    }

    const state = await bindings.PUSH_DB
      .prepare('SELECT phase FROM app_state WHERE id = 1')
      .first<{ phase: string }>();
    const story = await bindings.PUSH_DB
      .prepare(
        `SELECT verification_state, verification_attempts,
                last_verification_error, event_state
           FROM stories
          WHERE story_id = 109`,
      )
      .first<{
        verification_state: string;
        verification_attempts: number;
        last_verification_error: string | null;
        event_state: string;
      }>();

    expect(state?.phase).toBe('ACTIVE');
    expect(story).toEqual({
      verification_state: 'seeded',
      verification_attempts: MAX_BOOTSTRAP_VERIFICATION_ATTEMPTS,
      last_verification_error: 'bootstrap_verification_deferred',
      event_state: 'none',
    });
  });

  it('resumes a frozen multi-page bootstrap before activating', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof URL
        ? input
        : new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname === 'hn.algolia.com') {
        const page = Number(url.searchParams.get('page'));
        return page === 0
          ? algoliaResponse([111], 0, 2)
          : algoliaResponse([112], 1, 2);
      }
      if (url.hostname === 'hacker-news.firebaseio.com') {
        const id = Number(/\/item\/(\d+)\.json$/u.exec(url.pathname)?.[1]);
        return firebaseResponse(id, 1200);
      }
      return new Response(null, { status: 500 });
    });

    await runDetector(bindings);
    let state = await bindings.PUSH_DB
      .prepare(
        `SELECT phase, bootstrap_page, bootstrap_total_pages
           FROM app_state
          WHERE id = 1`,
      )
      .first<{
        phase: string;
        bootstrap_page: number;
        bootstrap_total_pages: number | null;
      }>();
    expect(state).toEqual({
      phase: 'BOOTSTRAPPING',
      bootstrap_page: 1,
      bootstrap_total_pages: 2,
    });

    await runDetector(bindings);
    state = await bindings.PUSH_DB
      .prepare(
        `SELECT phase, bootstrap_page, bootstrap_total_pages
           FROM app_state
          WHERE id = 1`,
      )
      .first<{
        phase: string;
        bootstrap_page: number;
        bootstrap_total_pages: number | null;
      }>();
    expect(state).toEqual({
      phase: 'ACTIVE',
      bootstrap_page: 2,
      bootstrap_total_pages: 2,
    });
    const stories = await bindings.PUSH_DB
      .prepare(
        `SELECT story_id, verification_state, event_state
           FROM stories
          WHERE story_id IN (111, 112)
          ORDER BY story_id`,
      )
      .all<{
        story_id: number;
        verification_state: string;
        event_state: string;
      }>();
    expect(stories.results).toEqual([
      { story_id: 111, verification_state: 'seeded', event_state: 'none' },
      { story_id: 112, verification_state: 'seeded', event_state: 'none' },
    ]);
  });

  it('bulk inserts discovery results and bounds verification query headroom', async () => {
    const ids = Array.from(
      { length: MAX_FIREBASE_CHECKS_PER_RUN + 15 },
      (_, index) => 3000 + index,
    );
    const scores = Object.fromEntries(
      ids.map((id) => [id, 1200]),
    ) as Record<number, number>;
    mockSources(ids, scores);

    await runDetector(bindings);

    const counts = await bindings.PUSH_DB
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN verification_attempts = 1 THEN 1 ELSE 0 END) AS verified
           FROM stories
          WHERE story_id >= 3000`,
      )
      .first<{ total: number; verified: number }>();
    expect(counts).toEqual({
      total: ids.length,
      verified: MAX_FIREBASE_CHECKS_PER_RUN,
    });
    expect(DETECTOR_D1_QUERY_UPPER_BOUND).toBeLessThanOrEqual(
      D1_FREE_QUERY_LIMIT - DETECTOR_D1_QUERY_HEADROOM,
    );
  });

  it('keeps score 1000 recheckable and creates one event at 1001', async () => {
    mockSources([202], { 202: 1000 });
    await runDetector(bindings);

    let story = await bindings.PUSH_DB
      .prepare(
        `SELECT verification_state, event_state
           FROM stories
          WHERE story_id = 202`,
      )
      .first<{ verification_state: string; event_state: string }>();
    expect(story).toEqual({
      verification_state: 'candidate',
      event_state: 'none',
    });

    await bindings.PUSH_DB
      .prepare('UPDATE stories SET next_check_at = 0 WHERE story_id = 202')
      .run();
    vi.restoreAllMocks();
    mockSources([202], { 202: 1001 });
    await runDetector(bindings);

    story = await bindings.PUSH_DB
      .prepare(
        `SELECT verification_state, event_state
           FROM stories
          WHERE story_id = 202`,
      )
      .first<{ verification_state: string; event_state: string }>();
    expect(story).toEqual({
      verification_state: 'event',
      event_state: 'fanout_pending',
    });

    await bindings.PUSH_DB
      .prepare('UPDATE stories SET next_check_at = 0 WHERE story_id = 202')
      .run();
    await runDetector(bindings);
    const count = await bindings.PUSH_DB
      .prepare(
        `SELECT COUNT(*) AS count
           FROM stories
          WHERE story_id = 202
            AND verification_state = 'event'`,
      )
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it('does not let repeatedly failing candidates starve a new story', async () => {
    await bindings.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET phase = 'ACTIVE',
                updated_at = ?1
          WHERE id = 1`,
      )
      .bind(Date.now())
      .run();
    const failingIds = Array.from(
      { length: MAX_FIREBASE_CHECKS_PER_RUN },
      (_, index) => index + 1,
    );
    mockSources([...failingIds, 999], { 999: 1200 });

    await runDetector(bindings);
    let story = await bindings.PUSH_DB
      .prepare(
        `SELECT verification_state, verification_attempts
           FROM stories
          WHERE story_id = 999`,
      )
      .first<{
        verification_state: string;
        verification_attempts: number;
      }>();
    expect(story).toEqual({
      verification_state: 'candidate',
      verification_attempts: 0,
    });

    await bindings.PUSH_DB
      .prepare(
        `UPDATE stories
            SET next_check_at = 0
          WHERE verification_state = 'candidate'`,
      )
      .run();
    await runDetector(bindings);

    story = await bindings.PUSH_DB
      .prepare(
        `SELECT verification_state, verification_attempts
           FROM stories
          WHERE story_id = 999`,
      )
      .first<{
        verification_state: string;
        verification_attempts: number;
      }>();
    expect(story).toEqual({
      verification_state: 'event',
      verification_attempts: 1,
    });
  });

  it('commits an event without publishing fan-out while the circuit is open', async () => {
    const now = Date.now();
    await bindings.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET phase = 'ACTIVE',
                delivery_circuit_until = ?1,
                delivery_circuit_reason = 'test',
                updated_at = ?2
          WHERE id = 1`,
      )
      .bind(now + 60_000, now)
      .run();
    mockSources([1000], { 1000: 1200 });

    await runDetector(bindings);

    const story = await bindings.PUSH_DB
      .prepare(
        `SELECT verification_state, event_state, fanout_wake_at
           FROM stories
          WHERE story_id = 1000`,
      )
      .first<{
        verification_state: string;
        event_state: string;
        fanout_wake_at: number | null;
      }>();
    expect(story).toEqual({
      verification_state: 'event',
      event_state: 'fanout_pending',
      fanout_wake_at: null,
    });
  });

  it('does not report a successful scan when Firebase verification is transient', async () => {
    const previousScan = Date.now() - 60_000;
    await bindings.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET phase = 'ACTIVE',
                last_successful_scan_at = ?1,
                updated_at = ?2
          WHERE id = 1`,
      )
      .bind(previousScan, Date.now())
      .run();
    mockSources([1200], {});

    await runDetector(bindings);

    const state = await bindings.PUSH_DB
      .prepare('SELECT last_successful_scan_at FROM app_state WHERE id = 1')
      .first<{ last_successful_scan_at: number | null }>();
    expect(state?.last_successful_scan_at).toBe(previousScan);
  });

  it('cannot seed bootstrap candidates after its detector lease is fenced out', async () => {
    let releaseAlgolia: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input instanceof URL
        ? input
        : new URL(typeof input === 'string' ? input : input.url);
      if (url.hostname === 'hn.algolia.com') {
        return new Promise<Response>((resolve) => {
          releaseAlgolia = resolve;
        });
      }
      return firebaseResponse(1300, 1200);
    });

    const staleRun = runDetector(bindings);
    await vi.waitFor(() => expect(releaseAlgolia).toBeTypeOf('function'));
    await bindings.PUSH_DB
      .prepare(
        `UPDATE app_state
            SET phase = 'ACTIVE',
                detector_lease_token = 'replacement',
                detector_lease_expires_at = ?1,
                updated_at = ?2
          WHERE id = 1`,
      )
      .bind(Date.now() + 60_000, Date.now())
      .run();
    releaseAlgolia?.(algoliaResponse([1300]));
    await staleRun;

    const story = await bindings.PUSH_DB
      .prepare('SELECT story_id FROM stories WHERE story_id = 1300')
      .first<{ story_id: number }>();
    expect(story).toBeNull();
  });
});
