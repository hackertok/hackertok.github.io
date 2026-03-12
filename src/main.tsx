import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { pruneExpiredViewed } from './utils/viewedItems'

// Clean up expired viewed entries on app load (runs exactly once)
pruneExpiredViewed(24);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
