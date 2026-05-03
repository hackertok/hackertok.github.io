import { useState, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { isKnownAuthor } from '../api/hn';
import { sanitizeHtml } from '../utils/sanitize';
import { OpWrap } from './AuthorByline';
import { StateView } from './StateView';
import { RelativeTime } from './RelativeTime';
import { decayDelay } from '../lib/staggerDelay';
import { metaPillClass } from '../lib/classes';
import type { Comment as CommentType } from '../types';

interface CommentProps {
  comment: CommentType;
  /**
   * Author handle of the surrounding story. Forwarded recursively to
   * children so deeply-nested replies from the OP also light up; the
   * OP badge fires when `storyAuthor === comment.author` (with an
   * `isKnownAuthor` guard so empty/'unknown' authors don't decorate).
   */
  storyAuthor?: string;
  /**
   * 0-indexed slot position in the entry cascade. CSS scope
   * (`.page-stage.play-real`) gates the actual animation to the
   * initial cascade window only.
   */
  stageIdx?: number;
}

export function Comment({ comment, storyAuthor = '', stageIdx }: CommentProps) {
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

  const isOp = isKnownAuthor(storyAuthor) && comment.author === storyAuthor;

  // Top-level comments inside a tree get a cascade slot; nested
  // children fade in together via `.reply-fade` on their
  // `.tree-branch` wrappers when the user expands a thread (no
  // stagger — reply expansion is a deliberate user-initiated reveal).
  const wrapperClass = stageIdx !== undefined ? 'py-2 comment-row stagger-fade' : 'py-2 comment-row';
  const wrapperStyle: CSSProperties | undefined =
    stageIdx !== undefined
      ? ({ '--stagger-delay': `${decayDelay(stageIdx)}ms` } as CSSProperties)
      : undefined;

  return (
    <div className={wrapperClass} style={wrapperStyle} id={`comment-${comment.id}`}>
      {/* Compact `›` + author + time byline — the unified lucide meta
          row is reserved for the focal comment in CommentArticle. Here
          in the threaded list the tree-trunk graphical structure
          already conveys parent location, so a denser row would only
          add noise. */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-0.5 comment-byline">
        <span className="text-accent/80 text-base leading-none">›</span>
        {/* OP variant: `OpWrap` (shared with AuthorByline) places the
            badge as a SIBLING of the Link so the handle's accessible
            name stays clean, and the `gap-1.5` spacing is identical
            across compact and focal bylines. */}
        {isOp ? (
          <OpWrap>
            {/* `isOp` requires `comment.author === storyAuthor` AND
                `isKnownAuthor(storyAuthor)`, so `comment.author` is
                guaranteed known here — no unknown fallback needed. */}
            <Link
              to={`/user/${comment.author}`}
              className="font-semibold text-foreground hover:text-accent transition-colors"
            >
              {comment.author}
            </Link>
          </OpWrap>
        ) : isKnownAuthor(comment.author) ? (
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
        {/* Time IS the permalink (HN convention). `state.isComment:
            true` lets MobileItemDetailWrapper short-circuit straight
            to SwipeCommentViewer without a resolver round-trip. */}
        <Link
          to={`/item/${comment.id}`}
          state={{ isComment: true }}
          className={metaPillClass}
        >
          <RelativeTime timestamp={comment.createdAt} />
        </Link>
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
              {/* Replies expander pill. Negative-margin -mx-2 -my-1
                  cancels the padding for layout (so the tree-branch
                  connector still meets the button at the same
                  position) while letting the hover backdrop extend
                  beyond the text bounds. */}
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

          {/* Children re-mount on every expand (React's conditional
              render); the `.reply-fade` fade animation re-fires each
              time. The .tree-branch wrapper itself stays opaque so
              its `::before` connector and `--last::after` trunk-end
              mask render at full opacity from frame 0 — see the
              comment on `.reply-fade > *` in src/index.css. */}
          {repliesExpanded && comment.children.map((child, i) => (
            <div
              key={child.id}
              className={`tree-branch${i === comment.children.length - 1 ? ' tree-branch--last' : ''} reply-fade`}
            >
              <Comment comment={child} storyAuthor={storyAuthor} />
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
  storyAuthor?: string;
  /**
   * Slot offset for the cascade. CommentsSection passes `1` (slot 0
   * is the story-header leader); CommentArticle inherits `0` so the
   * focal article doesn't burn slots already owned by the page cascade.
   */
  startIdx?: number;
}

export function CommentTree({ comments, storyAuthor = '', startIdx = 0 }: CommentTreeProps) {
  if (!comments || comments.length === 0) {
    return <StateView variant="empty" compact title="No comments yet." />;
  }

  return (
    <div className="space-y-0">
      {comments.map((comment, i) => (
        <Comment
          key={comment.id}
          comment={comment}
          storyAuthor={storyAuthor}
          stageIdx={startIdx + i}
        />
      ))}
    </div>
  );
}
