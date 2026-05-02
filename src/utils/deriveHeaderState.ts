import type { LocationState, FeedType } from '../types';

/**
 * Canonical visible feed tabs (excludes 'top', the implicit home feed
 * which has no /top route). Order is intentional — when no item is
 * active these render in `Best > Show > Ask` order. We never reorder
 * based on which one is active because that creates jarring visual
 * reflow when the user navigates between feed tabs.
 */
export const FEED_TABS = ['best', 'show', 'ask'] as const;
export type NavFeedType = (typeof FEED_TABS)[number];

/**
 * Contextual pills — pseudo-tabs that only appear when the user is on
 * the corresponding route family (a comment thread / a user profile /
 * a domain page) and disappear otherwise. Mutually exclusive at the
 * UI level with priority `comments > user > from`.
 */
export type ContextualKey = 'comments' | 'user' | 'from';
export type NavKey = NavFeedType | ContextualKey;

export interface NavItemSpec {
  key: NavKey;
  kind: 'feed' | 'contextual';
  isActive: boolean;
}

export interface HeaderState {
  /**
   * Which contextual pill (if any) wins for this route. Single source
   * of truth for the priority cascade — Header should not re-implement
   * `isCommentView ? : isUserActive ? : ...` ladders downstream.
   */
  activeContextual: ContextualKey | null;
  /**
   * Ordered nav-item list ready to be packed by `usePackedNav`. The
   * active contextual pill (when present) is slotted at index 0 so the
   * packer — which always keeps `items[0]` visible — preserves the
   * user's current context as available space shrinks. The 3 feed tabs
   * always follow in canonical Best > Show > Ask order; an active feed
   * tab can land in the overflow menu at sub-~300px viewports (rare in
   * practice) and the consumer is expected to mirror the active
   * treatment into the menu item.
   */
  navItems: NavItemSpec[];
}

/**
 * Pure derivation of the Header's nav state from the current router
 * location. Lives outside the component so:
 *
 *   1. The `react-hooks/exhaustive-deps` ladder collapses to a single
 *      `[pathname, locationState]` dep — passing the state object by
 *      reference covers every field (`isComment`, `from`, `fromUser`,
 *      `fromDomain`) without having to enumerate them. Adding a new
 *      LocationState field stays automatic instead of silently leaving
 *      the memo stale.
 *   2. The four "is X active" predicates are testable in isolation
 *      without spinning up React + a memory router (`Header.test.tsx`
 *      can keep its render-based assertions; this lives next to a
 *      cheaper unit test for the derivation rules themselves).
 *
 * Priority cascade for contextual pills: `comments > user > from`. The
 * contextual pill always suppresses the corresponding feed-active
 * highlight (e.g. on `/item/X` with `state.from='best'` and
 * `state.isComment=true`, "comments" wins and Best stays unhighlighted).
 */
export function deriveHeaderState(
  pathname: string,
  locationState: LocationState | null,
): HeaderState {
  const isCommentView = locationState?.isComment === true;
  const isOnItem = pathname.startsWith('/item/');

  // "user" indicator: profile / submissions routes, or item detail
  // navigated from a user submissions list (mobile swipe viewer rewrites
  // /submitted/:id to /item/:id per-item with fromUser preserved; desktop
  // StoryCard writes fromUser when its parent list is a user).
  const isUserActive =
    !isCommentView &&
    (pathname.startsWith('/user/') ||
      pathname.startsWith('/submitted/') ||
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
