import { HashRouter, Routes, Route, useParams } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { Header, ErrorBoundary } from './components';
import { StoryList, StoryDetail, DomainStories } from './pages';

// Wrapper to force StoryDetail remount when id changes (for proper cache initialization)
function StoryDetailWrapper() {
  const { id } = useParams();
  return <StoryDetail key={id} />;
}

function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <ErrorBoundary>
          <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
            <Header />
            {/* Add top padding on mobile for fixed header */}
            <main className="pt-14 md:pt-0">
              <Routes>
                <Route path="/" element={<StoryList type="top" />} />
                <Route path="/show" element={<StoryList type="show" />} />
                <Route path="/best" element={<StoryList type="best" />} />
                <Route path="/item/:id" element={<StoryDetailWrapper />} />
                <Route path="/from/*" element={<DomainStories />} />
              </Routes>
            </main>
          </div>
        </ErrorBoundary>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
