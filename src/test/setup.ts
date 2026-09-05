/// <reference types="node" />
import { afterEach, beforeAll, afterAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { server } from '../mocks/server';
import { cancelAllPrefetches } from '../hooks/usePrefetchItem';
import { clearViewed } from '../utils/viewedItems';

// Create a proper localStorage mock (Node 23 has a broken localStorage)
// Uses a Proxy to properly handle Object.keys() returning only stored keys
function createStorageMock() {
  const store: Record<string, string> = {};
  
  const handler: ProxyHandler<object> = {
    get(_target: object, prop: string) {
      if (prop === 'getItem') return (key: string) => store[key] ?? null;
      if (prop === 'setItem') return (key: string, value: string) => { store[key] = String(value); };
      if (prop === 'removeItem') return (key: string) => { delete store[key]; };
      if (prop === 'clear') return () => { for (const key in store) delete store[key]; };
      if (prop === 'length') return Object.keys(store).length;
      if (prop === 'key') return (index: number) => Object.keys(store)[index] ?? null;
      // For any other property access, check the store
      return store[prop];
    },
    set(_target: object, prop: string, value: unknown) {
      store[prop] = String(value);
      return true;
    },
    deleteProperty(_target: object, prop: string) {
      delete store[prop];
      return true;
    },
    has(_target: object, prop: string) {
      return prop in store;
    },
    ownKeys() {
      return Object.keys(store);
    },
    getOwnPropertyDescriptor(_target: object, prop: string) {
      if (prop in store) {
        return { configurable: true, enumerable: true, value: store[prop] };
      }
      return undefined;
    },
  };
  
  return new Proxy({}, handler);
}

// Override global localStorage/sessionStorage with proper implementations
const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
  configurable: true,
});

// Mock matchMedia (not implemented in jsdom).
//
// `min-width` is answered from `window.innerWidth` — 1024 by default, so the
// suite reads as desktop as it always has — because `useIsMobileLayout` asks a
// width question and a flat `false` would answer it backwards. Everything else
// (`prefers-color-scheme`, `hover`, `pointer`) stays false, as before, which
// also makes jsdom a mouse: tests wanting the swipe viewer mock `useCanSwipe`.
// `rem` counts as 16px: in a media query it is the browser default, which
// jsdom never changes.
const matchesWidthQuery = (query: string): boolean => {
  const min = /min-width:\s*([\d.]+)(px|rem)/.exec(query);
  if (!min) return false;
  return window.innerWidth >= parseFloat(min[1]) * (min[2] === 'rem' ? 16 : 1);
};

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    // A getter, not a value: `useMediaQuery` caches the list for the module's
    // life, so a test that moves `innerWidth` afterwards has to be able to
    // change the answer.
    get matches() { return matchesWidthQuery(query); },
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver (not implemented in jsdom)
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  root: Element | null;
  rootMargin: string;
  scrollMargin: string;
  thresholds: readonly number[];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    this.root = null;
    this.rootMargin = '';
    this.scrollMargin = '';
    this.thresholds = [];
  }
  observe() { /* noop */ }
  unobserve() { /* noop */ }
  disconnect() { /* noop */ }
  takeRecords() { return []; }
}

globalThis.IntersectionObserver = MockIntersectionObserver;

// Mock ResizeObserver (not implemented in jsdom). Required by `usePackedNav`
// — the hook calls `new ResizeObserver(...)` inside useLayoutEffect.
// Callbacks never fire here; jsdom has no layout engine, so any measurement
// would return 0 anyway. Hooks that consume this should treat 0-width as
// "unmeasured" and fall back to a sensible default (`usePackedNav` does:
// stays at `Infinity` and renders all items).
class MockResizeObserver {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() { /* noop */ }
  unobserve() { /* noop */ }
  disconnect() { /* noop */ }
}

globalThis.ResizeObserver = MockResizeObserver;

// Mock requestAnimationFrame (basic implementation for jsdom)
globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
globalThis.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id));

// Polyfill requestIdleCallback for jsdom so that Vitest's fake-timer system
// (which natively supports requestIdleCallback) will detect and replace it.
// The implementation here doesn't matter — fake timers override it entirely.
if (typeof globalThis.requestIdleCallback === 'undefined') {
  (globalThis as unknown as Record<string, unknown>).requestIdleCallback = function requestIdleCallback() { return 0; };
  (globalThis as unknown as Record<string, unknown>).cancelIdleCallback = function cancelIdleCallback() { /* noop */ };
}

// Stub window.scrollTo (not implemented in jsdom)
window.scrollTo = vi.fn() as typeof window.scrollTo;

// Suppress jsdom "Not implemented: navigation" errors (triggered by anchor clicks / form submits).
// jsdom writes these directly to stderr via its VirtualConsole, bypassing console.error.
const origStderrWrite = process.stderr.write;
process.stderr.write = function (
  chunk: Uint8Array | string,
  encodingOrCb?: BufferEncoding | ((error?: Error | null) => void),
  cb?: (error?: Error | null) => void,
): boolean {
  if (typeof chunk === 'string' && chunk.includes('Not implemented: navigation')) return true;
  if (typeof encodingOrCb === 'function') {
    return origStderrWrite.call(process.stderr, chunk, undefined, encodingOrCb);
  }
  return origStderrWrite.call(process.stderr, chunk, encodingOrCb, cb);
};

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

// Reset handlers and clean up after each test
afterEach(() => {
  cleanup();
  server.resetHandlers();
  cancelAllPrefetches();
  clearViewed();
  localStorage.clear();
  sessionStorage.clear();
});

// Close MSW server after all tests
afterAll(() => {
  server.close();
});
