import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { User } from 'lucide-react';
import { isKnownAuthor } from '../api/hn';
import { metaPillClass } from '../lib/classes';

/**
 * OP badge wrapper — badge as sibling keeps link's accessible name clean.
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
  /** `'show-unknown'` (default) or `'hide'` when author is empty. */
  emptyFallback?: 'show-unknown' | 'hide';
  /** OP badge. Caller guards with isKnownAuthor. */
  isOp?: boolean;
  /** Click handler for inner Link (e.g. scroll snapshot). */
  onClick?: () => void;
}

/** Author byline pill with link (real handle) or plain span (unknown). */
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
          className={metaPillClass}
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
    // here because the OP variant already carries an always-visible
    // badge, so the hover colour is additive rather than the only
    // distinctive treatment in that byline slot.
    return (
      <OpWrap>
        <Link
          to={`/user/${author}`}
          onClick={onClick}
          className="inline-flex items-center gap-1.5 text-foreground hover:text-accent active:text-accent transition-colors"
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
    <span className="inline-flex items-center gap-1.5">
      <User aria-hidden className="size-3.5" />
      {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
      {author || 'unknown'}
    </span>
  );
}
