import { useId, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  Flame,
  Globe,
  Lightbulb,
  MessageCircleQuestionMark,
  MessageSquare,
  User,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui';
import { useScrollDirection } from '../hooks/useScrollDirection';
import { useScrollContainer } from '../hooks/useScrollContainer';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePackedNav } from '../hooks/usePackedNav';
import { clearListSessionState } from '../utils/itemCache';
import { prefersReducedMotion } from '../utils/prefersReducedMotion';
import {
  deriveHeaderState,
  type ContextualKey,
  type NavFeedType,
  type NavItemSpec,
  type NavKey,
} from '../utils/deriveHeaderState';
import type { FeedType, LocationState } from '../types';

const FEED_ICONS: Record<NavFeedType, typeof Flame> = {
  best: Flame,
  show: Lightbulb,
  ask: MessageCircleQuestionMark,
};

const CONTEXTUAL_ICONS: Record<ContextualKey, typeof Flame> = {
  comments: MessageSquare,
  user: User,
  from: Globe,
};

// Estimated rendered widths (CSS px) per pill label, mobile (no leading
// icon) baseline. Includes `px-2.5` (10px) horizontal padding. Conservative
// upper bounds — we'd rather hide one item too many than overflow the row.
// `text-sm font-medium` glyph widths are derived from typical sans-serif
// metrics for the actual labels. ICON_EXTRA accounts for the leading
// `size-3.5` (14px) icon + `gap-1.5` (6px) when md+ icons are visible.
const PILL_WIDTH_NO_ICON: Record<NavKey, number> = {
  best: 56,
  show: 60,
  ask: 50,
  comments: 96,
  user: 56,
  from: 56,
};
const ICON_EXTRA = 20;

// Width budget for the overflow trigger including its leading separator.
// Breakdown:
//   - 4px gap-1 (parent flex) between last visible item and the separator
//   - 6px mx-1.5 left of the 1px separator line
//   - 1px separator line
//   - 6px mx-1.5 right of the separator line
//   - 4px gap-1 between the separator and the More trigger
//   = 21px separator slot
//   - ~84px "more" pill ("more" text + gap-2 + ChevronDown + px-2.5 padding)
const SEPARATOR_SLOT = 21;
const MORE_PILL_WIDTH = 84;
const OVERFLOW_BUDGET = SEPARATOR_SLOT + MORE_PILL_WIDTH;

// Parent flex gap-1 (4px) — must stay in sync with the `gap-1` className
// on the <nav> below. Used by usePackedNav to size the gap between items
// when computing whether the next item still fits.
const NAV_GAP = 4;

// Per-render packable nav-item shape — `usePackedNav` is generic over the
// minimum `{ width }` shape, so we attach the full NavItemSpec on the same
// object and read it straight off the result without a key-based lookup.
type PackableNavItem = NavItemSpec & { width: number };

// An explicit `behavior: 'smooth'` overrides CSS `scroll-behavior`, so the
// global reduced-motion rule in index.css can't neutralize it — gate it here.
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

