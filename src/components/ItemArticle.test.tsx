import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../test/test-utils';
import { ItemArticle } from './ItemArticle';
import type { StoryItem } from '../types';

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

    it('does not render an author link when author is empty', () => {
      render(<ItemArticle item={story({ author: '' })} />);

      // No author <a> at all — preserves the meta row's spacing and avoids
      // pointing at /user/(empty), which would 404 inside HackerTok.
      expect(screen.queryByRole('link', { name: '' })).not.toBeInTheDocument();
    });
  });
});
