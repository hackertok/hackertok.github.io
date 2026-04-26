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

// Mock matchMedia (not implemented in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
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
  thresholds: readonly number[];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    this.root = null;
    this.rootMargin = '';
    this.thresholds = [];
  }
  observe() { /* noop */ }
  unobserve() { /* noop */ }
  disconnect() { /* noop */ }
  takeRecords() { return []; }
}

globalThis.IntersectionObserver = MockIntersectionObserver;

// Mock requestAnimationFrame (basic implementation for jsdom)
globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id));

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
