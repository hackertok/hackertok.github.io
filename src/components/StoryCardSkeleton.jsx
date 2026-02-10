export function StoryCardSkeleton() {
  return (
    <article className="py-3 first:pt-0 animate-pulse">
      <div className="space-y-2">
        {/* Title skeleton - varying widths for natural look */}
        <div className="space-y-1.5">
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-4/5" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-2/5" />
        </div>

        {/* Meta info skeleton */}
        <div className="flex items-center gap-2">
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-16" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-20" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-14" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-18" />
        </div>
      </div>
    </article>
  );
}

export function StoryCardSkeletonList({ count = 10 }) {
  return (
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-800/50">
      {Array.from({ length: count }, (_, i) => (
        <StoryCardSkeleton key={i} />
      ))}
    </div>
  );
}
