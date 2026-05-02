import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import { isKnownAuthor } from '../api/hn';
import { metaPillClass } from '../lib/classes';

interface AuthorBylineProps {
  author: string | null | undefined;
  /**
   * Behavior when `author` is empty/null (NOT when it's the literal
   * `'unknown'` — that always renders as a fallback span with the text
   * "unknown" so the meta-row rhythm doesn't shift):
   *
   *   - `'show-unknown'` (default): render a fallback span with the text
   *     "unknown". Used by `StoryCard` and `CommentArticle` so the byline
   *     slot always contributes a glyph (the User icon + label) to the
   *     meta row's gap-driven layout.
   *   - `'hide'`: render `null` entirely. Used by `ItemArticle` because
   *     the detail page has more vertical room and a missing author there
   *     should silently drop the slot rather than mint a placeholder.
   */
  emptyFallback?: 'show-unknown' | 'hide';
}

/**
 * Author byline for the meta row — a `User`-icon + handle pill that
 * navigates to `/user/<author>` when the handle is real, and falls back
 * to a non-link span otherwise. Centralises the `isKnownAuthor` guard
 * (HN sends the literal `'unknown'` for orphaned items, and empty
 * strings slip through `?? ''` fallbacks elsewhere in the pipeline) so
 * StoryCard / ItemArticle / CommentArticle stay in lockstep — including
 * the `font-medium` weight delta, which is what satisfies axe's
 * `link-in-text-block` colour-only rule across all three callsites.
 */
export function AuthorByline({
  author,
  emptyFallback = 'show-unknown',
}: AuthorBylineProps) {
  if (isKnownAuthor(author)) {
    return (
      <Link
        to={`/user/${author}`}
        className={`${metaPillClass} font-medium`}
      >
        <User aria-hidden className="size-3.5" />
        {author}
      </Link>
    );
  }

  if (!author && emptyFallback === 'hide') return null;

  // Either author === 'unknown' literally, or author is falsy and the
  // caller asked for the placeholder. The fallback span uses the bare
  // inline-flex layout (no pill backdrop — it's not clickable, so the
  // hover bg would be a false affordance) but keeps `font-medium` so
  // the byline slot has the same visual weight as the link variant.
  // `||` (not `??`) is intentional — both `null/undefined` AND the
  // empty string upstream-fallback should render the "unknown"
  // placeholder; `?? 'unknown'` would leave `''` as a blank span and
  // break the `screen.getByText('unknown')` contract in StoryCard /
  // Comment / CommentArticle tests.
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <User aria-hidden className="size-3.5" />
      {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
      {author || 'unknown'}
    </span>
  );
}
