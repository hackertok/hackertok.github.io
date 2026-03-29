import { useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useCommentDetail } from '../hooks/useCommentDetail';
import { CommentSkeletonTree } from './CommentSkeleton';
import { CommentArticle } from './CommentArticle';
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
  const { comment, replies, itemId, itemTitle, loading, error } = useCommentDetail(commentId, initialData);
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  // Set isComment in router state so Header shows "comments" indicator
  useEffect(() => {
    if (!locationState?.isComment) {
      void navigate(location.pathname, { replace: true, state: { isComment: true } });
    }
  }, [locationState?.isComment, navigate, location.pathname]);

  useDocumentTitle(comment?.author ? `Comment by ${comment.author}` : undefined);

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-8 text-center">
        <p className="text-destructive mb-4">Failed to load comment: {error}</p>
        <Link to="/" className="text-accent hover:underline">Back to feed</Link>
      </div>
    );
  }

  if (!comment && loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
        <div className="animate-pulse">
          <div className="h-4 bg-skeleton rounded w-48 mb-2" />
          <div className="h-3 bg-skeleton rounded w-64 mb-4" />
          <div className="h-4 bg-skeleton rounded w-full mb-2" />
          <div className="h-4 bg-skeleton rounded w-3/4 mb-6" />
          <CommentSkeletonTree count={6} />
        </div>
      </div>
    );
  }

  if (!comment) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4">
      <CommentArticle
        comment={comment}
        replies={replies}
        itemId={itemId}
        itemTitle={itemTitle}
        loading={loading}
        articleClassName="mb-6"
      />
    </div>
  );
}
