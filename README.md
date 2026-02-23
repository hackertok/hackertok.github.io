# HackerTok

A TikTok-style Hacker News reader with infinite scroll and dark mode.

## Features

- **Infinite Scroll** - Endlessly scroll through stories, TikTok-style
- **Dark/Light Mode** - Toggle between themes or use system preference
- **Top Stories** - Live front page stories from Firebase API
- **Best Stories** - High-scoring stories with infinite scroll
- **Show HN** - Community projects you can try, ranked by HN's gravity algorithm
- **Ask HN** - Community discussions and questions, ranked by HN's gravity algorithm
- **Domain Stories** - Click on any hostname to see all stories from that domain
- **Threaded Comments** - Collapsible comment threads with proper nesting
- **Mobile-First Design** - Responsive and touch-friendly with auto-hiding header

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Testing

```bash
# Run tests in watch mode
npm test

# Run tests once (CI mode)
npm run test:run

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```
