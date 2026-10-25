import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Routes, Route, useLocation } from 'react-router';
import { render, screen, waitFor, act } from './test/test-utils';
import { MobileStoryRoute } from './App';
import { ScrollContainerProvider } from './context/ScrollContainerContext';
import { hnSdk } from './api/hnSdk';
import { __resetFetchCachesForTests } from './api/hn';
import type { FirebaseItem } from './types';

// App.test.tsx stubs the swipe viewers; this file runs the real one.
vi.mock('./hooks/useCanSwipe', () => ({ useCanSwipe: () => true }));

const ids = Array.from({ length: 60 }, (_, i) => 1000 + i);
const story = (id: number): FirebaseItem => ({
  id, type: 'story', title: `Story ${id}`, by: 'u', score: 1,
  time: Math.floor(Date.now() / 1000) - 60, descendants: 0, url: `https://example.com/${id}`,
});

function Pathname() {
  return <div data-testid="pathname">{useLocation().pathname}</div>;
}

describe('opening a feed on a phone', () => {
  beforeEach(() => {
    __resetFetchCachesForTests();
    vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(ids);
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => story(Number(id)));
  });

  it('fetches the first page once', async () => {
    render(
      <ScrollContainerProvider>
        <Routes>
          <Route path="/best" element={<MobileStoryRoute feed="best" />} />
          <Route path="/item/:id" element={<MobileStoryRoute />} />
        </Routes>
        <Pathname />
      </ScrollContainerProvider>,
      { initialEntries: ['/best'] },
    );

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/item/1000'));
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });

    // Index 20 is past the rendered panels and the 6-story prefetch, so only
    // a page request reads it.
    const reads = vi.mocked(hnSdk.readItem).mock.calls.filter(([id]) => Number(id) === 1020);
    expect(reads).toHaveLength(1);
    expect(hnSdk.readRankedIds).toHaveBeenCalledTimes(1);
  });
});
