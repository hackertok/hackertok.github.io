import { useEffect, useRef, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import { ChevronUp, Clock, Globe, MessageSquare } from 'lucide-react';
import { getHostname } from '../api/hn';
import { usePrefetchItem, cancelAllPrefetches } from '../hooks/usePrefetchItem';
import { useIsViewed, markViewedWithTime } from '../utils/viewedItems';
import { metaItemClass, metaPillClass } from '../lib/classes';
import { AuthorByline } from './AuthorByline';
import { RelativeTime } from './RelativeTime';
import { decayDelay } from '../lib/staggerDelay';
import type { StoryItem, LocationState, FeedType } from '../types';

interface StoryCardProps {
  story: StoryItem;
  index?: number;
  listType?: string;
  /**
   * When set, internal links write `{ fromDomain }` into
   * location.state so Header's "from" indicator stays active and
   * ItemDetail's back link routes to the domain page.
   */
  fromDomain?: string;
  /**
   * Wins over `fromDomain` and `from` because user submissions are
   * the most specific origin.
   */
  fromUser?: string;
  onBeforeNavigate?: () => void;
  /**
   * 0-indexed slot in the StoryList entry cascade. CSS scope
   * (`.page-stage.play-real`) gates the animation to the initial
   * cascade window; appended cards past `'done'` mount at opacity 1.
   */
  stageIdx?: number;
  /**
   * 0-indexed slot WITHIN an infinite-scroll append batch. Picks up
   * the unscoped `.append-fade` rule so the cascade fires on every
   * post-cold-load mount (`.stagger-fade`'s `.page-stage.play-real`
   * scope no longer matches in `'done'`).
   */
  appendIdx?: number;
}

export function StoryCard({ story, index = 0, listType = 'top', fromDomain, fromUser, onBeforeNavigate, stageIdx, appendIdx }: StoryCardProps) {
  const hostname = getHostname(story.url);
  const { startPrefetch, stopPrefetch } = usePrefetchItem();
  const isPrefetchingRef = useRef(false);
  const wasInExitZoneRef = useRef(false);

  // Eager 800px enter margin starts prefetch early; tight -100px exit
  // margin only aborts when the card is well off-screen, avoiding
  // thrash when scrolling past the same card multiple times.
  const { ref: enterRef, inView: enterInView } = useInView({
    rootMargin: '800px',
  });
  const { ref: exitRef, inView: exitInView } = useInView({
    rootMargin: '-100px',
  });

  const setRefs = useCallback((node: Element | null) => {
    enterRef(node);
    exitRef(node);
  }, [enterRef, exitRef]);

  const viewed = useIsViewed(story.id);

  // Origin priority: fromUser > fromDomain > from (list type) — the
  // most specific origin wins so Header's indicator and ItemDetail's
  // back action resolve to that origin's page.
  const linkState: LocationState = useMemo(
    () => (fromUser
      ? { fromUser }
      : fromDomain
        ? { fromDomain }
        : { from: listType as FeedType }),
    [fromUser, fromDomain, listType],
  );

  const handleTitleClick = () => {
    markViewedWithTime(story.id);
    cancelAllPrefetches();
    if (onBeforeNavigate) {
      onBeforeNavigate();
    }
  };

  // Sibling-list navigation: domain pill / author byline. Same
  // prefetch-cancel + scroll-snapshot as the title/comments handlers,
  // but DELIBERATELY NOT `markViewedWithTime` — the user is hopping
  // to a peer list, not engaging with this story's content, so the
  // viewed-state wouldn't reflect a real read.
  const handleSiblingNavigate = () => {
    cancelAllPrefetches();
    if (onBeforeNavigate) {
      onBeforeNavigate();
    }
  };

  // For text posts (Ask HN), mark viewed on the comments click too —
  // the comments page IS the content for those.
  const handleCommentsClick = () => {
    if (!story.url) {
      markViewedWithTime(story.id);
    }
    cancelAllPrefetches();
    if (onBeforeNavigate) {
      onBeforeNavigate();
    }
  };

  // `index` is the prefetch priority hint (lower = sooner). Re-fires
  // if the card re-enters viewport after cache eviction.
  useEffect(() => {
    if (enterInView) {
      isPrefetchingRef.current = true;
      startPrefetch(story.id, index);
    }
  }, [enterInView, story.id, index, startPrefetch]);

  useEffect(() => {
    if (exitInView) {
      wasInExitZoneRef.current = true;
    }
  }, [exitInView]);

  // Only abort once the card has actually crossed the tight exit zone
  // — guards against aborting prefetches for cards that are still
  // visible but happen to fail the strict inView check briefly.
  useEffect(() => {
    if (!exitInView && wasInExitZoneRef.current && isPrefetchingRef.current) {
      isPrefetchingRef.current = false;
      stopPrefetch();
    }
  }, [exitInView, stopPrefetch]);

  useEffect(() => {
    return () => {
      if (isPrefetchingRef.current) {
        stopPrefetch();
      }
    };
  }, [stopPrefetch]);

  // Snapshot the slot at mount (lazy `useState` init) so the parent's
  // `useStaggerCascadeSlots` advancing its `batchStart` on a NEXT
  // fetch can't (a) cancel a mid-flight `.append-fade` animation or
  // (b) mutate `--stagger-delay` on a settled card. `stageIdx` wins
  // over `appendIdx` when both are passed — the initial cascade is
  // owned by PageStage's play-real window, while append fires
  // unconditionally on mount; passing both would double-animate.
  const [animationSlot] = useState<
    | { kind: 'stage'; idx: number }
    | { kind: 'append'; idx: number }
    | null
  >(() => {
    if (stageIdx !== undefined) return { kind: 'stage', idx: stageIdx };
    if (appendIdx !== undefined) return { kind: 'append', idx: appendIdx };
    return null;
  });

  const wrapperBaseClass = 'py-3 first:pt-0 rounded-lg hover:bg-muted/30 -mx-3 px-3';
  const animClass =
    animationSlot?.kind === 'stage' ? ' stagger-fade'
    : animationSlot?.kind === 'append' ? ' append-fade'
    : '';
  const wrapperClass = `${wrapperBaseClass}${animClass}`;
  const wrapperStyle: CSSProperties | undefined = animationSlot
    ? ({ '--stagger-delay': `${decayDelay(animationSlot.idx)}ms` } as CSSProperties)
    : undefined;

  return (
    <article ref={setRefs} className={wrapperClass} style={wrapperStyle} data-testid="story-card" data-story-id={story.id} data-viewed={viewed}>
      <div className="space-y-1.5">
        <h2 className="text-lg md:text-xl leading-[1.35] md:leading-[1.3] font-semibold">
          {story.url ? (
            <a
              href={story.url}
              rel="noreferrer"
              className={`hover:text-accent transition-colors ${
                viewed
                  ? 'text-viewed'
                  : 'text-foreground'
              }`}
              onClick={handleTitleClick}
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

        {/* Meta row order: points → domain → time → user → comments.
            Points/domain/time form a quick-scan header (score, source,
            recency); user follows for attribution; comments lands last
            as the explicit "click to read the discussion" action. */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground">
          <span className={metaItemClass}>
            <ChevronUp aria-hidden className="size-3.5" />
            <span>{story.points ?? 0} points</span>
          </span>

          {hostname && (
            <Link
              to={`/from/${hostname}`}
              onClick={handleSiblingNavigate}
              className={metaPillClass}
            >
              <Globe aria-hidden className="size-3.5" />
              {hostname}
            </Link>
          )}

          <span className={metaItemClass}>
            <Clock aria-hidden className="size-3.5" />
            <RelativeTime timestamp={story.createdAt} />
          </span>

          <AuthorByline author={story.author} onClick={handleSiblingNavigate} />

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
