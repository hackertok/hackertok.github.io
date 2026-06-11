# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| Latest  | :white_check_mark: |

Only the latest released deployment of HackerTok receives security updates. Older releases are not maintained.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them using [GitHub Security Advisories](https://github.com/hackertok/hackertok.github.io/security/advisories/new).

You should receive an initial response within 72 hours. If the issue is confirmed, a fix will be released as soon as possible depending on complexity.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Security Measures

This project employs the following security practices:

- All GitHub Actions are pinned to full-length commit SHAs
- Automated dependency updates via Dependabot (daily)
- Dependency review on all pull requests
- CodeQL static analysis on pushes and pull requests to `main`, plus weekly scheduled scans
- OpenSSF Scorecard monitoring
- HTML sanitization via DOMPurify
- A strict Content-Security-Policy delivered via `<meta http-equiv>`; inline scripts are allowed by SHA-256 hash rather than `'unsafe-inline'`, and `connect-src` is limited to the Hacker News APIs

### Accepted GitHub Pages constraints

GitHub Pages serves static files and cannot set HTTP response headers, which limits a few defenses to what a `<meta>` CSP can express:

- No clickjacking protection. `frame-ancestors` is ignored when a CSP is delivered via `<meta>`, and `X-Frame-Options` cannot be sent, so the site can be embedded in a frame.
- No CSP violation reporting. `report-to`/`report-uri` require a response header and a collection endpoint, neither of which is available; the build instead fails if any executable inline script in the built HTML lacks a CSP hash, and the e2e suite asserts the deployed policy is violation-free.
