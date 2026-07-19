<div id="banner" align="center">
  <a href="https://hackertok.github.io" target="_blank" rel="noopener">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset="public/icons/og-image-light.svg" />
      <img src="public/icons/og-image.svg" alt="HackerTok" />
    </picture>
  </a>
</div>

<br/>

<div align="center">
  <h2>An open-source, blazingly fast, progressive Hacker News client.</h2>
  <p>
    <a href="https://github.com/hackertok/hackertok.github.io/actions/workflows/ci.yml"><img src="https://github.com/hackertok/hackertok.github.io/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://scorecard.dev/viewer/?uri=github.com/hackertok/hackertok.github.io"><img src="https://api.scorecard.dev/projects/github.com/hackertok/hackertok.github.io/badge" alt="OpenSSF Scorecard"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0--only-blue?labelColor=333" alt="License: AGPL-3.0-only"></a>
    <a href="https://hackertok.github.io"><img src="https://img.shields.io/badge/-hackertok.github.io-f36303?labelColor=333&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik01IDJhLjc1Ljc1IDAgMCAwIDAgMS41aDYuNDRMMi43MiAxMi4yMmEuNzUuNzUgMCAxIDAgMS4wNiAxLjA2TDEyLjUgNC41NlYxMWEuNzUuNzUgMCAwIDAgMS41IDBWMi43NUEuNzUuNzUgMCAwIDAgMTMuMjUgMkg1eiIvPjwvc3ZnPg==" alt="HackerTok"></a>
  </p>
</div>

<br/>

## ✨ Features

| Feature                       | Description                                                    |
|-------------------------------|----------------------------------------------------------------|
| 🎨 **Modern and Adaptive UI** | Responds to your screen size, theme, and system preferences    |
| ⚡ **Blazingly Fast**          | Multi-layer caching and predictive prefetching                 |
| 🔒 **Secure and Private**     | No ads, no tracking, secure by default                         |
| ♾️ **Infinite Feed**          | Swipe or scroll endlessly — no job posts, no hiring threads    |
| 📲 **Installable PWA**        | Add to home screen for a native app experience                 |
| 🔔 **1,000+ Story Alerts**    | Optional anonymous native Web Push for exceptional HN stories  |
| ♿ **Accessible**              | WCAG-tested with keyboard navigation and screen reader support |

## 🚀 Deployment

The production site is published to GitHub Pages at [hackertok.github.io](https://hackertok.github.io).

Deployments are release-driven rather than branch-driven. This keeps production tied to explicit versioned releases.
Each release applies D1 migrations, deploys and smoke-tests the Cloudflare Push Worker, waits for its initial
story scan, and then publishes the already-built GitHub Pages artifact. Worker provisioning and operations are
documented in [worker/README.md](worker/README.md).

## 🔐 Security

This project follows a defense-in-depth model with strong governance, tightly controlled maintainer access, automated
dependency updates, security scanning, and modern open-source security best practices.

Please report security vulnerabilities privately
through [GitHub Security Advisories](https://github.com/hackertok/hackertok.github.io/security/advisories/new), not
public issues. The full disclosure process is documented in [SECURITY.md](SECURITY.md).
The anonymous alert data model and retention policy are documented in [PRIVACY.md](PRIVACY.md).

## 🛠️ Tech Stack

HackerTok is built with React, TypeScript, and Vite, styled with Tailwind CSS and Radix UI, and tested and automated
with Vitest, Playwright, and GitHub Actions. Native story alerts use a Cloudflare Worker, D1, Queues, Turnstile
admission control, standards-based Web Push with VAPID, and an IndexedDB/Web Locks client lifecycle shared with
the service worker.

## 🤝 Contributing

Contributions are welcome, especially bug fixes and focused improvements to performance, accessibility, mobile
ergonomics, and reading flow.

For the full contribution workflow and review expectations, see [CONTRIBUTING.md](CONTRIBUTING.md).

## 📜 License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only).

You are free to use, modify, and distribute this software under the terms of the AGPL-3.0. If you run a modified version
of this software as a network service, you must make the complete source code available to users of that service.

---

<div align="center">

**[⬆ Back to Top](#banner)**

Made with ❤️ for the HN community

</div>
