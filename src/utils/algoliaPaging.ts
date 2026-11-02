import type { AlgoliaSearchResponse } from '../types';

/** Where the next `search_by_date` request starts. */
export interface AlgoliaPageCursor {
  page: number;
  /** Only hits created at or before this time (unix seconds). */
  before?: number;
}

export function algoliaPageParams({ page, before }: AlgoliaPageCursor): string {
  const filter = before === undefined ? '' : `&numericFilters=${encodeURIComponent(`created_at_i<=${before}`)}`;
  return `&page=${page}${filter}`;
}

// Search returns at most 1,000 hits and caps nbPages to match. A query search
// can also stop counting early and size nbPages from an estimate, so a full
// last page may not be the end either. Results are newest first, so past the
// last page the next request starts over at page 0 from the oldest hit so far.
// That hit comes back once; callers already dedup.
export function nextAlgoliaPage(
  data: AlgoliaSearchResponse,
  hitsPerPage: number,
  cursor: AlgoliaPageCursor,
): AlgoliaPageCursor | null {
  if (data.page < data.nbPages - 1) return { ...cursor, page: data.page + 1 };

  const oldest = data.hits[data.hits.length - 1]?.created_at_i;
  const isCapped = data.nbHits > data.nbPages * hitsPerPage;
  const mayHaveMore = data.exhaustiveNbHits === false && data.hits.length >= hitsPerPage;
  if ((isCapped || mayHaveMore) && oldest !== undefined && oldest !== cursor.before) {
    return { page: 0, before: oldest };
  }
  return null;
}
