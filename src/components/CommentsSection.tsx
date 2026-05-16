import { CommentTree, CommentSkeletonTree } from '../components';
import { StateView } from './StateView';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import type { Comment } from '../types';

interface CommentsSectionProps {
  comments: Comment[] | null;
  commentsError: string | null;
  onRetry: () => void | Promise<void>;
  /**
   * Forwarded to CommentTree so OP detection works in nested replies.
   * Defaults to `''`; the OP guard short-circuits on empty/unknown.
   */
  storyAuthor?: string;
}

/**
 * Comments rail under a story page (ItemDetail / FullScreenItem).
 *
 * The initial-load skeleton is owned by the parent PageStage now;
 * error / retry paths still render their own inline skeletons because
 * those fire AFTER PageStage has already transitioned to `'done'`.
 */
export function CommentsSection({ comments, commentsError, onRetry, storyAuthor = '' }: CommentsSectionProps) {
  const { isOnline } = useNetworkStatus();
  const { isRetrying } = useAutoRetry({
    error: commentsError,
    retryFn: onRetry,
    isOnline,
  });

  if (commentsError && !comments?.length && !isRetrying) {
    return <StateView variant="error" compact description="Failed to load comments" action={{ label: 'Retry', onClick: () => void onRetry()?.catch(() => { /* error state set internally */ }) }} />;
  }
  if (commentsError && !comments?.length && isRetrying) {
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
