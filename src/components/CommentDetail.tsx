import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCommentDetail } from '../hooks/useCommentDetail';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { CommentSkeletonTree } from './CommentSkeleton';
import { CommentArticle } from './CommentArticle';
import { PageStage } from './PageStage';
import { StateView } from './StateView';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import type { LocationState } from '../types';

interface CommentDetailProps {
  commentId: number | string;
  initialData?: {
    author: string;
    text: string;
    createdAt: number;
    parentId?: number;
  };
}

/** Skeleton matching CommentArticle's shape. Chrome stays with the parent. */
export function CommentDetailSkeleton() {
  return (
    <div className="animate-pulse">
      <article className="mb-6 pb-4 border-b border-border">
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

export function CommentDetail({ commentId, initialData }: CommentDetailProps) {
  const { comment, replies, itemId, itemTitle, itemAuthor, loading, error, retry } = useCommentDetail(commentId, initialData);
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  const { isOnline } = useNetworkStatus();
  const { isRetrying } = useAutoRetry({
    error,
    retryFn: retry,
    isOnline,
  });

  // Set isComment in router state so Header shows the "comments" indicator.
  useEffect(() => {
    if (!locationState?.isComment) {
      void navigate(location.pathname, { replace: true, state: { isComment: true } });
    }
  }, [locationState?.isComment, navigate, location.pathname]);

  useDocumentTitle(comment?.author ? `Comment by ${comment.author}` : undefined);

  if (error && !isRetrying) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="error"
          title="Failed to load comment"
          description={error}
          action={{ label: 'Retry', onClick: () => void retry().catch(() => { /* error state set internally */ }) }}
        />
      </div>
    );
  }

  // Retry-in-progress skeleton (avoids error UI flash between attempts).
  if (error && isRetrying) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
        <CommentDetailSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      {/* `loading={!comment}` (not raw `loading`): when initialData
          seeds `comment` on first render, PageStage starts in
          'transitioning' so progressive rendering shows the seeded
          byline + text without a skeleton flash. Cold load (no
          initialData) still skeletons normally. */}
      <PageStage loading={!comment} skeleton={<CommentDetailSkeleton />}>
        {comment && (
          <CommentArticle
            comment={comment}
            replies={replies}
            itemId={itemId}
            itemTitle={itemTitle}
            loading={loading}
            articleClassName="mb-6"
            storyAuthor={itemAuthor ?? ''}
          />
        )}
      </PageStage>
    </div>
  );
}