export function Header() {
  const maskId = useId();
  const { scrollDirection, isAtTop } = useScrollDirection();
  const { isSwipeMode } = useScrollContainer();
  const isMobile = useIsMobile();
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  // Active state derived in deriveHeaderState.
  const { navItems } = useMemo(
    () => deriveHeaderState(location.pathname, locationState),
    [location.pathname, locationState],
  );

  // Attach width estimates. ICON_EXTRA only at md+ (icons hidden on mobile).
  const packableItems: PackableNavItem[] = useMemo(
    () =>
      navItems.map((it) => ({
        ...it,
        width: PILL_WIDTH_NO_ICON[it.key] + (isMobile ? 0 : ICON_EXTRA),
      })),
    [navItems, isMobile],
  );

  const navRef = useRef<HTMLElement>(null);
  const {
    visible: visibleItems,
    hidden: hiddenItems,
    showOverflow,
  } = usePackedNav(navRef, packableItems, {
    overflowWidth: OVERFLOW_BUDGET,
    gap: NAV_GAP,
  });

  // Mobile: hidden on scroll-down unless swipe mode.
  const mobileHidden = isSwipeMode
    ? false
    : scrollDirection === 'down' && !isAtTop;

  // Clear all session states so we start fresh (logo = "home/reset" action)
  const handleLogoClick = () => {
    clearListSessionState('top');
    clearListSessionState('best');
    clearListSessionState('show');
    clearListSessionState('ask');
    if (location.pathname === '/') {
      scrollToTop();
    }
  };

  const handleNavClick = (feed: FeedType) => {
    clearListSessionState(feed);
    if (location.pathname === `/${feed}`) {
      scrollToTop();
    }
  };

  // Icons hidden on mobile; capitalize is CSS-only (DOM stays lowercase for test assertions).
  const navLinkClass = (isActive: boolean) =>
    `inline-flex items-center gap-1.5 capitalize px-2.5 py-1 rounded-lg text-sm font-medium ${
      isActive
        ? 'bg-accent text-accent-foreground shadow-pill-glow'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
    }`;

  // Plain Link (not NavLink): item.isActive covers state-driven matches
  // that NavLink can't see (e.g. /item/X with state.from='best').
  const renderFeedItem = (item: NavItemSpec) => {
    const feed = item.key as NavFeedType;
    const Icon = FEED_ICONS[feed];
    return (
      <Link
        key={feed}
        to={`/${feed}`}
        onClick={() => handleNavClick(feed)}
        className={navLinkClass(item.isActive)}
        aria-current={item.isActive ? 'page' : undefined}
      >
        <Icon aria-hidden className="hidden md:inline-block size-3.5" />
        {feed}
      </Link>
    );
  };

  // Render the contextual pill (always non-interactive — user is on this route).
  const renderContextualItem = (item: NavItemSpec) => {
    const key = item.key as ContextualKey;
    const Icon = CONTEXTUAL_ICONS[key];
    return (
      <span
        key={key}
        className={navLinkClass(true)}
        aria-current="page"
      >
        <Icon aria-hidden className="hidden md:inline-block size-3.5" />
        {key}
      </span>
    );
  };

  const renderNavItem = (item: NavItemSpec) =>
    item.kind === 'feed' ? renderFeedItem(item) : renderContextualItem(item);

  // Overflow menu items — text-only, mirrors active treatment if needed.
  const renderMenuItem = (item: NavItemSpec) => {
    if (item.kind === 'contextual') {
      return (
        <DropdownMenuItem
          key={item.key}
          className="bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground capitalize"
          aria-current="page"
        >
          {item.key}
        </DropdownMenuItem>
      );
    }
    const feed = item.key as NavFeedType;
    return (
      <DropdownMenuItem
        key={feed}
        asChild
        className={
          item.isActive
            ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground'
            : undefined
        }
      >
        <Link
          to={`/${feed}`}
          onClick={() => handleNavClick(feed)}
          aria-current={item.isActive ? 'page' : undefined}
        >
          {feed}
        </Link>
      </DropdownMenuItem>
    );
  };

  return (
    // Swipe-mode header is `position: fixed` to dodge Gecko's sticky scroll-up
    // flicker (see index.css). useSwipeScroll adds `is-swiping` during the panel
    // swap to flip it back to `sticky`; `app-header` is the hook the override targets.
    <header
      className={`
        app-header
        ${isSwipeMode ? 'bg-card' : 'bg-card/95 backdrop-blur-sm'}
        border-b border-border
        md:relative md:transform-none md:mb-0
        fixed top-0 left-0 right-0 z-50
        ${isSwipeMode ? '' : 'transition-transform duration-300 ease-out'}
        ${isSwipeMode ? '' : !mobileHidden ? 'translate-y-0' : '-translate-y-full'}
        md:translate-y-0
      `}
    >
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-2 md:py-1.5 lg:py-1">
        {/* 3-col flex: logo (intrinsic) | nav (flex-1, min-w-0) | theme (intrinsic) */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            onClick={handleLogoClick}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <span className="sr-only">HackerTok</span>
            <span aria-hidden="true" className="flex items-center gap-2">
              <svg className="w-7 h-7" viewBox="0 0 64 64">
                <defs>
                  <mask id={maskId}>
                    <rect width="64" height="64" rx="12" fill="#fff"/>
                    <rect x="14" y="16" width="8" height="32" rx="1" fill="#000"/>
                    <rect x="42" y="16" width="8" height="32" rx="1" fill="#000"/>
                    <rect x="24" y="28" width="16" height="8" rx="1" fill="#000"/>
                    <rect x="28" y="28" width="8" height="20" rx="1" fill="#000"/>
                  </mask>
                </defs>
                <rect width="64" height="64" rx="12" fill="#f36303" mask={`url(#${maskId})`}/>
              </svg>
              <span className="hidden md:inline text-xl font-bold tracking-tight">
                <span className="text-accent">Hacker</span>
                <span className="text-tok">Tok</span>
              </span>
            </span>
          </Link>

          <nav
            ref={navRef}
            className="flex items-center gap-1 flex-1 justify-end min-w-0"
            aria-label="Sections"
          >
            {visibleItems.map(renderNavItem)}
            {showOverflow && (
              <>
                {visibleItems.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="h-5 w-px bg-muted-foreground/40 mx-1.5"
                  />
                )}
                {/* More pill — gap-2 for wider chevron spacing. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More tabs"
                      className="inline-flex items-center gap-2 capitalize px-2.5 py-1 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      more
                      <ChevronDown aria-hidden className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  {/* align="end" prevents right-overflow; min-w-[5rem] for short feed labels. */}
                  <DropdownMenuContent align="end" className="min-w-[5rem]">
                    {hiddenItems.map(renderMenuItem)}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </nav>

          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
