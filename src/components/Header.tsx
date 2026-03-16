import { useId } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { useScrollDirection } from '../hooks/useScrollDirection';
import { useScrollContainer } from '../context/ScrollContainerContext';
import { clearListSessionState } from '../utils/itemCache';
import type { LocationState } from '../types';

export function Header() {
  const maskId = useId();
  const { scrollDirection, isAtTop } = useScrollDirection();
  const { isSwipeMode } = useScrollContainer();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  
  // Determine if Show should be highlighted:
  // - On /show route, or
  // - On item detail page when navigated from show list
  const isShowActive = location.pathname === '/show' || 
    (location.pathname.startsWith('/item/') && locationState?.from === 'show');
  
  // Determine if Ask should be highlighted:
  // - On /ask route, or
  // - On item detail page when navigated from ask list
  const isAskActive = location.pathname === '/ask' || 
    (location.pathname.startsWith('/item/') && locationState?.from === 'ask');
  
  // Determine if Best should be highlighted:
  // - On /best route, or
  // - On item detail page when navigated from best list
  const isBestActive = location.pathname === '/best' || 
    (location.pathname.startsWith('/item/') && locationState?.from === 'best');
  
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

  const navLinkClass = (isActive: boolean) =>
    `px-2.5 py-1 rounded-lg text-sm font-medium ${
      isActive
        ? 'bg-accent text-accent-foreground shadow-pill-glow'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
    }`;

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
        <div className="flex items-center justify-between">
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
