import { useState, useMemo } from 'react';
import { formatTimeAgo } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import type { Comment as CommentType } from '../types';

interface CommentProps {
  comment: CommentType;
  depth?: number;
}

export function Comment({ comment, depth = 0 }: CommentProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Track if deep children have been expanded (when initially collapsed by tree builder)
  const [deepChildrenExpanded, setDeepChildrenExpanded] = useState(
    !comment.childrenCollapsed
  );
  
  const sanitizedText = useMemo(
    () => comment.text ? sanitizeHtml(comment.text) : '',
    [comment.text]
  );

  const hasChildren = comment.children && comment.children.length > 0;
  const showLoadMore = hasChildren && comment.childrenCollapsed && !deepChildrenExpanded;

  return (
    <div
      className={`${depth > 0 ? 'border-l border-border pl-3 ml-2' : ''}`}
    >
      <div className="py-2">
        {/* Comment header */}
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground mb-1.5">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hover:text-accent transition-colors flex items-center"
            aria-label={collapsed ? 'Expand comment' : 'Collapse comment'}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <span className="font-medium text-foreground">{comment.author}</span>
          <span className="text-muted-foreground">·</span>
          <span>{formatTimeAgo(comment.createdAt)}</span>
          {collapsed && hasChildren && (
            <span className="text-muted-foreground">
              ({/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 0 should fall through to children.length */}
              {comment.hiddenChildCount || comment.children.length} {(comment.hiddenChildCount || comment.children.length) === 1 ? 'reply' : 'replies'})
            </span>
          )}
        </div>

        {/* Comment content */}
        {!collapsed && (
          <>
            {sanitizedText && (
              <div
                className="comment-content text-foreground text-[14px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitizedText }}
              />
            )}

            {/* Show "load more" button for deep collapsed threads */}
            {showLoadMore && (
              <button
                onClick={() => setDeepChildrenExpanded(true)}
                className="mt-2 text-[13px] text-accent hover:underline flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 0 should fall through to children.length */}
                Load {comment.hiddenChildCount || comment.children.length} more {(comment.hiddenChildCount || comment.children.length) === 1 ? 'reply' : 'replies'}
              </button>
            )}

            {/* Child comments - only render if not collapsed by depth limit OR user expanded them */}
            {hasChildren && (!comment.childrenCollapsed || deepChildrenExpanded) && (
              <div className="mt-2">
                {comment.children.map(child => (
                  <Comment key={child.id} comment={child} depth={depth + 1} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface CommentTreeProps {
  comments: CommentType[];
}

export function CommentTree({ comments }: CommentTreeProps) {
  if (!comments || comments.length === 0) {
    return (
      <p className="text-muted-foreground text-sm py-4">No comments yet.</p>
    );
  }

  return (
    <div className="space-y-0">
      {comments.map(comment => (
        <Comment key={comment.id} comment={comment} depth={0} />
      ))}
    </div>
  );
}
