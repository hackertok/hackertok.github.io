import type { LocationState, FeedType } from '../types';

/** Visible feed tabs (excludes 'top'). Order: Best > Show > Ask > New (never reordered). */
export const FEED_TABS = ['best', 'show', 'ask', 'newest'] as const;
export type NavFeedType = (typeof FEED_TABS)[number];

/** Contextual pills: comments > user > from (priority order, mutually exclusive). */
export type ContextualKey = 'comments' | 'user' | 'from';
export type NavKey = NavFeedType | ContextualKey;

export interface NavItemSpec {
  key: NavKey;
  kind: 'feed' | 'contextual';
  isActive: boolean;
}

export interface HeaderState {
  /** Active contextual pill (null if none). */
  activeContextual: ContextualKey | null;
  /**
   * Ordered nav items for usePackedNav. Active contextual at index 0;
   * feed tabs in canonical order.
   */
  navItems: NavItemSpec[];
}

/**
 * Pure derivation of Header nav state from router location.
 * Testable outside React; deps collapse to `[pathname, locationState]`.
 */
export function deriveHeaderState(
  pathname: string,
  locationState: LocationState | null,
): HeaderState {
  const isCommentView = locationState?.isComment === true;
  const isOnItem = pathname.startsWith('/item/');

  // User-submissions feed, or item-detail navigated from one (mobile swipe
  // rewrites /submitted/:id → /item/:id with fromUser preserved).
  // Excludes /user/:id (profile page, not a feed — no contextual pill).
  const isUserActive =
    !isCommentView &&
    (pathname.startsWith('/submitted/') ||
      (isOnItem && !!locationState?.fromUser));

  // "from" indicator: domain route, or item detail navigated from a
  // domain list. Hidden when isUserActive wins so only one contextual
  // pill ever renders.
  const isFromActive =
    !isCommentView &&
    !isUserActive &&
    (pathname.startsWith('/from/') ||
      (isOnItem && !!locationState?.fromDomain));

  const activeContextual: ContextualKey | null = isCommentView
    ? 'comments'
    : isUserActive
      ? 'user'
      : isFromActive
        ? 'from'
        : null;

  // Feed tab is "active" on its own route OR on item detail when the
  // navigation carried `state.from=<feed>`. The contextual cascade above
  // pre-empts this — when a contextual pill wins, no feed tab lights up.
  const isFeedActive = (feed: FeedType) =>
    !isCommentView &&
    (pathname === `/${feed}` ||
      (isOnItem && locationState?.from === feed));

  const navItems: NavItemSpec[] = [];

  if (activeContextual) {
    navItems.push({
      key: activeContextual,
      kind: 'contextual',
      isActive: true,
    });
  }

  const activeFeed = !activeContextual
    ? FEED_TABS.find((f) => isFeedActive(f))
    : undefined;

  FEED_TABS.forEach((feed) => {
    navItems.push({
      key: feed,
      kind: 'feed',
      isActive: feed === activeFeed,
    });
  });

  return { activeContextual, navItems };
}
