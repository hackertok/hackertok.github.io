import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Routes, Route, useNavigate } from 'react-router';
import { render, screen, waitFor, act, fireEvent } from '../test/test-utils';
import { MobileStoryRoute } from '../App';
import { hnSdk } from '../api/hnSdk';
import { __resetFetchCachesForTests } from '../api/hn';
import { saveListSessionState, getListSessionState } from '../utils/itemCache';
import { setCachedFeed } from '../utils/feedCache';
import { createStoryItem } from '../test/factories';
import type { FirebaseItem } from '../types';

const ids = Array.from({ length: 80 }, (_, i) => 1000 + i);
const story = (id: number): FirebaseItem => ({
  id, type: 'story', title: `Story ${id}`, by: 'u', score: 1,
  time: Math.floor(Date.now() / 1000) - 60, descendants: 0, url: `https://example.com/${id}`,
});

function HistoryButtons() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => void navigate('/show')}>show</button>
      <button onClick={() => void navigate(-1)}>back</button>
    </>
  );
}

// Under the app's feed routes, where one route component renders every feed.
describe('StoryList on the feed routes', () => {
  beforeEach(() => {
    __resetFetchCachesForTests();
    vi.spyOn(hnSdk, 'readRankedIds').mockResolvedValue(ids);
    vi.spyOn(hnSdk, 'readItem').mockImplementation(async (id) => story(Number(id)));
  });

  it('restores a feed\'s saved list on Back from another feed', async () => {
    // Best as opening its 50th story left it: two pages loaded.
    const best = ids.slice(0, 50).map(id => createStoryItem({ id, title: `Story ${id}` }));
    setCachedFeed('best', best);
    saveListSessionState('best', {
      scrollY: 0, storyIds: best.map(s => s.id), position: 60, seenIds: best.map(s => s.id), hasMore: true,
    });

    render(
      <>
        <Routes>
          <Route path="/best" element={<MobileStoryRoute feed="best" />} />
          <Route path="/show" element={<MobileStoryRoute feed="show" />} />
        </Routes>
        <HistoryButtons />
      </>,
      { initialEntries: ['/best'] },
    );
    await waitFor(() => expect(screen.getAllByTestId('story-card')).toHaveLength(50));

    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Story 1000' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    await act(async () => { await new Promise(r => setTimeout(r, 100)); });

    expect(screen.getAllByTestId('story-card')).toHaveLength(50);
    expect(getListSessionState('best')?.storyIds).toHaveLength(50);
  });
});
