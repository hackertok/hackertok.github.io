import { HashRouter, Routes, Route, useParams, useLocation } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ScrollContainerProvider, useScrollContainer } from './context/ScrollContainerContext';
import { Header, ErrorBoundary, SwipeStoryViewer } from './components';
import { StoryList, ItemDetail, DomainStories } from './pages';
import { useIsMobile } from './hooks/useIsMobile';
import type { FeedType, LocationState } from './types';

// Mobile wrapper that shows SwipeStoryViewer instead of StoryList
function MobileStoryListWrapper({ type }: { type: FeedType }) {
  const isMobile = useIsMobile();
  
  if (isMobile) {
    return <SwipeStoryViewer type={type} />;
  }
  
  return <StoryList type={type} />;
}

// Mobile wrapper for item detail - shows SwipeStoryViewer with the story in context
function MobileItemDetailWrapper() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  const location = useLocation();
  
  if (isMobile) {
    // On mobile, show swipe viewer starting at this item
    // Use the type from navigation state, or default to 'top'
    const state = location.state as LocationState | null;
    const type = state?.from ?? 'top';
    // key={type} forces a full remount when the section changes (e.g. browser back
    // from best → top). Without it, React reuses the same SwipeStoryViewer instance
    // since both URLs match /item/:id, leaving stale stories from the old section.
    return <SwipeStoryViewer key={type} type={type} initialItemId={id} />;
  }
  
  return <ItemDetail key={id} />;
}

// Main content wrapper that conditionally applies padding
function MainContent({ children }: { children: React.ReactNode }) {
  const { isSwipeMode } = useScrollContainer();
  
  // No top padding in swipe mode (header is relative) or on desktop
  // Only apply pt-14 on mobile when NOT in swipe mode (fixed header)
  return (
    <main className={isSwipeMode ? '' : 'pt-14 md:pt-0'}>
      {children}
    </main>
  );
}

function App() {
  return (
    <ThemeProvider>
      <ScrollContainerProvider>
        <HashRouter>
          <ErrorBoundary>
            <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
              <Header />
              <MainContent>
                <Routes>
                  <Route path="/" element={<MobileStoryListWrapper type="top" />} />
                  <Route path="/show" element={<MobileStoryListWrapper type="show" />} />
                  <Route path="/ask" element={<MobileStoryListWrapper type="ask" />} />
                  <Route path="/best" element={<MobileStoryListWrapper type="best" />} />
                  <Route path="/item/:id" element={<MobileItemDetailWrapper />} />
                  <Route path="/from/*" element={<DomainStories />} />
                </Routes>
              </MainContent>
            </div>
          </ErrorBoundary>
        </HashRouter>
      </ScrollContainerProvider>
    </ThemeProvider>
  );
}

export default App;
