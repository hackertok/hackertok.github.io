# Contributing to HackerTok

Thanks for helping improve HackerTok.

This project is a React + TypeScript + Vite progressive web app for browsing
Hacker News, with Vitest for unit tests and Playwright for end-to-end coverage.
The fastest way to make a useful contribution is to keep changes focused,
reproducible, and easy to review.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- For larger changes, open an issue first so the scope and direction can be
  aligned before implementation.
- Keep behavior changes small and isolated when possible.
- Security issues must follow [SECURITY.md](SECURITY.md), not public issues.

## Development Setup

### Prerequisites

- Node.js
- npm

### Install

```bash
npm ci
```

### Start the app

```bash
npm run dev
```

### Run tests locally

```bash
npm run typecheck
npm run worker:typecheck
npm run lint
npm run test:run
npm run worker:test
npm run worker:dry-run
npm run build
```

If your change affects navigation, comments, theme behavior, responsive layout,
or touch/swipe interactions, also run Playwright:

```bash
npx playwright install
npm run e2e
```

## Contribution Guidelines

- Prefer TypeScript-first changes and match the existing React component style.
- Keep accessibility intact: keyboard support, focus behavior, semantics, and
  readable states matter for this app.
- Preserve mobile behavior. Swipe flows, viewport sizing, and responsive layout
  are part of the product surface, not edge cases.
- Reuse the existing Tailwind-based styling approach instead of adding a second
  styling system.
- Avoid adding dependencies unless they solve a clear problem that the current
  stack cannot reasonably handle.
- Keep Cloudflare changes under `worker/`, regenerate committed bindings with
  `npm run worker:types`, and add D1 changes as forward-only migrations.
- If you touch GitHub Actions, keep actions pinned to full commit SHAs.
- If you render remote HTML or user-generated content, keep the existing
  sanitization guarantees intact.

## Testing Expectations

- Add or update tests when behavior changes.
- Prefer the narrowest test that proves the change.
- Run the relevant local checks before opening a pull request.
- For UI changes, include screenshots or a short recording when it helps review.

## Pull Requests

- Use a clear title and explain the user-visible impact.
- Link the related issue when one exists.
- Note the commands you ran locally.
- Call out follow-up work or known limitations explicitly.

## Licensing

By contributing to this repository, you agree that your contributions will be
licensed under the project's AGPL-3.0-only license.