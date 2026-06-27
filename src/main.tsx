import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { pruneExpiredViewed } from './utils/viewedItems'

// Clean up expired viewed entries on app load (runs exactly once)
pruneExpiredViewed();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the offline app-shell service worker (production only, so it never
// interferes with the dev server / HMR). Pure progressive enhancement: if it fails
// or SWs are blocked, the app runs exactly as before. The SW uses skipWaiting +
// clients.claim, so a new deploy takes over on the next load.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is optional — ignore registration failures */
    });
  });
}
