import { HashRouter, Routes, Route, useParams, useLocation, useNavigate } from 'react-router';
import { useState, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ScrollContainerProvider } from './context/ScrollContainerContext';
import { useScrollContainer } from './hooks/useScrollContainer';
import { Header, ErrorBoundary, FullScreenCommentSkeletonPanel, StateView, NetworkStatusBar } from './components';
import { TooltipProvider } from './components/ui';
import { StoryList } from './pages';
import { useCanSwipe } from './hooks/useCanSwipe';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { ItemDetail } from './pages/ItemDetail';
import { DomainStories } from './pages/DomainStories';
import { UserProfile } from './pages/UserProfile';
import { UserSubmissions } from './pages/UserSubmissions';
import { SwipeStoryViewer } from './components/SwipeStoryViewer';
import { SwipeDomainStoryViewer } from './components/SwipeDomainStoryViewer';
import { SwipeUserSubmissionsViewer } from './components/SwipeUserSubmissionsViewer';
import { SwipeCommentViewer } from './components/SwipeCommentViewer';
import { NetworkStatusProvider } from './context/NetworkStatusContext';
import { fetchItemOnly } from './api/hn';
import { readSwipePosition } from './utils/swipePosition';
import type { FeedType, LocationState, SwipePosition } from './types';

// Falls through to the desktop list when the URL has no domain (empty `/from/`)
// so the "No domain specified" fallback in DomainStories handles it consistently
// on both platforms.
function MobileDomainStoriesWrapper() {
  const params = useParams();
  const domain = params['*'] ?? '';
  const canSwipe = useCanSwipe();

  if (canSwipe && domain) {
    // key={domain} forces a clean remount on domain change so the hook's lazy
    // useState init re-reads the module-level cache for the new domain.
    return <SwipeDomainStoryViewer key={domain} domain={domain} />;
  }

  return <DomainStories />;
}

// Falls through to the desktop list when the URL has no username so
// UserSubmissions' "No user specified" state renders consistently on both
// platforms.
//
// IMPORTANT: do NOT pass `initialItemId` to the swipe viewer here. The route
// param `:id` is a USERNAME, not a story id; passing it would coerce to NaN
// inside SwipeStoryViewerCore, trigger a wasteful single-item fetch, and
// suppress the empty-state UI for users with no submissions.
function MobileUserSubmissionsWrapper() {
  const { id } = useParams<{ id: string }>();
  const username = id ?? '';
  const canSwipe = useCanSwipe();

  if (canSwipe && username) {
    return <SwipeUserSubmissionsViewer key={username} username={username} />;
  }

  return <UserSubmissions />;
}

// Maps a viewer context to its swipe viewer (priority fromUser → fromDomain → from;
// written mutually exclusively). Shared by the feed routes, the location.state path
// (Branches 2–4) and snapshot recovery (4b); the `key` mirrors viewer identity so
// switching paths reuses the instance. `id` is the story id here (/item/:id), so
// it's initialItemId. A feed viewer's key also carries `feedEntries` (see
// MobileStoryRoute).
function renderSwipeViewer(viewer: LocationState, id: string | undefined, feedEntries: number): ReactNode {
  if (viewer.fromUser) {
    return <SwipeUserSubmissionsViewer key={viewer.fromUser} username={viewer.fromUser} initialItemId={id} />;
  }
  if (viewer.fromDomain) {
    return <SwipeDomainStoryViewer key={viewer.fromDomain} domain={viewer.fromDomain} initialItemId={id} />;
  }
  if (viewer.from) {
    return <SwipeStoryViewer key={`${viewer.from}:${feedEntries}`} type={viewer.from} initialItemId={id} />;
  }
  return null;
}

