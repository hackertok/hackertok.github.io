import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../test/test-utils';
import { SwipeStoryViewerCore } from './SwipeStoryViewer';

Object.defineProperty(window, 'innerWidth', { value: 375, writable: true });

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  window.scrollTo = vi.fn();
});

describe('SwipeStoryViewerCore', () => {
  it('uses swipe-mode viewport centering for empty states', () => {
    render(
      <SwipeStoryViewerCore
        stories={[]}
        loading={false}
        error={null}
        hasMore={false}
        loadMore={vi.fn().mockResolvedValue(undefined)}
        backState={{ fromUser: 'levhawk' }}
        titleFallback="Submissions by levhawk"
        emptyTitle={'No submissions found by "levhawk"'}
      />,
    );

    const title = screen.getByRole('heading', {
      name: 'No submissions found by "levhawk"',
    });

    expect(title.closest('div')).toHaveClass('swipe-state-center');
  });
});