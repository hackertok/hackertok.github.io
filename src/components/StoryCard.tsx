import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import { ChevronUp, Clock, Globe, MessageSquare } from 'lucide-react';
import { getHostname } from '../api/hn';
import { usePrefetchItem, cancelAllPrefetches } from '../hooks/usePrefetchItem';
import { useIsViewed, markViewedWithTime } from '../utils/viewedItems';
import { metaItemClass, metaPillClass } from '../lib/classes';
import { AuthorByline } from './AuthorByline';
import { RelativeTime } from './RelativeTime';
import type { StoryItem, LocationState, FeedType } from '../types';

interface StoryCardProps {
  story: StoryItem;
  index?: number;
  listType?: string;
  /**
   * When set, internal links (title for text posts, comments) write
   * `{ fromDomain }` into location.state instead of `{ from: listType }`.
   * This keeps the Header's "from" indicator active and ItemDetail's
   * back link pointing at the domain page across navigation.
   */
  fromDomain?: string;
  /**
   * When set, internal links write `{ fromUser }` into location.state.
   * Wins over `fromDomain` and `from` because user submissions are the
   * most specific origin (a card may be authored by `fromUser` and live on
   * `fromDomain`, but the user route is the one we want to return to).
   */
  fromUser?: string;
  onBeforeNavigate?: () => void;
}

export function StoryCard({ story, index = 0, listType = 'top', fromDomain, fromUser, onBeforeNavigate }: StoryCardProps) {
  const hostname = getHostname(story.url);
  const { startPrefetch, stopPrefetch } = usePrefetchItem();
  const isPrefetchingRef = useRef(false);
  const wasInExitZoneRef = useRef(false); // Track if card was ever in exit zone
  
  // Observe visibility with 800px margin for starting prefetch (eager)
  const { ref: enterRef, inView: enterInView } = useInView({
    rootMargin: '800px',
  });
  
  // Observe visibility with -100px margin for stopping prefetch (only abort when well off-screen)
  const { ref: exitRef, inView: exitInView } = useInView({
    rootMargin: '-100px',
  });
  
  // Merge refs to attach both observers to the same element
  const setRefs = useCallback((node: Element | null) => {
    enterRef(node);
    exitRef(node);
  }, [enterRef, exitRef]);
  
  // Reactive viewed status from localStorage store
  const viewed = useIsViewed(story.id);

  // Origin priority: fromUser > fromDomain > from (list type).
  // The most specific origin wins so the Header indicator stays active and
  // ItemDetail's back action resolves to that origin's page instead of
  // falling through to the default feed.
  const linkState: LocationState = useMemo(
    () => (fromUser
      ? { fromUser }
      : fromDomain
        ? { fromDomain }
        : { from: listType as FeedType }),
    [fromUser, fromDomain, listType],
  );
  
  // Handle internal title click: mark as viewed, save session state and cancel prefetches
  const handleTitleClick = () => {
    markViewedWithTime(story.id);
    cancelAllPrefetches();
    if (onBeforeNavigate) {
      onBeforeNavigate();
    }
  };
  
  // Handle comments click: save session state and cancel prefetches
  // For text posts (Ask HN), also mark as viewed since comments IS the content
  const handleCommentsClick = () => {
    if (!story.url) {
      markViewedWithTime(story.id);
    }
    cancelAllPrefetches();
    if (onBeforeNavigate) {
      onBeforeNavigate();
    }
  };
  
  // Start prefetch when card enters expanded viewport (800px margin)
  // Pass index for priority ordering (lower index = prefetch first)
  // Re-prefetches if cache was evicted while scrolled away
  useEffect(() => {
    if (enterInView) {
      isPrefetchingRef.current = true;
      startPrefetch(story.id, index);
    }
  }, [enterInView, story.id, index, startPrefetch]);
  
  // Track when card enters the tight exit zone
  useEffect(() => {
    if (exitInView) {
      wasInExitZoneRef.current = true;
    }
  }, [exitInView]);
  
  // Stop prefetch only when card LEAVES the tight viewport (was in, now out)
  useEffect(() => {
    if (!exitInView && wasInExitZoneRef.current && isPrefetchingRef.current) {
      isPrefetchingRef.current = false;
      stopPrefetch();
    }
  }, [exitInView, stopPrefetch]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isPrefetchingRef.current) {
        stopPrefetch();
      }
    };
  }, [stopPrefetch]);

  return (
    <article ref={setRefs} className="py-3 first:pt-0" data-testid="story-card" data-story-id={story.id} data-viewed={viewed}>
      <div className="space-y-1.5">
        {/* Title — hostname now lives in the meta row below as `[Globe] domain`,
            so the title stays paren-free and reads clean. */}
        <h2 className="text-base leading-snug font-semibold">
          {story.url ? (
            <a
              href={story.url}
              rel="noreferrer"
              className={`hover:text-accent transition-colors ${
                viewed
                  ? 'text-viewed'
                  : 'text-foreground'
              }`}
              onClick={() => markViewedWithTime(story.id)}
            >
              {story.title}
            </a>
          ) : (
            <Link
              to={`/item/${story.id}`}
              state={linkState}
              onClick={handleTitleClick}
              className={`hover:text-accent transition-colors ${
                viewed
                  ? 'text-viewed'
                  : 'text-foreground'
              }`}
            >
              {story.title}
            </Link>
          )}
        </h2>

        {/* Meta row — flex with leading icons, NO dot/pipe separators (gap only).
            Order: points → domain → time → user → comments. Points / domain /
            time form a quick-scan header (score, source, recency) so a user
            can triage the card without parsing an author name first; user
            follows for attribution; comments lands last as the explicit
            "click to read the discussion" action.

            Layout: `metaItemClass` for non-clickable spans, `metaPillClass`
            for the link variants. See `src/lib/classes.ts` for the full
            rationale on the negative-margin pill trick + axe compliance via
            font-medium. AuthorByline + RelativeTime collapse the
            byline-and-time-stamp pair shared with ItemArticle / CommentArticle
            into a single source of truth. */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground">
          <span className={metaItemClass}>
            <ChevronUp aria-hidden className="size-3.5" />
            <span>{story.points ?? 0} points</span>
          </span>

          {hostname && (
            <Link to={`/from/${hostname}`} className={metaPillClass}>
              <Globe aria-hidden className="size-3.5" />
              {hostname}
            </Link>
          )}

          <span className={metaItemClass}>
            <Clock aria-hidden className="size-3.5" />
            <RelativeTime timestamp={story.createdAt} />
          </span>

          <AuthorByline author={story.author} />

          <Link
            to={`/item/${story.id}`}
            state={linkState}
            onClick={handleCommentsClick}
            className={metaPillClass}
          >
            <MessageSquare aria-hidden className="size-3.5" />
            {story.commentCount ?? 0} comments
          </Link>
        </div>
      </div>
    </article>
  );
}
