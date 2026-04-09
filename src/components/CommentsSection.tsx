import { CommentTree, CommentSkeletonTree } from '../components';
import { StateView } from './StateView';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import type { Comment } from '../types';

interface CommentsSectionProps {
  comments: Comment[] | null;
  commentsLoading: boolean;
  commentsError: string | null;
  onRetry: () => void;
}

export function CommentsSection({ comments, commentsLoading, commentsError, onRetry }: CommentsSectionProps) {
  const { isOnline } = useNetworkStatus();
  const { isRetrying } = useAutoRetry({
    error: commentsError,
    retryFn: onRetry,
    isOnline,
  });

  if (commentsLoading && !comments) {
    return <CommentSkeletonTree count={12} />;
  }
  if (commentsError && !comments?.length && !isRetrying) {
    return <StateView variant="error" compact description="Failed to load comments" action={{ label: 'Retry', onClick: onRetry }} />;
  }
  if (commentsError && !comments?.length && isRetrying) {
    return <CommentSkeletonTree count={6} />;
  }
  return <CommentTree comments={comments ?? []} />;
}
