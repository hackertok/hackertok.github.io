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

export function Header() {
  const maskId = useId();
  const { scrollDirection, isAtTop } = useScrollDirection();
  const { isSwipeMode } = useScrollContainer();
  const isMobile = useIsMobile();
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  // All "what's active right now" derivation lives in the pure
  // `deriveHeaderState` helper — see that module for the priority cascade
  // (`comments > user > from`) and the canonical `Best > Show > Ask`
  // ordering of feed tabs. Passing `locationState` by reference covers
  // every field (`isComment`, `from`, `fromUser`, `fromDomain`) without
  // having to enumerate them in the deps array.
  const { navItems } = useMemo(
    () => deriveHeaderState(location.pathname, locationState),
    [location.pathname, locationState],
  );

  // Attach the per-key width estimate for the packer. ICON_EXTRA is added
  // at md+ where the leading lucide icon renders inline (the icon is hidden
  // via `hidden md:inline-block` on mobile, so its width contribution is 0
  // there). Spread keeps `key` / `kind` / `isActive` so the packer's slice
  // output is directly renderable.
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

  // On mobile:
  // - In swipe mode: always visible (like desktop)
  // - In normal mode: show header when scrolling up or at top
  // On desktop: always visible (not sticky)
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
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNavClick = (feed: FeedType) => {
    clearListSessionState(feed);
    if (location.pathname === `/${feed}`) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // `inline-flex items-center gap-1.5` so leading icons baseline-align with
  // the label text on md+ viewports; on mobile the icons are gated to
  // `hidden md:inline-block` and `gap-1.5` collapses to nothing because the
  // hidden icon span is `display: none` and not in the flex flow.
  // `capitalize` is a CSS-only treatment — DOM textContent stays lowercase
  // so all `name: 'best'` / `hasText: 'from'` test assertions still match.
  const navLinkClass = (isActive: boolean) =>
    `inline-flex items-center gap-1.5 capitalize px-2.5 py-1 rounded-lg text-sm font-medium ${
      isActive
        ? 'bg-accent text-accent-foreground shadow-pill-glow'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
    }`;

  // Render a single feed nav item. We use plain `Link` (not `NavLink`)
  // because `item.isActive` is the single source of truth for the
  // active state — it captures BOTH literal route matches (`/best`)
  // AND state-driven matches (`/item/X` with `state.from='best'`),
  // whereas `NavLink` only knows about the former. NavLink also
  // unconditionally overrides any user-passed `aria-current` prop
  // with its own route-match-derived value, so passing one through
  // it would silently no-op on the state-driven case — that was the
  // exact bug this Link-based render was introduced to fix.
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

  // Inside the overflow menu, every item renders as a menu item. Menu items
  // are text-only — the leading icons used in the visible nav (for visual
  // anchor on md+) would just add chrome to a row that already has its own
  // typographic treatment via the menu surface, so we drop them here.
  //
  // The currently-active feed CAN land in this menu (e.g., user is on /show
  // and Show was packed into the overflow). When it does, we mirror the
  // visible-nav active treatment — `bg-accent text-accent-foreground` — so
  // the user gets the same "this is where you are" signal whether the tab
  // is in the row or in the dropdown. The hover:/focus: overrides win
  // against the base `DropdownMenuItem` style which would otherwise re-apply
  // `bg-muted` on hover/focus and erase the active fill.
  //
  // Uses plain `Link` via `asChild` (not `NavLink`) for the same reason
  // renderFeedItem does — `item.isActive` already covers the state-from
  // case that NavLink's auto-aria-current can't see, and we want the
  // attribute we set here to actually stick.
  const renderMenuItem = (item: NavItemSpec) => {
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
    <header
      className={`
        bg-card/95 backdrop-blur-sm
        border-b border-border
        md:relative md:transform-none
        ${isSwipeMode ? 'relative' : 'fixed top-0 left-0 right-0 z-50'}
        transition-transform duration-300 ease-out
        ${!isSwipeMode && mobileHidden ? '-translate-y-full' : 'translate-y-0'}
        md:translate-y-0
      `}
    >
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-2 md:py-1.5 lg:py-1">
        {/* Outer flex: 3 children with gap-3 (12px) between them.
            - Logo: intrinsic width
            - Nav: flex-1 → fills remaining horizontal space; justify-end
              keeps the nav's content right-aligned (so visually the nav
              cluster hugs the theme toggle, like a `justify-between`
              layout). `min-w-0` allows the nav to shrink below its content
              size, which is what lets the packer hide items as the
              container narrows. We measure `nav.offsetWidth` and the
              `flex-1` ensures it equals the available budget — *not* the
              sum of currently-rendered children. That's what makes the
              packer self-stabilizing.
            - Theme: intrinsic width, right-pinned
        */}
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
                {/* Hairline separator (GitHub-style) demarcating primary
                    nav from the secondary overflow trigger. `h-5` (20px)
                    sits inside the pill height (~28px) leaving ~4px margin
                    top/bottom so it reads as a divider not a border;
                    `mx-1.5` adds 6px on each side which combines with the
                    parent `gap-1` to give 10px breathing room on each
                    side. We use `bg-muted-foreground/40` rather than the
                    project's `--border` token because in dark mode the
                    `--border` cream-700 is too low-contrast against the
                    dark card surface — at this micro-line size, the
                    divider needs a touch more visual weight to read. */}
                <span
                  aria-hidden="true"
                  className="h-5 w-px bg-muted-foreground/40 mx-1.5"
                />
                {/* "More ⌄" pill (GitHub-repo-header pattern). Custom
                    className (vs reusing navLinkClass) so we can use gap-2
                    between text and chevron — matches the wider GitHub
                    spacing. The chevron stays static when the menu opens;
                    open/closed state is communicated by the popover
                    panel itself appearing or not. */}
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
                  {/* `align="end"` anchors the menu to the trigger's right
                      edge so it never overflows the right side of the
                      viewport on narrow screens; collisionPadding inside
                      DropdownMenuContent then keeps it clear of the edge
                      itself.

                      Override the shared `min-w-[7rem]` (112px) default to
                      `5rem` (80px). The default is sized for medium-length
                      action labels ("Open in new tab", etc.) — overkill for
                      this menu where the longest entry is "comments" (~70px
                      rendered) and the typical entries are short feed names
                      ("Show"/"Ask" ~50px). 80px gives the items a touch of
                      breathing room past the longest label without leaving
                      a wide column of empty popover surface to the right
                      of short labels. */}
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
