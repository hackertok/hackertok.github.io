import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { render } from '../test/test-utils';

// Hoisted, mutable container for the usePackedNav mock return value. Tests
// mutate `mockPackedNav.state` to simulate different packer outputs:
//   - default (everything visible, no overflow) → exercised by every existing
//     Header test that does `getByRole('link', { name: /best/i })` etc.
//   - overflow case with hidden items → exercised by the "More dropdown"
//     describe block below to drive the menu without needing a real
//     ResizeObserver / layout in jsdom.
//
// State is keyed by the nav item's `key` (the only field the test setups
// care about) — the mock implementation below translates these back to
// the actual input items, so callers can still write
// `visible: ['best']` rather than spelling out `{ key, kind, isActive }`
// for every entry. Default = empty arrays which the impl interprets as
// "show everything", which is what the 30+ assertions across this file
// implicitly assume — they all expect Best/Show/Ask to be direct nav
// links unless the test explicitly says otherwise.
interface MockPackedNavKeys {
  visible: string[];
  hidden: string[];
  showOverflow: boolean;
}
interface MockPackableItem {
  key: string;
  pinned?: boolean;
}
// `lastItems` records what Header hands the packer, so the pinning contract
// can be asserted without the real measurement the mock stands in for.
const mockPackedNav = vi.hoisted(
  (): {
    state: MockPackedNavKeys;
    lastItems: MockPackableItem[];
    lastOverflowWidth: number;
  } => ({
    state: { visible: [], hidden: [], showOverflow: false },
    lastItems: [],
    lastOverflowWidth: -1,
  }),
);

// Mobile is a render-time branch here, not a media query, so the chrome the
// packer is charged for and the chrome that renders can be asserted together.
const mockIsMobile = vi.hoisted((): { value: boolean } => ({ value: false }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => mockIsMobile.value }));

vi.mock('../hooks/usePackedNav', () => ({
  // The hook is now generic — it returns full item slices, not key
  // strings — so the mock looks up each configured key against the
  // actual input items and returns the matching object. The default
  // empty-state branch returns the full input untouched (= everything
  // visible, no overflow) so unrelated tests keep finding all nav links.
  usePackedNav: <T extends MockPackableItem>(
    _ref: unknown,
    items: T[],
    options: { overflowWidth: number },
  ): { visible: T[]; hidden: T[]; showOverflow: boolean } => {
    mockPackedNav.lastItems = items;
    mockPackedNav.lastOverflowWidth = options.overflowWidth;
    if (mockPackedNav.state.visible.length === 0 && !mockPackedNav.state.showOverflow) {
      return { visible: items, hidden: [], showOverflow: false };
    }
    const lookup = (key: string) => items.find((i) => i.key === key);
    return {
      visible: mockPackedNav.state.visible.flatMap((k) => lookup(k) ?? []),
      hidden: mockPackedNav.state.hidden.flatMap((k) => lookup(k) ?? []),
      showOverflow: mockPackedNav.state.showOverflow,
    };
  },
}));

import { Header } from './Header';

