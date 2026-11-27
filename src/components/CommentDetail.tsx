import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useCommentDetail } from '../hooks/useCommentDetail';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useAutoRetry } from '../hooks/useAutoRetry';
import { CommentArticleSkeleton } from './CommentSkeleton';
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

export function CommentDetail({ commentId, initialData }: CommentDetailProps) {
  const { comment, replies, moreRepliesLoading, itemId, itemTitle, itemTitleLoading, itemAuthor, loading, error, retry } = useCommentDetail(commentId, initialData);
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

  const retryNow = () => void retry().catch(() => { /* error state set internally */ });

  // A comment seeded from initialData stays on screen; only its replies fail.
  if (error && !comment && !isRetrying) {
    return (
      <div className="page-state-center-padded">
        <StateView
          variant="error"
          title="Failed to load comment"
          description={error}
          action={{ label: 'Retry', onClick: retryNow }}
        />
      </div>
    );
  }

  // Retry-in-progress skeleton (avoids error UI flash between attempts).
  if (error && !comment) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
        <CommentArticleSkeleton articleClassName="mb-6" />
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
      <PageStage loading={!comment} skeleton={<CommentArticleSkeleton articleClassName="mb-6" />}>
        {comment && (
          <CommentArticle
            comment={comment}
            replies={replies}
            itemId={itemId}
            itemTitle={itemTitle}
            itemTitleLoading={itemTitleLoading}
            loading={loading || (!!error && isRetrying)}
            moreRepliesLoading={moreRepliesLoading}
            onRetryReplies={error && !isRetrying ? retryNow : undefined}
            articleClassName="mb-6"
            storyAuthor={itemAuthor ?? ''}
          />
        )}
      </PageStage>
    </div>
  );
}
