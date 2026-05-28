import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchTaggedStoriesForDay, fetchAskStoriesForDay, fetchShowStoriesForDay } from './hn';

const mockAlgoliaResponse = (hits: object[]) => ({
  hits,
  nbHits: hits.length,
  page: 0,
  nbPages: 1,
  hitsPerPage: 30,
});

function makeHit(id: number, title: string, points: number, tags: string[] = []) {
  return {
    objectID: String(id),
    title,
    url: `https://example.com/${id}`,
    author: 'testuser',
    points,
    created_at_i: Math.floor(Date.now() / 1000) - 3600,
    num_comments: 10,
    _tags: tags,
  };
}

describe('fetchTaggedStoriesForDay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches stories for a given tag and day', async () => {
    const hits = [
      makeHit(1, 'Ask HN: Test?', 100, ['ask_hn']),
      makeHit(2, 'Ask HN: Another', 50, ['ask_hn']),
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAlgoliaResponse(hits),
    });

    const result = await fetchTaggedStoriesForDay('ask_hn', 1);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1); // Higher points first
    expect(result[1].id).toBe(2);
    expect(result[0].type).toBe('ask');
  });

  it('sorts results by points descending', async () => {
    const hits = [
      makeHit(1, 'Low points', 10, ['ask_hn']),
      makeHit(2, 'High points', 200, ['ask_hn']),
      makeHit(3, 'Mid points', 50, ['ask_hn']),
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAlgoliaResponse(hits),
    });

    const result = await fetchTaggedStoriesForDay('ask_hn', 2);

    expect(result[0].points).toBe(200);
    expect(result[1].points).toBe(50);
    expect(result[2].points).toBe(10);
  });

  it('filters titles when excludeTitles is provided', async () => {
    const hits = [
      makeHit(1, 'Ask HN: Who is hiring? (May 2026)', 300, ['ask_hn']),
      makeHit(2, 'Ask HN: Real question', 100, ['ask_hn']),
      makeHit(3, 'Ask HN: Who wants to be hired? (May 2026)', 250, ['ask_hn']),
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAlgoliaResponse(hits),
    });

    const result = await fetchTaggedStoriesForDay('ask_hn', 1, [
      'who is hiring',
      'who wants to be hired',
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Ask HN: Real question');
  });

  it('does not filter when excludeTitles is empty', async () => {
    const hits = [
      makeHit(1, 'Show HN: Something', 100, ['show_hn']),
      makeHit(2, 'Show HN: Who is hiring helper', 50, ['show_hn']),
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAlgoliaResponse(hits),
    });

    const result = await fetchTaggedStoriesForDay('show_hn', 1);

    expect(result).toHaveLength(2);
  });

  it('throws on non-OK response', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(fetchTaggedStoriesForDay('ask_hn', 1)).rejects.toThrow(
      'Failed to fetch ask_hn stories: 500',
    );
  });

  it('includes correct numericFilters in the request URL', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAlgoliaResponse([]),
    });

    await fetchTaggedStoriesForDay('show_hn', 3);

    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('tags=story,show_hn');
    expect(url).toContain('numericFilters=created_at_i>=');
    expect(url).toContain('hitsPerPage=30');
  });

  it('correctly maps show_hn tag to type "show"', async () => {
    const hits = [makeHit(1, 'Show HN: Test', 100, ['show_hn'])];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAlgoliaResponse(hits),
    });

    const result = await fetchTaggedStoriesForDay('show_hn', 1);

    expect(result[0].type).toBe('show');
  });
});

describe('fetchAskStoriesForDay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes hiring threads', async () => {
    const hits = [
      makeHit(1, 'Ask HN: Who is hiring? (May 2026)', 300, ['ask_hn']),
      makeHit(2, 'Ask HN: Good question', 100, ['ask_hn']),
      makeHit(3, 'Ask HN: Freelancer? Seeking Freelancer', 80, ['ask_hn']),
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAlgoliaResponse(hits),
    });

    const result = await fetchAskStoriesForDay(1);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Ask HN: Good question');
  });
});

describe('fetchShowStoriesForDay', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not filter any titles', async () => {
    const hits = [
      makeHit(1, 'Show HN: Who is hiring dashboard', 200, ['show_hn']),
      makeHit(2, 'Show HN: My project', 100, ['show_hn']),
    ];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockAlgoliaResponse(hits),
    });

    const result = await fetchShowStoriesForDay(1);

    expect(result).toHaveLength(2);
  });
});