describe('Header', () => {
  describe('rendering', () => {
    it('renders logo', () => {
      render(<Header />);

      expect(screen.getByRole('link', { name: 'HackerTok' })).toBeInTheDocument();
    });
  });

  // Feed-tab highlight matrix. Each of best/show/ask follows the same active
  // rules, so we exercise them once per feed via describe.each rather than
  // re-typing 3 nearly-identical describe blocks. The shared helper keeps
  // the link selector consistent (case-insensitive name regex) so a single
  // refactor of the visible label only requires touching this file once.
  //
  // The feed-agnostic "no nav state on item page" case lives outside the
  // parameterised block — it doesn't depend on which feed we ask about,
  // only that no feed should ever light up without explicit context.
  const FEEDS = [
    { key: 'best', label: 'best', route: '/best' },
    { key: 'show', label: 'show', route: '/show' },
    { key: 'ask', label: 'ask', route: '/ask' },
    { key: 'newest', label: 'new', route: '/newest' },
  ] as const;
  describe.each(FEEDS)('$key feed tab', ({ key, label, route }) => {
    const linkRe = new RegExp(label, 'i');
    const getLink = () => screen.getByRole('link', { name: linkRe });

    it(`renders the ${key} navigation link`, () => {
      render(<Header />);
      expect(getLink()).toBeInTheDocument();
    });

    it(`highlights ${key} on ${route} route`, () => {
      render(<Header />, { initialEntries: [route] });
      expect(getLink()).toHaveAttribute('aria-current', 'page');
    });

    it(`does not highlight ${key} on home route`, () => {
      render(<Header />, { initialEntries: ['/'] });
      expect(getLink()).not.toHaveAttribute('aria-current');
    });

    it(`highlights ${key} on item detail when state.from=${key}`, () => {
      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { from: key } },
        ],
      });
      expect(getLink()).toHaveAttribute('aria-current', 'page');
    });

    it(`does not highlight ${key} on item detail when state.from=top`, () => {
      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { from: 'top' } },
        ],
      });
      expect(getLink()).not.toHaveAttribute('aria-current');
    });
  });

  describe('feed tabs without navigation state', () => {
    it('does not highlight any feed tab on item detail without navigation state', () => {
      // Generic across all feeds — the "no state.from" rule is feed-
      // agnostic so we assert against every feed in a single render.
      render(<Header />, { initialEntries: ['/item/12345'] });

      for (const { label } of FEEDS) {
        const link = screen.getByRole('link', { name: new RegExp(label, 'i') });
        expect(link).not.toHaveAttribute('aria-current');
      }
    });
  });

  describe('from indicator', () => {
    const fromIndicator = () =>
      screen.queryByText('from', { selector: 'header nav span' });

    it('shows "from" indicator on /from/:domain list/swipe route', () => {
      render(<Header />, { initialEntries: ['/from/example.com'] });

      const indicator = fromIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveAttribute('aria-current', 'page');
    });

    it('keeps "from" visible on item detail when navigated from a domain', () => {
      // Covers both (a) the mobile swipe viewer rewriting /from/:domain to
      // /item/:id with state.fromDomain and (b) desktop StoryCard writing
      // state.fromDomain on internal navigation from a domain list.
      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { fromDomain: 'example.com' } },
        ],
      });

      const indicator = fromIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveAttribute('aria-current', 'page');
    });

    it('hides "from" on item detail without fromDomain state', () => {
      render(<Header />, {
        initialEntries: [{ pathname: '/item/12345', state: { from: 'best' } }],
      });

      expect(fromIndicator()).toBeNull();
    });

    it('hides "from" on item detail with no navigation state at all', () => {
      render(<Header />, { initialEntries: ['/item/12345'] });

      expect(fromIndicator()).toBeNull();
    });

    it('hides "from" when viewing a comment even if fromDomain is present', () => {
      // Comment view has its own "comments" indicator; suppress "from" to
      // mirror how feed tabs deactivate in comment view and avoid two
      // highlighted indicators competing for the same slot.
      render(<Header />, {
        initialEntries: [
          {
            pathname: '/item/12345',
            state: { fromDomain: 'example.com', isComment: true },
          },
        ],
      });

      expect(fromIndicator()).toBeNull();
    });

    it('hides "from" on feed pages', () => {
      render(<Header />, { initialEntries: ['/best'] });

      expect(fromIndicator()).toBeNull();
    });
  });

  describe('user indicator', () => {
    const userIndicator = () =>
      screen.queryByText('user', { selector: 'header nav span' });
    const fromIndicator = () =>
      screen.queryByText('from', { selector: 'header nav span' });
    const commentsIndicator = () =>
      screen.queryByText('comments', { selector: 'header nav span' });

    it('shows "user" indicator on /submitted/:id list route', () => {
      render(<Header />, { initialEntries: ['/submitted/pg'] });

      const indicator = userIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveAttribute('aria-current', 'page');
    });

    it('keeps "user" visible on item detail when navigated from user submissions', () => {
      // Covers (a) the mobile swipe viewer rewriting /submitted/:id to
      // /item/:id with state.fromUser and (b) desktop StoryCard writing
      // state.fromUser on internal navigation from a user submissions list.
      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { fromUser: 'pg' } },
        ],
      });

      const indicator = userIndicator();
      expect(indicator).not.toBeNull();
      expect(indicator).toHaveAttribute('aria-current', 'page');
    });

    it('hides "user" on item detail without fromUser state', () => {
      render(<Header />, {
        initialEntries: [{ pathname: '/item/12345', state: { from: 'best' } }],
      });

      expect(userIndicator()).toBeNull();
    });

    it('hides "user" on item detail with no navigation state at all', () => {
      render(<Header />, { initialEntries: ['/item/12345'] });

      expect(userIndicator()).toBeNull();
    });

    it('hides "user" on feed pages', () => {
      render(<Header />, { initialEntries: ['/best'] });

      expect(userIndicator()).toBeNull();
    });

    it('hides "user" when viewing a comment even if fromUser is present', () => {
      // Comments view's dedicated indicator wins. Mirrors how `from` and
      // feed tabs deactivate in comment view so only one contextual pill
      // ever renders at a time.
      render(<Header />, {
        initialEntries: [
          {
            pathname: '/item/12345',
            state: { fromUser: 'pg', isComment: true },
          },
        ],
      });

      expect(userIndicator()).toBeNull();
    });

    it('prefers "user" over "from" when both fromUser and fromDomain are set', () => {
      // Priority: comments > user > from. With both fromUser and fromDomain,
      // user wins and from is suppressed so the nav row stays uncluttered.
      render(<Header />, {
        initialEntries: [
          {
            pathname: '/item/12345',
            state: { fromUser: 'pg', fromDomain: 'example.com' },
          },
        ],
      });

      expect(userIndicator()).not.toBeNull();
      expect(fromIndicator()).toBeNull();
    });

    it('prefers "comments" over "user" when both apply', () => {
      // The full priority chain in one assertion: comments > user.
      render(<Header />, {
        initialEntries: [
          {
            pathname: '/item/12345',
            state: { fromUser: 'pg', isComment: true },
          },
        ],
      });

      expect(commentsIndicator()).not.toBeNull();
      expect(userIndicator()).toBeNull();
    });
  });

  describe('feed tabs in comment view', () => {
    // The dedicated "comments" pill is the wayfinding signal in comment view,
    // so feed tabs (Best/Show/Ask) must NOT also light up — even when
    // location.state.from would normally activate one. Mirrors how the
    // "from"/"user" indicators are suppressed in comment view (covered by
    // earlier tests). Without this rule, opening a comment from the Best
    // feed would render BOTH the orange "comments" pill AND an orange
    // "Best" pill, doubling up the active treatment.
    it.each(FEEDS)(
      'does not highlight $key feed tab in comment view, even when state.from matches',
      ({ key, label }) => {
        render(<Header />, {
          initialEntries: [
            {
              pathname: '/item/12345',
              state: { from: key, isComment: true },
            },
          ],
        });

        const link = screen.getByRole('link', { name: new RegExp(label, 'i') });
        expect(link).not.toHaveAttribute('aria-current');
      },
    );
  });

  describe('aria-current', () => {
    // Active wayfinding for a11y: the active contextual pill (rendered as a
    // <span>, not a link) and the active feed/menu item carry
    // aria-current="page". Visible feed NavLinks already inherit React
    // Router's aria-current behavior, but the contextual span and the
    // dropdown menu item paths are bespoke and easy to drop in a refactor.

    it('marks the active contextual pill (comments) with aria-current="page"', () => {
      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { isComment: true } },
        ],
      });

      const indicator = screen.getByText('comments', {
        selector: 'header nav span',
      });
      expect(indicator).toHaveAttribute('aria-current', 'page');
    });

    it('marks the active contextual pill (user) with aria-current="page"', () => {
      render(<Header />, { initialEntries: ['/submitted/pg'] });

      const indicator = screen.getByText('user', {
        selector: 'header nav span',
      });
      expect(indicator).toHaveAttribute('aria-current', 'page');
    });

    it('marks the active contextual pill (from) with aria-current="page"', () => {
      render(<Header />, { initialEntries: ['/from/example.com'] });

      const indicator = screen.getByText('from', {
        selector: 'header nav span',
      });
      expect(indicator).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('nav DOM order', () => {
    // Locks the canonical packing rule: when an active contextual pill
    // exists, it lives at index 0 of the <nav> children (a narrow row keeps
    // it because it is the active item, not because of its index).
    // The 4 feed tabs follow in fixed Best → Show → Ask → New order — we
    // never reorder feeds based on which one is active, since that would
    // cause jarring reflow as users move between them.
    //
    // We filter direct nav children by structural attributes (aria-hidden
    // separator, button trigger, empty text) rather than CSS classes so
    // the ordering contract stays decoupled from the specific Tailwind
    // tokens used for active styling.
    const navChildLabels = (): string[] => {
      const nav = screen.getByRole('navigation', { name: 'Sections' });
      // Direct children that are interactive pills: links (feed tabs) +
      // the contextual span (which carries aria-current="page"). Filter
      // out the hairline separator (aria-hidden) and the More button.
      return Array.from(nav.children)
        .filter((el) => {
          if (el.getAttribute('aria-hidden') === 'true') return false;
          if (el.tagName === 'BUTTON') return false;
          // The DropdownMenu trigger renders as a portal-related wrapper
          // sometimes; skip anything without a visible text label.
          return (el.textContent ?? '').trim().length > 0;
        })
        .map((el) => (el.textContent ?? '').trim().toLowerCase());
    };

    it('renders feed tabs in canonical [best, show, ask, new] order on /', () => {
      render(<Header />, { initialEntries: ['/'] });

      expect(navChildLabels()).toEqual(['best', 'show', 'ask', 'new']);
    });

    it('keeps feed order even when one is active (e.g. /show)', () => {
      // Show is active but stays at its canonical index 1 — never moved to
      // index 0. Test guards against a future "promote active feed to
      // front" refactor that we explicitly decided against.
      render(<Header />, { initialEntries: ['/show'] });

      expect(navChildLabels()).toEqual(['best', 'show', 'ask', 'new']);
    });

    it('puts the active contextual pill at index 0 ahead of feed tabs', () => {
      render(<Header />, { initialEntries: ['/submitted/pg'] });

      expect(navChildLabels()).toEqual(['user', 'best', 'show', 'ask', 'new']);
    });

    it('puts "from" at index 0 ahead of feed tabs on /from/:domain', () => {
      render(<Header />, { initialEntries: ['/from/example.com'] });

      expect(navChildLabels()).toEqual(['from', 'best', 'show', 'ask', 'new']);
    });

    it('puts "comments" at index 0 ahead of feed tabs in comment view', () => {
      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { isComment: true } },
        ],
      });

      expect(navChildLabels()).toEqual(['comments', 'best', 'show', 'ask', 'new']);
    });
  });

  describe('packing priority', () => {
    // The counterpart to the fixed order above: order stays canonical, so the
    // active tab can only survive a narrow row by being pinned. Asserted on
    // the packer's input because the packer itself is mocked here — see
    // usePackedNav.test.ts for what pinning does, and e2e/header-overflow
    // for the two meeting in a real viewport.
    const pinnedKeys = () =>
      mockPackedNav.lastItems.filter((i) => i.pinned).map((i) => i.key);

    it.each([
      ['/best', 'best'],
      ['/show', 'show'],
      ['/ask', 'ask'],
      ['/newest', 'newest'],
      ['/submitted/pg', 'user'],
      ['/from/example.com', 'from'],
    ])('pins the active item on %s', (route, expected) => {
      render(<Header />, { initialEntries: [route] });

      expect(pinnedKeys()).toEqual([expected]);
    });

      it('pins nothing on a route with no active tab', () => {
        render(<Header />, { initialEntries: ['/'] });

        expect(pinnedKeys()).toEqual([]);
      });
    });

    // Pinning only helps if the pinned pill can afford a slot, and on a phone
    // the trigger's own chrome was eating one. Both halves are asserted here
    // because they have to move together: charge for a label that no longer
    // renders and the row loses a pill for nothing.
    describe('mobile chrome', () => {
      afterEach(() => {
        mockIsMobile.value = false;
        mockPackedNav.state = { visible: [], hidden: [], showOverflow: false };
      });

      it('leaves the widest pill room on a 320px phone', () => {
        // Measured, not derived from the constants under test: 320px of
        // viewport leaves the nav 200px once the logo, the theme toggle and
        // the header padding have taken theirs, and `comments` renders 91.5px
        // there — the pill the old 105px reservation hid by a single pixel.
        const NAV_AT_320 = 200;
        const WIDEST_PILL = 96;
        mockIsMobile.value = true;

        render(<Header />, { initialEntries: ['/best'] });

        expect(NAV_AT_320 - mockPackedNav.lastOverflowWidth).toBeGreaterThanOrEqual(WIDEST_PILL);
      });

      it('still buys the separator and the label where there is room', () => {
        render(<Header />, { initialEntries: ['/best'] });
        const desktop = mockPackedNav.lastOverflowWidth;
        mockIsMobile.value = true;

        render(<Header />, { initialEntries: ['/best'] });

        expect(mockPackedNav.lastOverflowWidth).toBeLessThan(desktop);
      });

      it('renders the trigger as a bare chevron, and no separator beside it', () => {
        mockIsMobile.value = true;
        mockPackedNav.state = {
          visible: ['best'],
          hidden: ['show', 'ask', 'newest'],
          showOverflow: true,
        };

        render(<Header />, { initialEntries: ['/best'] });

        // The name survives the label: it comes from `aria-label`.
        const trigger = screen.getByRole('button', { name: 'More tabs' });
        expect(within(trigger).queryByText('more')).toBeNull();
        // Same hairline query as the overflow tests above.
        const nav = screen.getByRole('navigation', { name: 'Sections' });
        expect(nav.querySelector('span.w-px')).toBeNull();
      });
    });

  describe('text probe', () => {
    it('carries the same typography as the pills it stands in for', () => {
      // Its width is only a reading of the reader's text size while it is set
      // in the pills' own font — restyle them and this is the test that says
      // so, before the packer starts measuring the wrong thing in silence.
      render(<Header />, { initialEntries: ['/best'] });

      const nav = screen.getByRole('navigation', { name: 'Sections' });
      const probe = nav.querySelector('span.absolute');
      const pill = within(nav).getByRole('link', { name: 'best' });

      expect(probe).not.toBeNull();
      expect(probe!.getAttribute('aria-hidden')).toBe('true');
      for (const cls of ['text-sm', 'font-medium', 'capitalize']) {
        expect(pill.className).toContain(cls);
        expect(probe!.className).toContain(cls);
      }
      // The word is in `content`, so no second `comments` lands in the DOM.
      expect(probe!.textContent).toBe('');
      expect(probe!.className).toContain("before:content-['comments']");
    });
  });

  describe('More dropdown (overflow menu)', () => {
    // The packing hook is mocked at the module level above. These tests
    // configure it to simulate a viewport too narrow to fit all nav items,
    // then drive the resulting "More" trigger through Radix's keyboard
    // path (Enter on a focused trigger reliably opens the menu under
    // jsdom, where pointer-events are inconsistent).
    //
    // Why route through the keyboard path instead of `fireEvent.click`?
    // Radix's DropdownMenuTrigger handles open/close via
    // `onPointerDown`/`onPointerUp`, which jsdom doesn't fully simulate.
    // Keyboard activation goes through a plain `onKeyDown` handler that
    // works deterministically in jsdom. This also incidentally exercises
    // the keyboard-accessibility path that the broader e2e suite skips
    // on webkit (see e2e/accessibility.spec.ts).

    afterEach(() => {
      // Reset to "all visible" so subsequent tests outside this block see
      // the full nav. Hoisted state means a forgotten reset would silently
      // affect unrelated cases — explicit reset keeps coupling local.
      mockPackedNav.state = { visible: [], hidden: [], showOverflow: false };
    });

    const openMore = () => {
      const trigger = screen.getByRole('button', { name: 'More tabs' });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
      return trigger;
    };

    it('renders a "More tabs" button with aria-haspopup when packer reports overflow', () => {
      // Simulate "Best fits, Show + Ask overflow into menu" on a narrow
      // viewport (typical small-phone scenario when a contextual pill is
      // also active).
      mockPackedNav.state = {
        visible: ['best'],
        hidden: ['show', 'ask'],
        showOverflow: true,
      };

      render(<Header />, { initialEntries: ['/'] });

      const trigger = screen.getByRole('button', { name: 'More tabs' });
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      // Hidden tabs should NOT yet be visible as inline nav links — they
      // only appear inside the menu after opening it.
      expect(screen.queryByRole('link', { name: /show/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /ask/i })).not.toBeInTheDocument();
    });

    it('does NOT render a "More tabs" button when everything fits', () => {
      // Default packer state ("all visible") — the More button must not
      // render. This is the most common state on desktop and we don't want
      // the trigger leaking into wide-viewport snapshots.
      render(<Header />, { initialEntries: ['/'] });

      expect(
        screen.queryByRole('button', { name: 'More tabs' }),
      ).not.toBeInTheDocument();
    });

    it('opens the menu and exposes hidden tabs as menuitem links', () => {
      mockPackedNav.state = {
        visible: ['best'],
        hidden: ['show', 'ask'],
        showOverflow: true,
      };

      render(<Header />, { initialEntries: ['/'] });
      const trigger = openMore();

      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      // Menu items live in a Radix portal, so use `screen` (which queries
      // `document.body`, not just the test container).
      const showItem = screen.getByRole('menuitem', { name: 'show' });
      const askItem = screen.getByRole('menuitem', { name: 'ask' });
      expect(showItem).toHaveAttribute('href', '/show');
      expect(askItem).toHaveAttribute('href', '/ask');
    });

    it('marks the active hidden feed with aria-current="page" inside the menu', () => {
      // The user is on /show, but Show is overflowed into the More menu.
      // The active treatment must follow the tab into the dropdown — both
      // visually (active styling so the user can see "this is where I am")
      // and semantically (aria-current="page" for AT users). Without this,
      // navigating to /show on a narrow viewport would leave the user with
      // ZERO visible "you are here" signal. We assert on aria-current
      // (the contract) and trust the visual styling to track the same
      // signal — coupling the assertion to a specific Tailwind class
      // would just create false negatives when the design tokens change.
      mockPackedNav.state = {
        visible: ['best'],
        hidden: ['show', 'ask'],
        showOverflow: true,
      };

      render(<Header />, { initialEntries: ['/show'] });
      openMore();

      const showItem = screen.getByRole('menuitem', { name: 'show' });
      expect(showItem).toHaveAttribute('aria-current', 'page');

      // Inactive sibling: "ask" should NOT carry aria-current.
      const askItem = screen.getByRole('menuitem', { name: 'ask' });
      expect(askItem).not.toHaveAttribute('aria-current');
    });

    it('renders the trigger with a static "more" label and a chevron icon', () => {
      // Pin the visible label and the presence of the chevron — both are
      // explicit product decisions (no Material-style "kebab", no rotation
      // on open) that we agreed on. A future refactor that replaces the
      // pill with an icon-only button would silently regress
      // discoverability without this assertion.
      mockPackedNav.state = {
        visible: ['best'],
        hidden: ['show', 'ask'],
        showOverflow: true,
      };

      render(<Header />, { initialEntries: ['/'] });

      const trigger = screen.getByRole('button', { name: 'More tabs' });
      expect(within(trigger).getByText('more')).toBeInTheDocument();
      expect(trigger.querySelector('svg')).not.toBeNull();
    });

    it('renders a contextual item as a non-link menuitem when it overflows', () => {
      // On ultra-narrow viewports the packer can push every item —
      // including the contextual pill at index 0 — into the dropdown.
      // The contextual branch in renderMenuItem must produce a plain
      // <DropdownMenuItem> (not an <a>) with aria-current="page".
      mockPackedNav.state = {
        visible: [],
        hidden: ['comments', 'best', 'show', 'ask'],
        showOverflow: true,
      };

      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { isComment: true } },
        ],
      });
      openMore();

      const commentsItem = screen.getByRole('menuitem', { name: 'comments' });
      expect(commentsItem).toHaveAttribute('aria-current', 'page');
      // Contextual items are not links — they represent the current page.
      expect(commentsItem).not.toHaveAttribute('href');
    });

    it('hides the hairline separator when all items overflow (visible is empty)', () => {
      // When the packer puts everything into the dropdown, visibleItems
      // is []. The separator between inline pills and the "More" trigger
      // must not render — there's nothing to separate.
      mockPackedNav.state = {
        visible: [],
        hidden: ['comments', 'best', 'show', 'ask'],
        showOverflow: true,
      };

      render(<Header />, {
        initialEntries: [
          { pathname: '/item/12345', state: { isComment: true } },
        ],
      });

      const nav = screen.getByRole('navigation', { name: 'Sections' });
      // The hairline by its own width, not by `aria-hidden`: the chevron and
      // the text probe are hidden from the tree too, and only this is 1px.
      const separator = nav.querySelector('span.w-px');
      expect(separator).toBeNull();
    });
  });
});
