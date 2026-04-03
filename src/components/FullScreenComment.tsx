import { useEffect } from 'react';
import { useCommentDetail } from '../hooks/useCommentDetail';
import { CommentArticle } from './CommentArticle';
import { CommentSkeletonTree } from './CommentSkeleton';

export function FullScreenCommentSkeleton() {
  return (
    <div className="animate-pulse px-4 py-4 min-h-screen">
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
  const { comment, replies, itemId, itemTitle, loading, error } = useCommentDetail(commentId);

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

  if (error) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <div className="text-center px-4">
          <p className="text-destructive mb-4">Failed to load comment</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // Dead/deleted comment
  if (!comment || (!comment.author && !comment.text)) {
    return (
      <div className="full-screen-item flex items-center justify-center min-h-[50vh]">
        <p className="text-muted-foreground">Comment deleted</p>
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
