import { useMemo } from 'react';
import { Link } from 'react-router';
import { ChevronUp, Clock, Vote } from 'lucide-react';
import { htmlToText, sanitizeHtml } from '../utils/sanitize';
import { itemPermalink } from '../utils/share';
import { metaItemClass, metaPillClass } from '../lib/classes';
import { AuthorByline } from './AuthorByline';
import { RelativeTime } from './RelativeTime';
import { ShareButton } from './ShareButton';
import type { PollOptionItem } from '../types';

interface PollOptionArticleProps {
  option: PollOptionItem;
}

/**
 * A poll option on its own page: its points, a link to its poll, and its text,
 * which HN shows like a comment's.
 */
export function PollOptionArticle({ option }: PollOptionArticleProps) {
  const sanitizedText = useMemo(() => sanitizeHtml(option.text), [option.text]);
  const plainText = useMemo(() => htmlToText(option.text), [option.text]);

  return (
    <article className="mb-6 pb-4 border-b border-border">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground mb-3">
        <span className={metaItemClass}>
          <ChevronUp aria-hidden className="size-3.5" />
          <span>{option.points} {option.points === 1 ? 'point' : 'points'}</span>
        </span>

        <span className={metaItemClass}>
          <Clock aria-hidden className="size-3.5" />
          <RelativeTime timestamp={option.createdAt} />
        </span>

        <AuthorByline author={option.author} emptyFallback="hide" />

        {option.poll > 0 && (
          // min-w-0 max-w-full enables truncation; shrink-0 keeps icon visible.
          <Link
            to={`/item/${option.poll}`}
            state={{ isComment: false }}
            className={`${metaPillClass} min-w-0 max-w-full`}
          >
            <Vote aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{option.pollTitle ?? 'poll'}</span>
          </Link>
        )}

        <ShareButton title={plainText || 'Poll option'} url={itemPermalink(option.id)} />
      </div>

      {sanitizedText && (
        <div
          className="comment-content text-foreground text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: sanitizedText }}
        />
      )}
    </article>
  );
}
