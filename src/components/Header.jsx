import { NavLink, Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { useScrollDirection } from '../hooks/useScrollDirection';

export function Header() {
  const { scrollDirection, isAtTop } = useScrollDirection();
  
  // On mobile: show header when scrolling up or at top
  // On desktop: always visible (not sticky)
  const mobileHidden = scrollDirection === 'down' && !isAtTop;

  const navLinkClass = (isActive) =>
    `px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
      isActive
        ? 'bg-hn-orange text-white shadow-sm'
        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`;

  return (
    <header 
      className={`
        bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm
        border-b border-gray-100 dark:border-gray-800
        md:relative md:transform-none
        fixed top-0 left-0 right-0 z-50
        transition-transform duration-300 ease-out
        ${mobileHidden ? '-translate-y-full' : 'translate-y-0'}
        md:translate-y-0
      `}
    >
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-3 md:py-2 lg:py-1.5">
        <div className="flex items-center justify-between">
          <Link 
            to="/" 
            className="text-lg font-bold tracking-tight text-hn-orange hover:opacity-80 transition-opacity"
          >
            Hacker<span className="text-gray-500 dark:text-gray-400">Tok</span>
          </Link>
          <div className="flex items-center gap-3">
            <nav>
              <NavLink
                to="/best"
                className={({ isActive }) => navLinkClass(isActive)}
              >
                best
              </NavLink>
            </nav>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
