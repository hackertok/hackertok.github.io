import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { render } from '../test/test-utils';
import { Comment, CommentTree } from './Comment';

describe('Comment', () => {
  const mockComment = {
    id: 1,
    author: 'testuser',
    text: '<p>This is a test comment</p>',
    createdAt: Date.now() - 3600000, // 1 hour ago
    children: [],
    childrenCollapsed: false,
    hiddenChildCount: 0,
  };

  const mockCommentWithChildren = {
    id: 2,
    author: 'parentuser',
    text: '<p>Parent comment</p>',
    createdAt: Date.now() - 7200000,
    children: [
      {
        id: 3,
        author: 'childuser',
        text: '<p>Child comment</p>',
        createdAt: Date.now() - 3600000,
        children: [],
        childrenCollapsed: false,
        hiddenChildCount: 0,
      },
    ],
    childrenCollapsed: false,
    hiddenChildCount: 0,
  };

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
  });

  describe('collapsing', () => {
    it('renders collapse/expand button', () => {
      render(<Comment comment={mockComment} />);
      
      expect(screen.getByLabelText(/collapse comment/i)).toBeInTheDocument();
    });

    it('hides content when collapsed', () => {
      render(<Comment comment={mockComment} />);
      
      const collapseButton = screen.getByLabelText(/collapse comment/i);
      fireEvent.click(collapseButton);
      
      expect(screen.queryByText('This is a test comment')).not.toBeInTheDocument();
    });

    it('shows content when expanded again', () => {
      render(<Comment comment={mockComment} />);
      
      const button = screen.getByLabelText(/collapse comment/i);
      fireEvent.click(button); // Collapse
      fireEvent.click(button); // Expand
      
      expect(screen.getByText('This is a test comment')).toBeInTheDocument();
    });

    it('shows reply count when collapsed', () => {
      render(<Comment comment={mockCommentWithChildren} />);
      
      // Get the first (parent) collapse button
      const collapseButtons = screen.getAllByLabelText(/collapse comment/i);
      fireEvent.click(collapseButtons[0]);
      
      expect(screen.getByText(/1 reply/i)).toBeInTheDocument();
    });
  });

  describe('nested comments', () => {
    it('renders child comments', () => {
      render(<Comment comment={mockCommentWithChildren} />);
      
      expect(screen.getByText('Parent comment')).toBeInTheDocument();
      expect(screen.getByText('Child comment')).toBeInTheDocument();
    });

    it('applies indentation to child comments', () => {
      render(<Comment comment={mockCommentWithChildren} depth={0} />);
      
      // Child should have border-left class
      const childComment = screen.getByText('Child comment').closest('div');
      expect(childComment.parentElement.parentElement).toHaveClass('border-l');
    });
  });

  describe('deep collapsed threads', () => {
    it('shows load more button for collapsed children', () => {
      const collapsedComment = {
        ...mockCommentWithChildren,
        childrenCollapsed: true,
        hiddenChildCount: 3,
      };
      
      render(<Comment comment={collapsedComment} />);
      
      expect(screen.getByText(/load 3 more replies/i)).toBeInTheDocument();
    });

    it('expands children when load more is clicked', () => {
      const collapsedComment = {
        ...mockCommentWithChildren,
        childrenCollapsed: true,
        hiddenChildCount: 1,
      };
      
      render(<Comment comment={collapsedComment} />);
      
      // Child should not be visible initially
      expect(screen.queryByText('Child comment')).not.toBeInTheDocument();
      
      fireEvent.click(screen.getByText(/load 1 more reply/i));
      
      // Child should now be visible
      expect(screen.getByText('Child comment')).toBeInTheDocument();
    });
  });
});

describe('CommentTree', () => {
  const mockComments = [
    {
      id: 1,
      author: 'user1',
      text: '<p>First comment</p>',
      createdAt: Date.now() - 3600000,
      children: [],
      childrenCollapsed: false,
      hiddenChildCount: 0,
    },
    {
      id: 2,
      author: 'user2',
      text: '<p>Second comment</p>',
      createdAt: Date.now() - 7200000,
      children: [],
      childrenCollapsed: false,
      hiddenChildCount: 0,
    },
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
    render(<CommentTree comments={null} />);
    
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
  });
});
