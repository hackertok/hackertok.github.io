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
