import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Comment, CommentTree } from './Comment';
import type { Comment as CommentType } from '../types';
import { createComment } from '../test/factories';

describe('Comment', () => {
  const mockComment = createComment({
    id: 1,
    author: 'testuser',
    text: '<p>This is a test comment</p>',
    createdAt: Date.now() - 3600000,
  });

  const mockCommentWithChildren = createComment({
    id: 2,
    author: 'parentuser',
    text: '<p>Parent comment</p>',
    createdAt: Date.now() - 7200000,
    children: [
      createComment({
        id: 3,
        author: 'childuser',
        text: '<p>Child comment</p>',
        createdAt: Date.now() - 3600000,
      }),
    ],
  });

  describe('rendering', () => {
    it('renders comment author', () => {
      render(<Comment comment={mockComment} />);
      
      expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    it('renders comment content', () => {
      render(<Comment comment={mockComment} />);
      
      expect(screen.getByText('This is a test comment')).toBeInTheDocument();
    });

    it('renders relative time', () => {
      render(<Comment comment={mockComment} />);
      
      expect(screen.getByText(/hour ago/i)).toBeInTheDocument();
    });

    it('sanitizes HTML content', () => {
      const commentWithScript = {
        ...mockComment,
        text: '<p>Safe text</p><script>alert("xss")</script>',
      };
      
      render(<Comment comment={commentWithScript} />);
      
      expect(screen.getByText('Safe text')).toBeInTheDocument();
      expect(screen.queryByText('alert')).not.toBeInTheDocument();
    });

    it('wraps the author byline in a link to /user/:author', () => {
      render(<Comment comment={mockComment} />);

      const authorLink = screen.getByRole('link', { name: 'testuser' });
      expect(authorLink).toHaveAttribute('href', '/user/testuser');
    });

    // Integration smoke test for the sanitize → dangerouslySetInnerHTML path.
    // The unit suite in `utils/sanitize.test.ts` covers `sanitizeHtml`'s
    // output; this asserts the rewrite actually reaches the rendered DOM
    // and isn't bypassed by a future refactor of `Comment.tsx`.
    it('rewrites HN item links in the rendered DOM', () => {
      const commentWithHnLink = {
        ...mockComment,
        text: '<p>See <a href="https://news.ycombinator.com/item?id=99999">https://news.ycombinator.com/item?id=99999</a></p>',
      };
      const { container } = render(<Comment comment={commentWithHnLink} />);
      const link = container.querySelector('.comment-content a');
      expect(link?.getAttribute('href')).toBe('#/item/99999');
      expect(link?.textContent).toBe('item:99999');
    });

    // Companion to the `item:` smoke test above — pins that `user:` and
    // `submitted:` rewrites also reach the rendered DOM, not just
    // `sanitizeHtml`'s output. Catches a regression where `Comment.tsx`
    // bypasses `sanitizeHtml` for any branch of HN URL handling.
    it('rewrites HN user links in the rendered DOM', () => {
      const commentWithUserLink = {
        ...mockComment,
        text: '<p>See <a href="https://news.ycombinator.com/user?id=pg">https://news.ycombinator.com/user?id=pg</a></p>',
      };
      const { container } = render(<Comment comment={commentWithUserLink} />);
      const link = container.querySelector('.comment-content a');
      expect(link?.getAttribute('href')).toBe('#/user/pg');
      expect(link?.textContent).toBe('user:pg');
    });

    it('rewrites HN submitted links in the rendered DOM', () => {
      const commentWithSubmittedLink = {
        ...mockComment,
        text: '<p>See <a href="https://news.ycombinator.com/submitted?id=pg">https://news.ycombinator.com/submitted?id=pg</a></p>',
      };
      const { container } = render(<Comment comment={commentWithSubmittedLink} />);
      const link = container.querySelector('.comment-content a');
      expect(link?.getAttribute('href')).toBe('#/submitted/pg');
      expect(link?.textContent).toBe('submitted:pg');
    });
  });

  describe('nested comments', () => {
    it('renders child comments after expanding replies', () => {
      render(<Comment comment={mockCommentWithChildren} />);
      
      expect(screen.getByText('Parent comment')).toBeInTheDocument();
      expect(screen.queryByText('Child comment')).not.toBeInTheDocument();
      
      fireEvent.click(screen.getByText(/1 reply/i));
      
      expect(screen.getByText('Child comment')).toBeInTheDocument();
    });

    it('applies indentation to child comments', () => {
      render(<Comment comment={mockCommentWithChildren} />);
      
      fireEvent.click(screen.getByText(/1 reply/i));
      
      const childComment = screen.getByText('childuser').closest('.tree-branch');
      expect(childComment).not.toBeNull();
    });

    it('collapses replies when trunk line is clicked', () => {
      render(<Comment comment={mockCommentWithChildren} />);
      
      fireEvent.click(screen.getByText(/1 reply/i));
      expect(screen.getByText('Child comment')).toBeInTheDocument();
      
      fireEvent.click(screen.getByRole('button', { name: /collapse replies/i }));
      expect(screen.queryByText('Child comment')).not.toBeInTheDocument();
      expect(screen.getByText(/1 reply/i)).toBeInTheDocument();
    });

    it('gates replies behind expand button at all depths', () => {
      render(<Comment comment={mockCommentWithChildren} />);
      
      expect(screen.getByText('Parent comment')).toBeInTheDocument();
      expect(screen.queryByText('Child comment')).not.toBeInTheDocument();
      expect(screen.getByText(/1 reply/i)).toBeInTheDocument();
      
      fireEvent.click(screen.getByText(/1 reply/i));
      expect(screen.getByText('Child comment')).toBeInTheDocument();
    });

    it('shows direct children count, not total descendants', () => {
      const deepComment = createComment({
        id: 10,
        author: 'topuser',
        text: '<p>Top comment</p>',
        createdAt: Date.now() - 7200000,
        children: [
          createComment({
            id: 11,
            author: 'replyuser',
            text: '<p>Reply</p>',
            createdAt: Date.now() - 3600000,
            children: [
              createComment({
                id: 12,
                author: 'grandchild1',
                text: '<p>Grandchild 1</p>',
                createdAt: Date.now() - 1800000,
              }),
              createComment({
                id: 13,
                author: 'grandchild2',
                text: '<p>Grandchild 2</p>',
                createdAt: Date.now() - 900000,
              }),
            ],
          }),
        ],
      });
      
      render(<Comment comment={deepComment} />);
      
      expect(screen.getByText(/1 reply/i)).toBeInTheDocument();
    });
  });
});

describe('CommentTree', () => {
  const mockComments = [
    createComment({
      id: 1,
      author: 'user1',
      text: '<p>First comment</p>',
      createdAt: Date.now() - 3600000,
    }),
    createComment({
      id: 2,
      author: 'user2',
      text: '<p>Second comment</p>',
      createdAt: Date.now() - 7200000,
    }),
  ];

  it('renders multiple comments', () => {
    render(<CommentTree comments={mockComments} />);
    
    expect(screen.getByText('First comment')).toBeInTheDocument();
    expect(screen.getByText('Second comment')).toBeInTheDocument();
  });

  it('renders empty state for no comments', () => {
    render(<CommentTree comments={[]} />);
    
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
  });

  it('renders empty state for null comments', () => {
    render(<CommentTree comments={null as unknown as CommentType[]} />);
    
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
  });
});
