interface CommentSkeletonProps {
  depth?: number;
  lineCount?: number;
  widths?: number[];
}

// Single comment skeleton with randomized content
export function CommentSkeleton({ depth = 0, lineCount = 3, widths = [1, 0.92, 0.75] }: CommentSkeletonProps) {
  return (
    <div className={`${depth > 0 ? 'border-l border-gray-200 dark:border-gray-800 pl-3 ml-2' : ''}`}>
      <div className="py-2">
        {/* Comment header skeleton */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-3.5 h-3.5 bg-gray-200 dark:bg-gray-800 rounded" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded" style={{ width: `${60 + widths[0] * 40}px` }} />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-16" />
        </div>

        {/* Comment body skeleton - variable lines */}
        <div className="space-y-1.5">
          {Array.from({ length: lineCount }, (_, i) => (
            <div 
              key={i} 
              className="h-3.5 bg-gray-200 dark:bg-gray-800 rounded" 
              style={{ width: `${widths[i % widths.length] * 100}%` }} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Full comments skeleton tree with realistic structure
interface CommentSkeletonTreeProps {
  count?: number;
}

export function CommentSkeletonTree({ count = 12 }: CommentSkeletonTreeProps) {
  // Create realistic-looking comments with varied depth, length, and width
  const comments = [
    { depth: 0, lines: 4, widths: [0.95, 1, 0.88, 0.45] },
    { depth: 1, lines: 2, widths: [0.92, 0.65] },
    { depth: 2, lines: 3, widths: [0.85, 0.78, 0.4] },
    { depth: 2, lines: 1, widths: [0.72] },
    { depth: 1, lines: 5, widths: [1, 0.95, 0.98, 0.82, 0.35] },
    { depth: 0, lines: 3, widths: [0.9, 0.88, 0.55] },
    { depth: 1, lines: 2, widths: [0.85, 0.6] },
    { depth: 0, lines: 4, widths: [1, 0.92, 0.95, 0.7] },
    { depth: 1, lines: 3, widths: [0.88, 0.82, 0.48] },
    { depth: 2, lines: 2, widths: [0.75, 0.52] },
    { depth: 1, lines: 1, widths: [0.68] },
    { depth: 0, lines: 3, widths: [0.95, 0.9, 0.6] },
  ];

  return (
    <div className="space-y-0 animate-pulse">
      {comments.slice(0, count).map((item, i) => (
        <CommentSkeleton 
          key={i} 
          depth={item.depth} 
          lineCount={item.lines}
          widths={item.widths}
        />
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
        <CommentSkeletonTree count={12} />
      </section>
    </div>
  );
}