// The element for the feed routes (`feed` set) and /item/:id. On a phone the
// feed's viewer moves the URL to /item/:id as soon as its first story shows,
// and React keeps that viewer only if both routes render the same component:
// as two components, the viewer mounted again there and fetched the first
// page a second time. On /item/:id it picks the viewer from `location.state`
// (or the item type for direct URLs without state).
// Exported for focused unit testing.
export function MobileStoryRoute({ feed }: { feed?: FeedType }) {
  const { id } = useParams();
  const canSwipe = useCanSwipe();
  const location = useLocation();
  // Newest snapshot taken on this story, read once (sticky for the wrapper's life);
  // used only by Branch 4b to recover the viewer on a stateless reload.
  const [recovered] = useState(() => (feed ? null : readSwipePosition({ storyId: Number(id) })));

  // Counts the feed routes entered from another route. It's in the feed
  // viewer's key, so opening a feed (a tab, the logo, Back to a feed URL)
  // starts it over, while the viewer's own move to /item/:id keeps the key.
  // A tab switch made before that move (first load still running, or a
  // failed one) mounts the new feed's viewer too, so the previous feed's
  // in-flight page can't land in it.
  const [feedEntries, setFeedEntries] = useState(0);
  const [lastFeed, setLastFeed] = useState(feed);
  if (feed !== lastFeed) {
    setLastFeed(feed);
    if (feed) setFeedEntries(feedEntries + 1);
  }

  // HN ids are numeric. The swipe viewer can't fetch anything else, and its
  // NaN id never matches the failed fetch, so it would show the Top feed.
  const isNumericId = id !== undefined && /^\d+$/.test(id);
  const viewer = canSwipe && isNumericId
    ? pickSwipeViewer(location.state as LocationState | null, recovered, id, feedEntries)
    : null;
  const isResolvedStory = useResolveDirectLink(id, canSwipe && isNumericId && !viewer);

  if (feed) {
    return canSwipe ? renderSwipeViewer({ from: feed }, undefined, feedEntries) : <StoryList type={feed} />;
  }

  if (!isNumericId) {
    return <ItemNotFound />;
  }

  if (canSwipe) {
    if (viewer) return viewer;

    // Branch 5: Direct URL (no state) → resolve type first. The story viewer
    // must be the element Branch 4 renders for `{ from: 'top' }`: the first
    // swipe writes that state, and a different element there would remount
    // the viewer and drop the story this link opened.
    if (isResolvedStory) return renderSwipeViewer({ from: 'top' }, id, feedEntries);
    return <MobileItemResolverSkeleton />;
  }
  
  return <ItemDetail key={id} />;
}

function pickSwipeViewer(
  state: LocationState | null,
  recovered: SwipePosition | null,
  id: string,
  feedEntries: number,
): ReactNode {
  // Branch 1: Known comment → SwipeCommentViewer immediately.
  // Comments take priority over user/domain/from to match the header pill
  // priority (comments > user > from).
  if (state?.isComment) {
    return <SwipeCommentViewer initialCommentId={id} />;
  }

  // Branches 2–4: viewer context from location.state (zero-latency path).
  if (state) {
    const viewer = renderSwipeViewer(state, id, feedEntries);
    if (viewer) return viewer;
  }

  // Branch 4b: stateless reload — recover the viewer from the snapshot so
  // non-`top` feeds (best/show/ask/domain/user) restore too. Snapshots come only
  // from story viewers, so we skip the resolver's comment-vs-story fetch. Also
  // fires for a fresh same-tab nav to a still-snapshotted id+viewer (intended:
  // resume where you left off), not just back/reload.
  if (recovered?.storyId === Number(id)) {
    return renderSwipeViewer(recovered.viewer, id, feedEntries);
  }

  return null;
}

function ItemNotFound() {
  useDocumentTitle('Item not found');
  return (
    <div className="page-state-center-padded">
      <StateView variant="not-found" action={{ label: 'Back to Home', to: '/' }} />
    </div>
  );
}

