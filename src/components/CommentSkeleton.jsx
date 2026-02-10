export function CommentSkeleton({ depth = 0 }) {
  return (
    <div className={`${depth > 0 ? 'border-l border-gray-200 dark:border-gray-800 pl-3 ml-2' : ''} animate-pulse`}>
      <div className="py-2">
        {/* Comment header skeleton */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-3.5 h-3.5 bg-gray-200 dark:bg-gray-800 rounded" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-20" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-16" />
        </div>

        {/* Comment body skeleton - 2-4 lines */}
        <div className="space-y-1.5">
          <div className="h-3.5 bg-gray-200 dark:bg-gray-800 rounded w-full" />
          <div className="h-3.5 bg-gray-200 dark:bg-gray-800 rounded w-11/12" />
          <div className="h-3.5 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
        </div>
      </div>
    </div>
  );
}

export function CommentSkeletonTree({ count = 8 }) {
  // Create a realistic-looking tree with some nested comments
  const structure = [
    { depth: 0 },
    { depth: 1 },
    { depth: 2 },
    { depth: 0 },
    { depth: 1 },
    { depth: 0 },
    { depth: 1 },
    { depth: 1 },
  ];

  return (
    <div className="space-y-0">
      {structure.slice(0, count).map((item, i) => (
        <CommentSkeleton key={i} depth={item.depth} />
      ))}
    </div>
  );
}

export function StoryDetailSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4 animate-pulse">
      {/* Story header skeleton */}
      <article className="mb-6 pb-4 border-b border-gray-100 dark:border-gray-800">
        {/* Title */}
        <div className="space-y-2 mb-3">
          <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-4/5" />
          <div className="h-5 bg-gray-200 dark:bg-gray-800 rounded w-2/5" />
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-2">
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-16" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-20" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-14" />
        </div>
      </article>

      {/* Comments section skeleton */}
      <section>
        {/* "X comments" header */}
        <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-24 mb-3" />
        <CommentSkeletonTree count={8} />
      </section>
    </div>
  );
}
