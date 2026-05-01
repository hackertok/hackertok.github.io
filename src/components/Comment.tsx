import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { isKnownAuthor } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { StateView } from './StateView';
import { RelativeTime } from './RelativeTime';
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
      {/* Compact byline for nested replies — intentionally keeps the lightweight
          `›` + author + time pattern. The unified lucide meta row (`User`,
          `Clock`, optional parent, optional thread) is reserved for the focal
          comment in `CommentArticle` (permalink / fullscreen views), where
          parent/thread context isn't implicit; here in the threaded list, the
          `tree-trunk` / `tree-branch` graphical structure already conveys
          parent location, so a denser meta row would just add noise. */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-0.5">
        <span className="text-accent/80 text-base leading-none">›</span>
        {/* Author guard mirrors StoryCard / CommentArticle — see
            isKnownAuthor for the empty-string + literal `'unknown'`
            rationale. Falls back to a plain span so the byline still
            renders (so the `›` marker doesn't sit alone) without minting
            a dead `/user/` or `/user/unknown` link. */}
        {isKnownAuthor(comment.author) ? (
          <Link
            to={`/user/${comment.author}`}
            className="font-medium text-foreground hover:text-accent transition-colors"
          >
            {comment.author}
          </Link>
        ) : (
          <span className="font-medium text-foreground">
            {comment.author || 'unknown'}
          </span>
        )}
        <span className="text-muted-foreground">·</span>
        <RelativeTime timestamp={comment.createdAt} />
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
              {/* Replies expander: small pill button matching the nav-pill
                  hover pattern. The orange rotated `›` chevron is kept as
                  the leading glyph (a deliberate accent flourish that
                  visually rhymes with the `›` author marker on each
                  comment byline). The chevron has its own `text-accent/80`
                  so it stays orange on hover while the rest of the label
                  text shifts to `text-foreground` from the parent's
                  `hover:text-foreground`. The negative-margin `-mx-2 -my-1`
                  cancels the padding for layout (so the tree-branch
                  connector still meets the button at the same position)
                  while letting the hover backdrop extend beyond the text
                  bounds. */}
              <button
                onClick={() => setRepliesExpanded(true)}
                className="inline-flex items-center gap-1.5 px-2 py-1 -mx-2 -my-1 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-expanded={false}
              >
                <span className="inline-block rotate-90 text-accent/80 text-base leading-none" aria-hidden="true">›</span>
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
