import { HashRouter, Routes, Route, useParams, useLocation } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ScrollContainerProvider, useScrollContainer } from './context/ScrollContainerContext';
import { Header, ErrorBoundary, SwipeStoryViewer } from './components';
import { StoryList, StoryDetail, DomainStories } from './pages';
import { useIsMobile } from './hooks/useIsMobile';

// Mobile wrapper that shows SwipeStoryViewer instead of StoryList
function MobileStoryListWrapper({ type }) {
  const isMobile = useIsMobile();
  
  if (isMobile) {
    return <SwipeStoryViewer type={type} />;
  }
  
  return <StoryList type={type} />;
}

// Mobile wrapper for story detail - shows SwipeStoryViewer with the story in context
function MobileStoryDetailWrapper() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  const location = useLocation();
  
  if (isMobile) {
    // On mobile, show swipe viewer starting at this story
    // Use the type from navigation state, or default to 'top'
    const type = location.state?.from || 'top';
    // key={type} forces a full remount when the section changes (e.g. browser back
    // from best → top). Without it, React reuses the same SwipeStoryViewer instance
    // since both URLs match /item/:id, leaving stale stories from the old section.
    return <SwipeStoryViewer key={type} type={type} initialStoryId={id} />;
  }
  
  return <StoryDetail key={id} />;
}

// Main content wrapper that conditionally applies padding
function MainContent({ children }) {
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
                  <Route path="/item/:id" element={<MobileStoryDetailWrapper />} />
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
