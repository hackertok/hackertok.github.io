import { NavLink, Link, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { useScrollDirection } from '../hooks/useScrollDirection';
import { useScrollContainer } from '../context/ScrollContainerContext';
import { clearListSessionState } from '../utils/storyCache';

export function Header() {
  const { scrollDirection, isAtTop } = useScrollDirection();
  const { isSwipeMode } = useScrollContainer();
  const location = useLocation();
  
  // Determine if Show should be highlighted:
  // - On /show route, or
  // - On story detail page when navigated from show list
  const isShowActive = location.pathname === '/show' || 
    (location.pathname.startsWith('/item/') && location.state?.from === 'show');
  
  // Determine if Ask should be highlighted:
  // - On /ask route, or
  // - On story detail page when navigated from ask list
  const isAskActive = location.pathname === '/ask' || 
    (location.pathname.startsWith('/item/') && location.state?.from === 'ask');
  
  // Determine if Best should be highlighted:
  // - On /best route, or
  // - On story detail page when navigated from best list
  const isBestActive = location.pathname === '/best' || 
    (location.pathname.startsWith('/item/') && location.state?.from === 'best');
  
  // On mobile: 
  // - In swipe mode: always visible (like desktop)
  // - In normal mode: show header when scrolling up or at top
  // On desktop: always visible (not sticky)
  const mobileHidden = isSwipeMode 
    ? false  // In swipe mode, always visible
    : scrollDirection === 'down' && !isAtTop;  // Normal scroll behavior

  // Clear all session states so we start fresh (logo = "home/reset" action)
  const handleLogoClick = () => {
    clearListSessionState('top');
    clearListSessionState('best');
    clearListSessionState('show');
    clearListSessionState('ask');
    // Only smooth scroll if already on home - otherwise just navigate (new page starts at top)
    if (location.pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleShowClick = () => {
    clearListSessionState('show');
    // Only smooth scroll if already on show - otherwise just navigate
    if (location.pathname === '/show') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAskClick = () => {
    clearListSessionState('ask');
    // Only smooth scroll if already on ask - otherwise just navigate
    if (location.pathname === '/ask') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBestClick = () => {
    clearListSessionState('best');
    // Only smooth scroll if already on best - otherwise just navigate
    if (location.pathname === '/best') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const navLinkClass = (isActive) =>
    `px-3 py-1.5 rounded-full text-sm font-medium ${
      isActive
        ? 'bg-hn-orange text-white shadow-sm'
        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
    }`;

  return (
    <header 
      className={`
        bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm
        border-b border-gray-100 dark:border-gray-800
        md:relative md:transform-none
        ${isSwipeMode ? 'relative' : 'fixed top-0 left-0 right-0 z-50'}
        transition-transform duration-300 ease-out
        ${!isSwipeMode && mobileHidden ? '-translate-y-full' : 'translate-y-0'}
        md:translate-y-0
      `}
    >
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-3 md:py-2 lg:py-1.5">
        <div className="flex items-center justify-between">
          <Link 
            to="/" 
            onClick={handleLogoClick}
            className="text-lg font-bold tracking-tight text-hn-orange hover:opacity-80 transition-opacity"
          >
            Hacker<span className="text-gray-500 dark:text-gray-400">Tok</span>
          </Link>
          <div className="flex items-center gap-3">
            <nav className="flex gap-1">
              <NavLink
                to="/best"
                onClick={handleBestClick}
                className={() => navLinkClass(isBestActive)}
              >
                best
              </NavLink>
              <NavLink
                to="/show"
                onClick={handleShowClick}
                className={() => navLinkClass(isShowActive)}
              >
                show
              </NavLink>
              <NavLink
                to="/ask"
                onClick={handleAskClick}
                className={() => navLinkClass(isAskActive)}
              >
                ask
              </NavLink>
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
