import { HashRouter, Routes, Route, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, type ReactNode } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ScrollContainerProvider } from './context/ScrollContainerContext';
import { useScrollContainer } from './hooks/useScrollContainer';
import { Header, ErrorBoundary, FullScreenCommentSkeletonPanel, StateView, NetworkStatusBar } from './components';
import { TooltipProvider } from './components/ui';
import { StoryList } from './pages';
import { useIsMobile } from './hooks/useIsMobile';
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
import type { FeedType, LocationState } from './types';

function MobileStoryListWrapper({ type }: { type: FeedType }) {
  const isMobile = useIsMobile();
  
  if (isMobile) {
    return <SwipeStoryViewer type={type} />;
  }
  
  return <StoryList type={type} />;
}

// Falls through to the desktop list when the URL has no domain (empty `/from/`)
// so the "No domain specified" fallback in DomainStories handles it consistently
// on both platforms.
function MobileDomainStoriesWrapper() {
  const params = useParams();
  const domain = params['*'] ?? '';
  const isMobile = useIsMobile();

  if (isMobile && domain) {
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
  const isMobile = useIsMobile();

  if (isMobile && username) {
    return <SwipeUserSubmissionsViewer key={username} username={username} />;
  }

  return <UserSubmissions />;
}

// Maps a viewer context to its swipe viewer (priority fromUser → fromDomain → from;
// written mutually exclusively). Shared by the location.state path (Branches 2–4)
// and snapshot recovery (4b); the `key` mirrors viewer identity so switching paths
// reuses the instance. `id` is the story id here (/item/:id), so it's initialItemId.
function renderSwipeViewer(viewer: LocationState, id: string | undefined): ReactNode {
  if (viewer.fromUser) {
    return <SwipeUserSubmissionsViewer key={viewer.fromUser} username={viewer.fromUser} initialItemId={id} />;
  }
  if (viewer.fromDomain) {
    return <SwipeDomainStoryViewer key={viewer.fromDomain} domain={viewer.fromDomain} initialItemId={id} />;
  }
  if (viewer.from) {
    return <SwipeStoryViewer key={viewer.from} type={viewer.from} initialItemId={id} />;
  }
  return null;
}

// Routes /item/:id to the correct mobile viewer based on `location.state`
// (or the item type for direct URLs without state).
// Exported for focused unit testing of the viewer-recovery branch.
export function MobileItemDetailWrapper() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  const location = useLocation();
  // Snapshot read once (sticky for the wrapper's life); used only by Branch 4b to
  // recover the viewer on a stateless reload.
  const [recovered] = useState(() => readSwipePosition());
  
  if (isMobile) {
    const state = location.state as LocationState | null;

    // Branch 1: Known comment → SwipeCommentViewer immediately.
    // Comments take priority over user/domain/from to match the header pill
    // priority (comments > user > from).
    if (state?.isComment && id) {
      return <SwipeCommentViewer initialCommentId={id} />;
    }

    // Branches 2–4: viewer context from location.state (zero-latency path).
    if (state) {
      const viewer = renderSwipeViewer(state, id);
      if (viewer) return viewer;
    }

    // Branch 4b: stateless reload — recover the viewer from the snapshot so
    // non-`top` feeds (best/show/ask/domain/user) restore too. Snapshots come only
    // from story viewers, so we skip the resolver's comment-vs-story fetch. Also
    // fires for a fresh same-tab nav to a still-snapshotted id+viewer (intended:
    // resume where you left off), not just back/reload.
    if (recovered && id && recovered.storyId === Number(id)) {
      const viewer = renderSwipeViewer(recovered.viewer, id);
      if (viewer) return viewer;
    }

    // Branch 5: Direct URL (no state) → resolve type first
    return <MobileItemResolver id={id ?? ''} />;
  }
  
  return <ItemDetail key={id} />;
}

// Resolves item type for a direct URL hit on mobile (no `location.state`),
// then mounts the matching viewer.
function MobileItemResolver({ id }: { id: string }) {
  const [itemType, setItemType] = useState<'story' | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();

    void fetchItemOnly(id, controller.signal)
      .then(item => {
        if (controller.signal.aborted) return;
        if (item.type === 'comment') {
          // Navigate with state so MobileItemDetailWrapper Branch 1 picks it up
          void navigate(`/item/${id}`, { replace: true, state: { isComment: true } });
        } else {
          setItemType('story');
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Default to story viewer on error (it has its own error handling)
        setItemType('story');
      });

    return () => controller.abort();
  }, [id, navigate]);

  if (itemType === 'story') {
    return <SwipeStoryViewer type="top" initialItemId={id} />;
  }

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
  return (
    <main id="main" tabIndex={-1} className={isSwipeMode ? '' : 'pt-14 md:pt-0'}>
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
                      <Route path="/" element={<MobileStoryListWrapper type="top" />} />
                      <Route path="/show" element={<MobileStoryListWrapper type="show" />} />
                      <Route path="/ask" element={<MobileStoryListWrapper type="ask" />} />
                      <Route path="/best" element={<MobileStoryListWrapper type="best" />} />
                      <Route path="/newest" element={<MobileStoryListWrapper type="newest" />} />
                      <Route path="/item/:id" element={<MobileItemDetailWrapper />} />
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
