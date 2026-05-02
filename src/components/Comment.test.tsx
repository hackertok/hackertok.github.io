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

    // Author guard: the literal HN `'unknown'` placeholder (seen on
    // degraded Algolia payloads) and any empty-string fallback that slips
    // through `?? ''` upstream both render as a plain span (NOT a link),
    // with the visible label "unknown" so the `›` byline marker doesn't
    // sit alone. See `isKnownAuthor` for the centralised guard rule.
    it.each([
      { label: 'literal "unknown"', author: 'unknown', id: 100 },
      { label: 'empty string', author: '', id: 101 },
    ])(
      'does not render an author link when the author is the $label',
      ({ author, id }) => {
        const guardedComment = createComment({
          id,
          author,
          text: '<p>Anonymous comment</p>',
          createdAt: Date.now() - 3600000,
        });
        render(<Comment comment={guardedComment} />);

        expect(
          screen.queryByRole('link', { name: 'unknown' }),
        ).not.toBeInTheDocument();
        expect(screen.getByText('unknown')).toBeInTheDocument();
      },
    );

    // Integration smoke test for the sanitize → dangerouslySetInnerHTML path.
    // The unit suite in `utils/sanitize.test.ts` covers `sanitizeHtml`'s
    // output exhaustively; these `it.each` assertions just pin that each
    // recognised HN URL family actually reaches the rendered DOM via
    // `Comment.tsx` (and isn't bypassed by a future refactor that, say,
    // routes around the rewriter for one branch).
    it.each([
      { kind: 'item', sourcePath: 'item?id=99999', expectedHref: '#/item/99999', expectedText: 'item:99999' },
      { kind: 'user', sourcePath: 'user?id=pg', expectedHref: '#/user/pg', expectedText: 'user:pg' },
      { kind: 'submitted', sourcePath: 'submitted?id=pg', expectedHref: '#/submitted/pg', expectedText: 'submitted:pg' },
    ])(
      'rewrites HN $kind links in the rendered DOM',
      ({ sourcePath, expectedHref, expectedText }) => {
        const sourceUrl = `https://news.ycombinator.com/${sourcePath}`;
        const commentWithHnLink = {
          ...mockComment,
          text: `<p>See <a href="${sourceUrl}">${sourceUrl}</a></p>`,
        };
        const { container } = render(<Comment comment={commentWithHnLink} />);
        const link = container.querySelector('.comment-content a');
        expect(link?.getAttribute('href')).toBe(expectedHref);
        expect(link?.textContent).toBe(expectedText);
      },
    );
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
