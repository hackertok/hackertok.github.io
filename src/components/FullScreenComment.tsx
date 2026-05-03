import { useEffect } from 'react';
import { useCommentDetail } from '../hooks/useCommentDetail';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { CommentArticle } from './CommentArticle';
import { CommentSkeletonTree } from './CommentSkeleton';
import { FullScreenChrome } from './FullScreenChrome';
import { PageStage } from './PageStage';
import { StateView } from './StateView';

// Inner content ONLY — the `full-screen-item` + `px-4 py-4` chrome
// MUST be supplied by the consumer (FullScreenComment wraps PageStage
// in it; bare-context callers use `FullScreenCommentSkeletonPanel`).
// Without this split, bare contexts had `px-4` once while PageStage
// renders had it twice, making the bare skeleton render at a
// different width than the post-load skeleton.
//
// Inner content mirrors the real `CommentArticle`: article wrapper
// matches CommentArticle's default chrome; 4 meta-row pills mirror
// `[author, time, parent, thread-title]`; body bars are sized to
// `.comment-content`'s ~23.5px line height; tree count matches the
// loading-branch count.
export function FullScreenCommentSkeleton() {
  return (
    <div className="animate-pulse">
      <article className="mb-4 pb-4 border-b border-border">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 mb-3 min-h-5">
          <div className="h-3.5 bg-skeleton rounded w-20" />
          <div className="h-3.5 bg-skeleton rounded w-16" />
          <div className="h-3.5 bg-skeleton rounded w-12" />
          <div className="h-3.5 bg-skeleton rounded w-40" />
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-skeleton rounded w-full" />
          <div className="h-4 bg-skeleton rounded w-3/4" />
        </div>
      </article>
      <CommentSkeletonTree count={6} />
    </div>
  );
}

// Bare-context wrapper for `FullScreenCommentSkeleton` — see the
// matching `FullScreenItemSkeletonPanel` comment for rationale.
export function FullScreenCommentSkeletonPanel() {
  return (
    <FullScreenChrome>
      <FullScreenCommentSkeleton />
    </FullScreenChrome>
  );
}

interface FullScreenCommentProps {
  commentId: number;
  onAuthorLoaded?: (commentId: number, author: string) => void;
}

export function FullScreenComment({ commentId, onAuthorLoaded }: FullScreenCommentProps) {
  const { comment, replies, itemId, itemTitle, itemAuthor, loading, error, retry } = useCommentDetail(commentId);

  const { isOnline } = useNetworkStatus();
  const { isRetrying } = useAutoRetry({
    error,
    retryFn: retry,
    isOnline,
  });

  useEffect(() => {
    if (comment?.author && onAuthorLoaded) {
      onAuthorLoaded(commentId, comment.author);
    }
  }, [comment?.author, commentId, onAuthorLoaded]);

  if (error && !isRetrying) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <StateView variant="error" title="Failed to load comment" description={error} action={{ label: 'Retry', onClick: retry }} />
      </div>
    );
  }

  if (error && isRetrying) {
    return <FullScreenCommentSkeletonPanel />;
  }

  // CRITICAL `!loading` gate: during cold load `comment` is null but
  // we want PageStage to show the skeleton, not flash deleted-state.
  if (!loading && (!comment || (!comment.author && !comment.text))) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <StateView variant="deleted" />
      </div>
    );
  }

  return (
    <FullScreenChrome>
      {/* `loading={!comment}` for parity with CommentDetail — the
          form keeps refresh-on-same-instance from flashing the
          skeleton during retry. No `triggerWhen` because
          SwipeCommentViewer doesn't priority-gate; offscreen panels
          burn their cascade in the dark (acceptable trade-off). */}
      <PageStage loading={!comment} skeleton={<FullScreenCommentSkeleton />}>
        {comment && (
          <CommentArticle
            comment={comment}
            replies={replies}
            itemId={itemId}
            itemTitle={itemTitle}
            loading={loading}
            storyAuthor={itemAuthor ?? ''}
          />
        )}
      </PageStage>
    </FullScreenChrome>
  );
}
