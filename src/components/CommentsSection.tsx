import { useState } from 'react';
import { CommentTree, CommentSkeletonTree } from '../components';
import { StateView } from './StateView';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import type { Comment } from '../types';

interface CommentsSectionProps {
  comments: Comment[] | null;
  commentsError: string | null;
  /** Refetch the comments only. `commentsError` stays set until it settles. */
  onRetry: () => void | Promise<void>;
  /** Story author for OP detection. */
  storyAuthor?: string;
}

/** Comments section below a story. Error/retry has its own skeletons. */
export function CommentsSection({ comments, commentsError, onRetry, storyAuthor = '' }: CommentsSectionProps) {
  const { isOnline } = useNetworkStatus();
  const { isRetrying } = useAutoRetry({
    error: commentsError,
    retryFn: onRetry,
    isOnline,
  });
  const [isManualRetrying, setIsManualRetrying] = useState(false);

  const retryNow = () => {
    setIsManualRetrying(true);
    void Promise.resolve(onRetry())
      .catch(() => { /* error state set internally */ })
      .finally(() => setIsManualRetrying(false));
  };

  if (commentsError && !comments?.length && !isRetrying && !isManualRetrying) {
    return <StateView variant="error" compact description="Failed to load comments" action={{ label: 'Retry', onClick: retryNow }} />;
  }
  if (commentsError && !comments?.length) {
    return <CommentSkeletonTree count={6} />;
  }
  // startIdx=1 reserves slot 0 for the `.story-stage-leader` header
  // animation that fires alongside the cascade.
  return (
    <div className="comments-real">
      <CommentTree comments={comments ?? []} storyAuthor={storyAuthor} startIdx={1} />
    </div>
  );
}
