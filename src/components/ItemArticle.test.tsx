import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../test/test-utils';
import { ItemArticle } from './ItemArticle';
import type { JobItem, StoryItem } from '../types';

function story(overrides: Partial<StoryItem> = {}): StoryItem {
  return {
    id: 12345,
    type: 'story',
    title: 'A great story',
    url: 'https://example.com/article',
    points: 100,
    author: 'leerob',
    createdAt: Date.now() - 3600000,
    commentCount: 5,
    ...overrides,
  };
}

describe('ItemArticle', () => {
  describe('author byline link', () => {
    it('wraps the author byline in a link to /user/:author', () => {
      render(<ItemArticle item={story()} />);

      const authorLink = screen.getByRole('link', { name: 'leerob' });
      expect(authorLink).toHaveAttribute('href', '/user/leerob');
    });

    it('does not render an author block when author is empty', () => {
      render(<ItemArticle item={story({ author: '' })} />);

      // Empty author renders nothing — no link, no span. Avoids /user/(empty),
      // which 404s in HackerTok.
      expect(screen.queryByRole('link', { name: '' })).not.toBeInTheDocument();
      expect(screen.queryByText('unknown')).not.toBeInTheDocument();
    });

    it('does not link the byline when author is the literal "unknown" string', () => {
      // Mirrors StoryCard: legacy data ships the literal 'unknown' string.
      render(<ItemArticle item={story({ author: 'unknown' })} />);

      const placeholder = screen.getByText('unknown');
      expect(placeholder.tagName).toBe('SPAN');
      expect(screen.queryByRole('link', { name: 'unknown' })).not.toBeInTheDocument();
    });
  });

  describe('counts (defensive fallbacks)', () => {
    it('renders "0 points" when points is missing (Algolia/Firebase oddity)', () => {
      // Mirrors StoryCard's `?? 0` fallback — see that file's comment for rationale.
      render(<ItemArticle item={story({ points: null as unknown as number })} />);

      expect(screen.getByText(/^0\s+points$/)).toBeInTheDocument();
    });

    it('renders "0 comments" when commentCount is missing', () => {
      render(<ItemArticle item={story({ commentCount: null as unknown as number })} />);

      expect(screen.getByText(/^0\s+comments$/)).toBeInTheDocument();
    });

    it('forces "0 comments" on job posts even when API reports a non-zero count', () => {
      // type: 'job' never accepts comments, but the API sometimes ships
      // a stale descendants count anyway. The render coerces to 0 so we
      // never surface a commentable affordance for a non-commentable post.
      //
      // JobItem's type doesn't include commentCount; the intersection
      // here mirrors what the API/normalizer actually hands ItemArticle.
      const jobWithStaleCount: JobItem & { commentCount: number } = {
        id: 12345,
        type: 'job',
        title: 'YC W26: We are hiring engineers',
        url: 'https://example.com/jobs',
        author: 'whoishiring',
        createdAt: Date.now() - 3600000,
        points: 1,
        commentCount: 99,
      };
      render(<ItemArticle item={jobWithStaleCount} />);

      expect(screen.getByText(/^0\s+comments$/)).toBeInTheDocument();
      expect(screen.queryByText(/99\s+comments/)).not.toBeInTheDocument();
    });
  });
});
