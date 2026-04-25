import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatTimeAgo, formatAbsoluteTime, safeISOString } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { StateView } from './StateView';
import type { Comment as CommentType } from '../types';

interface CommentProps {
  comment: CommentType;
}

export function Comment({ comment }: CommentProps) {
  const [repliesExpanded, setRepliesExpanded] = useState(false);

  const sanitizedText = useMemo(
    () => comment.text ? sanitizeHtml(comment.text) : '',
    [comment.text]
  );

  const hasChildren = comment.children && comment.children.length > 0;

  const contentBlock = sanitizedText ? (
    <div
      className="comment-content text-foreground text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: sanitizedText }}
    />
  ) : null;

  return (
    <div className="py-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-0.5">
        <span className="text-accent/80 text-base leading-none">›</span>
        <Link
          to={`/user/${comment.author}`}
          className="font-medium text-foreground hover:text-accent transition-colors"
        >
          {comment.author}
        </Link>
        <span className="text-muted-foreground">·</span>
        <time dateTime={safeISOString(comment.createdAt)} title={formatAbsoluteTime(comment.createdAt)}>{formatTimeAgo(comment.createdAt)}</time>
      </div>

      {hasChildren ? (
        <div className="tree-trunk">
          {repliesExpanded && (
            <button
              className="tree-trunk-collapse"
              onClick={() => setRepliesExpanded(false)}
              aria-expanded={true}
              aria-label="Collapse replies"
            />
          )}

          {contentBlock}

          {!repliesExpanded && (
            <div className="tree-branch tree-branch--last pt-2">
              <button
                onClick={() => setRepliesExpanded(true)}
                className="text-sm text-muted-foreground hover:text-accent"
                aria-expanded={false}
              >
                <span className="inline-block rotate-90 text-accent/80 text-base" aria-hidden="true">›</span>{' '}
                {comment.children.length} {comment.children.length === 1 ? 'reply' : 'replies'}
              </button>
            </div>
          )}

          {repliesExpanded && comment.children.map((child, i) => (
            <div
              key={child.id}
              className={`tree-branch${i === comment.children.length - 1 ? ' tree-branch--last' : ''}`}
            >
              <Comment comment={child} />
            </div>
          ))}
        </div>
      ) : contentBlock ? (
        <div className="ml-[20px] pt-2">{contentBlock}</div>
      ) : null}
    </div>
  );
}

interface CommentTreeProps {
  comments: CommentType[];
}

export function CommentTree({ comments }: CommentTreeProps) {
  if (!comments || comments.length === 0) {
    return <StateView variant="empty" compact title="No comments yet." />;
  }

  return (
    <div className="space-y-0">
      {comments.map(comment => (
        <Comment key={comment.id} comment={comment} />
      ))}
    </div>
  );
}
