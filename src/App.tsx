import { HashRouter, Routes, Route, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ScrollContainerProvider } from './context/ScrollContainerContext';
import { useScrollContainer } from './hooks/useScrollContainer';
import { Header, ErrorBoundary, SwipeStoryViewer, SwipeDomainStoryViewer, SwipeUserSubmissionsViewer, SwipeCommentViewer, FullScreenCommentSkeleton, StateView, NetworkStatusBar } from './components';
import { StoryList, ItemDetail, DomainStories, UserProfile, UserSubmissions } from './pages';
import { useIsMobile } from './hooks/useIsMobile';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { NetworkStatusProvider } from './context/NetworkStatusContext';
import { fetchItemOnly } from './api/hn';
import type { FeedType, LocationState } from './types';

// Mobile wrapper that shows SwipeStoryViewer instead of StoryList
function MobileStoryListWrapper({ type }: { type: FeedType }) {
  const isMobile = useIsMobile();
  
  if (isMobile) {
    return <SwipeStoryViewer type={type} />;
  }
  
  return <StoryList type={type} />;
}

// Mobile wrapper for domain filter pages - shows SwipeDomainStoryViewer on mobile, DomainStories list on desktop.
// Falls through to the desktop list when the URL has no domain (empty `/from/`) so the
// "No domain specified" fallback in DomainStories handles it consistently on both platforms.
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

// Mobile wrapper for /submitted/:id — shows SwipeUserSubmissionsViewer on
// mobile, UserSubmissions list on desktop. Falls through to the desktop list
// when the URL has no username so UserSubmissions' "No user specified" state
// renders consistently on both platforms.
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

// Mobile wrapper for item detail - routes to correct viewer based on item type
function MobileItemDetailWrapper() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  const location = useLocation();
  
  if (isMobile) {
    const state = location.state as LocationState | null;

    // Branch 1: Known comment → SwipeCommentViewer immediately.
    // Comments take priority over user/domain/from to match the header pill
    // priority (comments > user > from).
    if (state?.isComment && id) {
      return <SwipeCommentViewer initialCommentId={id} />;
    }

    // Branch 2: Known user submissions → SwipeUserSubmissionsViewer.
    // Ordered before fromDomain/from so /item/:id with fromUser anchors on
    // the user's submissions list. Here `id` IS the story id (we're on
    // /item/:id), so passing it as initialItemId is correct — distinct from
    // MobileUserSubmissionsWrapper above where `id` is a username.
    if (state?.fromUser) {
      return <SwipeUserSubmissionsViewer key={state.fromUser} username={state.fromUser} initialItemId={id} />;
    }

    // Branch 3: Known domain swipe → SwipeDomainStoryViewer.
    // Ordered before the `from` branch so /item/:id with fromDomain picks up
    // the domain viewer; `from`, `fromDomain`, and `fromUser` are written
    // mutually exclusively by their respective viewers today.
    if (state?.fromDomain) {
      return <SwipeDomainStoryViewer key={state.fromDomain} domain={state.fromDomain} initialItemId={id} />;
    }

    // Branch 4: Known story feed → SwipeStoryViewer (existing zero-latency path)
    if (state?.from) {
      const type = state.from;
      return <SwipeStoryViewer key={type} type={type} initialItemId={id} />;
    }

    // Branch 5: Direct URL (no state) → resolve type first
    return <MobileItemResolver id={id ?? ''} />;
  }
  
  return <ItemDetail key={id} />;
}

// Resolves item type for direct URL access on mobile, then mounts correct viewer
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

  // Loading skeleton while resolving type
  return (
    <div className="swipe-snap-container" data-testid="swipe-container">
      <div className="swipe-snap-panel" data-testid="swipe-panel">
        <FullScreenCommentSkeleton />
      </div>
    </div>
  );
}

// Main content wrapper that conditionally applies padding
function MainContent({ children }: { children: React.ReactNode }) {
  const { isSwipeMode } = useScrollContainer();
  
  // In swipe mode: position fixed removes content from document flow,
  // preventing the swipe container's internal scroll width from expanding
  // the viewport's scrollable area (which causes the horizontal overflow bug
  // when transitioning from desktop to mobile while offline).
  return (
    <main className={`overflow-x-clip ${isSwipeMode ? 'fixed inset-0 top-[var(--header-height)]' : 'pt-14 md:pt-0'}`}>
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

function App() {
  return (
    <ThemeProvider>
      <NetworkStatusProvider>
      <ScrollContainerProvider>
        <HashRouter>
          <ErrorBoundary>
            <div className="min-h-screen bg-background text-foreground">
              <Header />
              <NetworkStatusBar />
              <MainContent>
                <Routes>
                  <Route path="/" element={<MobileStoryListWrapper type="top" />} />
                  <Route path="/show" element={<MobileStoryListWrapper type="show" />} />
                  <Route path="/ask" element={<MobileStoryListWrapper type="ask" />} />
                  <Route path="/best" element={<MobileStoryListWrapper type="best" />} />
                  <Route path="/item/:id" element={<MobileItemDetailWrapper />} />
                  <Route path="/from/*" element={<MobileDomainStoriesWrapper />} />
                  <Route path="/user/:id" element={<UserProfile />} />
                  <Route path="/submitted/:id" element={<MobileUserSubmissionsWrapper />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </MainContent>
            </div>
          </ErrorBoundary>
        </HashRouter>
      </ScrollContainerProvider>
      </NetworkStatusProvider>
    </ThemeProvider>
  );
}

export default App;
