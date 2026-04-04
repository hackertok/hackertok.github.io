import { HashRouter, Routes, Route, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { ScrollContainerProvider } from './context/ScrollContainerContext';
import { useScrollContainer } from './hooks/useScrollContainer';
import { Header, ErrorBoundary, SwipeStoryViewer, SwipeCommentViewer, FullScreenCommentSkeleton, StateView, NetworkStatusBar } from './components';
import { StoryList, ItemDetail, DomainStories } from './pages';
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

// Mobile wrapper for item detail - routes to correct viewer based on item type
function MobileItemDetailWrapper() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  const location = useLocation();
  
  if (isMobile) {
    const state = location.state as LocationState | null;

    // Branch 1: Known comment → SwipeCommentViewer immediately
    if (state?.isComment && id) {
      return <SwipeCommentViewer initialCommentId={id} />;
    }

    // Branch 2: Known story feed → SwipeStoryViewer (existing zero-latency path)
    if (state?.from) {
      const type = state.from;
      return <SwipeStoryViewer key={type} type={type} initialItemId={id} />;
    }

    // Branch 3: Direct URL (no state) → resolve type first
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
                  <Route path="/from/*" element={<DomainStories />} />
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
