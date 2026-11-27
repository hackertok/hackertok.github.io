import { useEffect } from 'react';
import { useCommentDetail } from '../hooks/useCommentDetail';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { CommentArticle } from './CommentArticle';
import { CommentArticleSkeleton } from './CommentSkeleton';
import { FullScreenChrome } from './FullScreenChrome';
import { PageStage } from './PageStage';
import { StateView } from './StateView';

// Bare-context wrapper — supplies chrome around skeleton.
export function FullScreenCommentSkeletonPanel() {
  return (
    <FullScreenChrome>
      <CommentArticleSkeleton />
    </FullScreenChrome>
  );
}

interface FullScreenCommentProps {
  commentId: number;
  onAuthorLoaded?: (commentId: number, author: string) => void;
}

export function FullScreenComment({ commentId, onAuthorLoaded }: FullScreenCommentProps) {
  const { comment, replies, moreRepliesLoading, itemId, itemTitle, itemTitleLoading, itemAuthor, loading, error, retry } = useCommentDetail(commentId);

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
      <div className="full-screen-state">
        <StateView variant="error" title="Failed to load comment" description={error} action={{ label: 'Retry', onClick: () => void retry().catch(() => { /* error state set internally */ }) }} />
      </div>
    );
  }

  if (error && isRetrying) {
    return <FullScreenCommentSkeletonPanel />;
  }

  // CRITICAL `!loading` gate: during cold load `comment` is null but
  // we want PageStage to show the skeleton, not flash deleted-state.
  // A deleted comment with replies still shows them, under a [deleted] byline.
  const isDeletedLeaf = !!comment && !comment.author && !comment.text && replies.length === 0 && !moreRepliesLoading;
  if (!loading && (!comment || isDeletedLeaf)) {
    return (
      <div className="full-screen-state">
        <StateView variant="deleted" />
      </div>
    );
  }

  return (
    <FullScreenChrome>
      {/* loading={!comment} prevents skeleton flash on retry.
          No triggerWhen — offscreen cascade ok. */}
      <PageStage loading={!comment} skeleton={<CommentArticleSkeleton />}>
        {comment && (
          <CommentArticle
            comment={comment}
            replies={replies}
            itemId={itemId}
            itemTitle={itemTitle}
            itemTitleLoading={itemTitleLoading}
            loading={loading}
            moreRepliesLoading={moreRepliesLoading}
            storyAuthor={itemAuthor ?? ''}
          />
        )}
      </PageStage>
    </FullScreenChrome>
  );
}
