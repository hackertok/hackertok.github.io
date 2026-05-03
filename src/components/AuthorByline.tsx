import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import { isKnownAuthor } from '../api/hn';
import { metaPillClass } from '../lib/classes';

/**
 * Wraps an author Link / handle with the OP badge so the badge is a
 * SIBLING of the link (keeps the link's accessible name as just the
 * handle — `getByRole('link', { name: '<author>' })` still resolves)
 * and shares the `gap-1.5` spacing across compact (Comment) and focal
 * (AuthorByline) bylines.
 */
export function OpWrap({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <span className="op-badge" data-is-op="true" aria-label="Original poster">
        OP
      </span>
    </span>
  );
}

interface AuthorBylineProps {
  author: string | null | undefined;
  /**
   * What to render when `author` is empty/null. (The literal
   * `'unknown'` always renders as the "unknown" placeholder span so
   * the meta-row rhythm doesn't shift.)
   *
   *   - `'show-unknown'` (default): "unknown" placeholder. Used by
   *     StoryCard and CommentArticle so the byline always contributes
   *     a glyph to the gap-driven meta-row layout.
   *   - `'hide'`: render `null`. Used by ItemArticle where the detail
   *     page has room to silently drop the slot.
   */
  emptyFallback?: 'show-unknown' | 'hide';
  /**
   * When true, decorate the byline with an `OP` badge. Caller MUST
   * guard with `isKnownAuthor(storyAuthor)` so empty / 'unknown'
   * story authors don't OP-decorate every fallback name.
   */
  isOp?: boolean;
  /**
   * Click handler attached to the inner `<Link>` only — the
   * non-link "unknown" placeholder branch ignores it because there's
   * nothing to navigate from. StoryCard wires this to its
   * `saveScrollPosition` so the source list's scroll position is
   * snapshotted before the user lands on `/user/<author>`.
   */
  onClick?: () => void;
}

/**
 * Author byline for the meta row — a `User`-icon + handle pill that
 * navigates to `/user/<author>` when the handle is real, and falls
 * back to a non-link span otherwise. Centralises the `isKnownAuthor`
 * guard so StoryCard / ItemArticle / CommentArticle stay in lockstep,
 * including the `font-medium` weight delta that satisfies axe's
 * `link-in-text-block` colour-only rule.
 */
export function AuthorByline({
  author,
  emptyFallback = 'show-unknown',
  isOp = false,
  onClick,
}: AuthorBylineProps) {
  if (isKnownAuthor(author)) {
    if (!isOp) {
      return (
        <Link
          to={`/user/${author}`}
          onClick={onClick}
          className={`${metaPillClass} font-medium`}
        >
          <User aria-hidden className="size-3.5" />
          {author}
        </Link>
      );
    }
    // OP variant: `OpWrap` puts the badge as a SIBLING of the Link
    // (keeps the link's accessible name as just the author handle, no
    // "OP" suffix bleed). The inner Link drops `metaPillClass` because
    // that class's `-mx-1.5 -my-0.5` negative margins would extend OUT
    // of the wrapper into adjacent meta-row items (Globe / Clock pills)
    // and cause overlap. The substitute `hover:text-accent` is axe-OK
    // here because the OP variant also has the always-visible badge +
    // bolder weight, so hover colour isn't the only "I'm clickable"
    // affordance.
    return (
      <OpWrap>
        <Link
          to={`/user/${author}`}
          onClick={onClick}
          className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-accent transition-colors"
        >
          <User aria-hidden className="size-3.5" />
          {author}
        </Link>
      </OpWrap>
    );
  }

  if (!author && emptyFallback === 'hide') return null;

  // `||` (not `??`) is intentional — both `null/undefined` AND the
  // empty string upstream-fallback should render "unknown"; `??` would
  // leave `''` as a blank span and break `screen.getByText('unknown')`
  // assertions in StoryCard / Comment / CommentArticle tests.
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <User aria-hidden className="size-3.5" />
      {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
      {author || 'unknown'}
    </span>
  );
}
