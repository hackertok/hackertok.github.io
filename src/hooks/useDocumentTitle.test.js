import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useDocumentTitle } from './useDocumentTitle';

describe('useDocumentTitle', () => {
  const originalTitle = document.title;

  beforeEach(() => {
    document.title = 'Initial Title';
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it('sets document title with suffix when title provided', () => {
    renderHook(() => useDocumentTitle('Best Stories'));
    expect(document.title).toBe('Best Stories | HackerTok');
  });

  it('sets just "HackerTok" when no title provided', () => {
    renderHook(() => useDocumentTitle());
    expect(document.title).toBe('HackerTok');
  });

  it('sets just "HackerTok" when empty string provided', () => {
    renderHook(() => useDocumentTitle(''));
    expect(document.title).toBe('HackerTok');
  });

  it('updates title when title changes', () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: 'First' },
    });
    expect(document.title).toBe('First | HackerTok');

    rerender({ title: 'Second' });
    expect(document.title).toBe('Second | HackerTok');
  });

  it('restores previous title on unmount', () => {
    const { unmount } = renderHook(() => useDocumentTitle('Test Page'));
    expect(document.title).toBe('Test Page | HackerTok');

    unmount();
    expect(document.title).toBe('Initial Title');
  });
});
