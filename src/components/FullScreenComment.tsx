import { useEffect } from 'react';
import { useCommentDetail } from '../hooks/useCommentDetail';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { CommentArticle } from './CommentArticle';
import { CommentSkeletonTree } from './CommentSkeleton';
import { StateView } from './StateView';

export function FullScreenCommentSkeleton() {
  return (
    <div className="animate-pulse px-4 py-4 min-h-full">
      <div className="h-4 bg-skeleton rounded w-48 mb-2" />
      <div className="h-3 bg-skeleton rounded w-64 mb-4" />
      <div className="h-4 bg-skeleton rounded w-full mb-2" />
      <div className="h-4 bg-skeleton rounded w-3/4 mb-6" />
      <CommentSkeletonTree count={6} />
    </div>
  );
}

interface FullScreenCommentProps {
  commentId: number;
  onAuthorLoaded?: (commentId: number, author: string) => void;
}

export function FullScreenComment({ commentId, onAuthorLoaded }: FullScreenCommentProps) {
  const { comment, replies, itemId, itemTitle, loading, error, retry } = useCommentDetail(commentId);

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

  if (loading && !comment) {
    return (
      <div className="full-screen-item">
        <FullScreenCommentSkeleton />
      </div>
    );
  }

  if (error && !isRetrying) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <StateView variant="error" title="Failed to load comment" description={error} action={{ label: 'Retry', onClick: retry }} />
      </div>
    );
  }

  if (error && isRetrying) {
    return (
      <div className="full-screen-item">
        <FullScreenCommentSkeleton />
      </div>
    );
  }

  if (!comment || (!comment.author && !comment.text)) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <StateView variant="deleted" />
      </div>
    );
  }

  return (
    <div className="full-screen-item">
      <div className="px-4 py-4">
        <CommentArticle
          comment={comment}
          replies={replies}
          itemId={itemId}
          itemTitle={itemTitle}
          loading={loading}
        />
      </div>
    </div>
  );
}
