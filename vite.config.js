/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Build-time CSP as a <meta http-equiv> — GitHub Pages can't set response
// headers. Build-only so dev HMR (inline scripts + ws://) keeps working.
// script-src avoids 'unsafe-inline' by hashing executable inline scripts from
// the FINAL html (order: 'post') so hashes can't drift; inert blocks like
// <script type="application/ld+json"> aren't governed by script-src, so skip them.
function htmlMetaCsp(pushApiOrigin) {
  const SELF = "'self'"
  const TURNSTILE = 'https://challenges.cloudflare.com'
  const sha256 = (content) =>
    `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`

  // script-src governs only scripts the browser executes (classic/module): an
  // absent/empty type, "module", or an exact case-insensitive match for a
  // JavaScript MIME type essence string. A parameterized type like
  // "text/javascript;charset=utf-8" is NOT a match, so the browser treats it as
  // inert data and we must not hash it. The essence list (incl. legacy aliases)
  // is verified to execute across Chromium/Firefox/WebKit; inert blocks like
  // <script type="application/ld+json"> don't.
  const JS_MIME_ESSENCE = new Set([
    'application/ecmascript', 'application/javascript',
    'application/x-ecmascript', 'application/x-javascript',
    'text/ecmascript', 'text/javascript',
    'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
    'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5',
    'text/jscript', 'text/livescript',
    'text/x-ecmascript', 'text/x-javascript',
  ])
  const isExecutableType = (type) => {
    const t = type.trim().toLowerCase()
    return t === '' || t === 'module' || JS_MIME_ESSENCE.has(t)
  }
  const typeOfTag = (attrs) => {
    const m = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)
    return m ? m[1] : ''
  }

  return {
    name: 'html-meta-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        // \ssrc= lookahead skips external <script src=...>; the jsdom check
        // below backstops its blind spot (inline script with " src=" in an attr).
        const inlineScript = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi
        const scriptHashes = []
        let match
        while ((match = inlineScript.exec(html)) !== null) {
          if (isExecutableType(typeOfTag(match[1]))) {
            scriptHashes.push(sha256(match[2]))
          }
        }

        const connectSources = [
          SELF,
          'https://hn.algolia.com',
          'wss://*.firebaseio.com',
          TURNSTILE,
        ]
        if (pushApiOrigin) connectSources.push(pushApiOrigin)

        const csp = [
          `default-src ${SELF}`,
          `base-uri ${SELF}`,
          `object-src 'none'`,
          `frame-src ${TURNSTILE}`,
          `script-src ${SELF} ${TURNSTILE} ${scriptHashes.join(' ')}`,
          // unsafe-inline for styles only: React inline styles + dynamic CSS
          // vars can't be practically hashed.
          `style-src ${SELF} 'unsafe-inline'`,
          `img-src ${SELF} data:`,
          `font-src ${SELF}`,
          // Algolia REST (https) + Firebase RTDB (wss only — forceWebSockets()
          // means no https/long-poll to firebaseio, and https doesn't relax to
          // wss). The wildcard covers RTDB's dynamically-assigned shard hosts.
          `connect-src ${connectSources.join(' ')}`,
          `manifest-src ${SELF}`,
          `worker-src ${SELF}`,
          `form-action ${SELF}`,
          // No upgrade-insecure-requests: all endpoints are already https/wss,
          // and WebKit upgrades even http://localhost, breaking the preview e2e.
          // No frame-ancestors: ignored in a <meta> CSP (see SECURITY.md).
        ].join('; ')

        const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
        // After <meta charset> so it stays in the first 1024 bytes and the CSP
        // precedes the inline scripts it governs.
        const out = html.replace(
          /(<meta charset=["'][^"']*["']\s*\/?>)/i,
          `$1\n    ${meta}`
        )
        if (out === html) {
          throw new Error('[html-meta-csp] <meta charset> anchor not found — CSP was not injected')
        }

        await assertEveryInlineScriptHashed(out, csp, sha256, isExecutableType)
        return out
      },
    },
  }
}

function validatePushApiOrigin(rawValue, required) {
  const raw = rawValue?.trim() ?? ''
  if (!raw) {
    if (required) {
      throw new Error('VITE_PUSH_API_URL is required for release builds')
    }
    return undefined
  }

  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('VITE_PUSH_API_URL must be an absolute URL')
  }
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new Error('VITE_PUSH_API_URL must use HTTPS outside localhost')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_PUSH_API_URL must not contain credentials, query, or fragment')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('VITE_PUSH_API_URL must contain only an origin')
  }
  return url.origin
}

// Backstop: re-parse the final html with jsdom (not the extraction regex) and
// fail the build if any executable inline script lacks a hash — catches the
// regex's blind spot and any future plugin that injects unhashed scripts.
async function assertEveryInlineScriptHashed(out, csp, sha256, isExecutableType) {
  const { JSDOM } = await import('jsdom')
  const { document } = new JSDOM(out).window
  for (const el of document.querySelectorAll('script')) {
    if (el.hasAttribute('src')) continue
    if (!isExecutableType(el.getAttribute('type') ?? '')) continue
    const hash = sha256(el.textContent ?? '')
    if (!csp.includes(hash)) {
      throw new Error(
        `[html-meta-csp] executable inline <script> is not allow-listed by the CSP (${hash}). ` +
        `The src= extraction regex likely skipped it — fix the script or the regex.`,
      )
    }
  }
}

// RFC 9116 security.txt emitted at build time so the required Expires stays
// fresh (+6mo, under the RFC's <1yr) and can't silently go stale. Pages serves
// the dot-directory because the Actions artifact deploy skips Jekyll.
function wellKnownSecurityTxt() {
  const REPO = 'https://github.com/hackertok/hackertok.github.io'
  const SITE = 'https://hackertok.github.io'
  return {
    name: 'well-known-security-txt',
    apply: 'build',
    generateBundle() {
      const expires = new Date()
      expires.setUTCMonth(expires.getUTCMonth() + 6)
      expires.setUTCMilliseconds(0)
      const source = [
        '# HackerTok security contact (RFC 9116). Expires regenerated each build.',
        `Contact: ${REPO}/security/advisories/new`,
        `Expires: ${expires.toISOString().replace('.000Z', 'Z')}`,
        `Policy: ${REPO}/blob/main/SECURITY.md`,
        `Canonical: ${SITE}/.well-known/security.txt`,
        'Preferred-Languages: en',
        '',
      ].join('\n')
      this.emitFile({ type: 'asset', fileName: '.well-known/security.txt', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const pushApiOrigin = validatePushApiOrigin(
    env.VITE_PUSH_API_URL,
    env.REQUIRE_PUSH_API_URL === '1',
  )

  return {
    plugins: [react(), tailwindcss(), htmlMetaCsp(pushApiOrigin), wellKnownSecurityTxt()],
    base: '/',
    resolve: {
    // Mirrors tsconfig.json paths and components.json aliases so `@/...`
    // imports resolve at build time, dev time, AND test time. This is the
    // unified Vite + Vitest config (see the `test:` block below) — the alias
    // automatically applies to test runs without a separate vitest.config.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        exclude: ['node_modules/', 'src/test/'],
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
              return 'firebase';
            }
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react-router') || id.includes('node_modules/react/')) {
              return 'react';
            }
          }
        },
      },
    },
  }
})
