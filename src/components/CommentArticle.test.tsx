import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../test/test-utils';
import { CommentArticle } from './CommentArticle';

describe('CommentArticle', () => {
  const mockComment = {
    author: 'patio11',
    text: '<p>Some thoughts.</p>',
    createdAt: Date.now() - 3600000,
    parentId: 12345,
  };

  it('wraps the author byline in a link to /user/:author', () => {
    render(
      <CommentArticle
        comment={mockComment}
        replies={[]}
        itemId={12345}
        itemTitle="Some story"
        loading={false}
      />,
    );

    const authorLink = screen.getByRole('link', { name: 'patio11' });
    expect(authorLink).toHaveAttribute('href', '/user/patio11');
  });
});