// Resolves item type for a direct URL hit on mobile (no `location.state`):
// a comment re-routes to Branch 1, and anything else reports `true` so the
// wrapper mounts the story viewer.
function useResolveDirectLink(id: string | undefined, enabled: boolean): boolean {
  const [storyId, setStoryId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!enabled || !id) return;
    const controller = new AbortController();

    void fetchItemOnly(id, controller.signal)
      .then(item => {
        if (controller.signal.aborted) return;
        if (item.type === 'comment') {
          // Navigate with state so MobileStoryRoute Branch 1 picks it up
          void navigate(`/item/${id}`, { replace: true, state: { isComment: true } });
        } else {
          setStoryId(id);
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Default to story viewer on error (it has its own error handling)
        setStoryId(id);
      });

    return () => controller.abort();
  }, [id, enabled, navigate]);

  return storyId !== null && storyId === id;
}

function MobileItemResolverSkeleton() {
  const { enableSwipeMode, disableSwipeMode } = useScrollContainer();

  // The skeleton below is the viewer's own panel, and it pads for the fixed
  // chrome itself — so React has to know this is swipe mode before paint, or
  // `<main>` reserves the header a second time and the skeleton starts 56px
  // low, then jumps when the viewer takes over. Before paint, and paired with
  // a release, for the same reasons useSwipeScroll's own call is.
  useLayoutEffect(() => {
    enableSwipeMode();
    return disableSwipeMode;
  }, [enableSwipeMode, disableSwipeMode]);

  return (
    <div className="swipe-snap-container" data-testid="swipe-container">
      <div className="swipe-snap-panel active" data-testid="swipe-panel">
        <FullScreenCommentSkeletonPanel />
      </div>
    </div>
  );
}

function MainContent({ children }: { children: React.ReactNode }) {
  const { isSwipeMode } = useScrollContainer();
  
  // In swipe mode: document scrolls naturally (no height constraint needed).
  // Without h-dvh, ancestor chain grows with panel content.
  //
  // Padding for both fixed bars, since this is the only thing in flow: the
  // header above, the network bar below. Swipe mode reserves that strip inside
  // each panel instead — and this asks React, so an unrouted URL, which the
  // pre-paint class in index.html guesses swipe for, reserves it too.
  return (
    <main
      id="main"
      tabIndex={-1}
      className={isSwipeMode ? '' : 'pt-[var(--header-height)] md:pt-0 pb-[var(--network-bar-height)]'}
    >
      {children}
    </main>
  );
}

function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <StateView
      variant="not-found"
      title="Lost in the feed"
      description="This page doesn't exist, or it wandered off somewhere we can't find it."
      action={{ label: 'Back to Home', to: '/' }}
      className="page-state-center p-6"
    />
  );
}

// Resets the ErrorBoundary when the route changes so stale error
// state is cleared automatically — without this, browser back/forward
// navigation leaves the user stuck on the error screen.
function LocationAwareErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={250}>
        <NetworkStatusProvider>
          <ScrollContainerProvider>
            <HashRouter>
              <LocationAwareErrorBoundary>
                <div className="min-h-screen bg-background text-foreground">
                  <a
                    href="#main"
                    className="skip-link"
                    onClick={(e) => {
                      // Move focus to <main> without mutating the route hash —
                      // a bare `#main` jump would make HashRouter navigate to a
                      // non-existent `main` route and render the 404 page.
                      e.preventDefault();
                      document.getElementById('main')?.focus();
                    }}
                  >
                    Skip to main content
                  </a>
                  <Header />
                  <NetworkStatusBar />
                  <MainContent>
                    <Routes>
                      <Route path="/" element={<MobileStoryRoute feed="top" />} />
                      <Route path="/show" element={<MobileStoryRoute feed="show" />} />
                      <Route path="/ask" element={<MobileStoryRoute feed="ask" />} />
                      <Route path="/best" element={<MobileStoryRoute feed="best" />} />
                      <Route path="/newest" element={<MobileStoryRoute feed="newest" />} />
                      <Route path="/item/:id" element={<MobileStoryRoute />} />
                      <Route path="/from/*" element={<MobileDomainStoriesWrapper />} />
                      <Route path="/user/:id" element={<UserProfile />} />
                      <Route path="/submitted/:id" element={<MobileUserSubmissionsWrapper />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </MainContent>
                </div>
              </LocationAwareErrorBoundary>
            </HashRouter>
          </ScrollContainerProvider>
        </NetworkStatusProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
