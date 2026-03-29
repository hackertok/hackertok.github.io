interface CommentSkeletonProps {
  lineCount?: number;
  widths?: number[];
}

// Single comment skeleton with randomized content
export function CommentSkeleton({ lineCount = 3, widths = [1, 0.92, 0.75] }: CommentSkeletonProps) {
  return (
    <div className="py-2">
      <div className="flex items-center gap-2 mb-0.5">
        <div className="w-2 h-2 bg-accent/30 rounded-sm" />
        <div className="h-3 bg-skeleton rounded" style={{ width: `${60 + widths[0] * 40}px` }} />
        <div className="h-3 bg-skeleton rounded w-16" />
      </div>

      <div className="ml-[20px] space-y-1.5">
        {Array.from({ length: lineCount }, (_, i) => (
          <div 
            key={i} 
            className="h-3.5 bg-skeleton rounded" 
            style={{ width: `${widths[i % widths.length] * 100}%` }} 
          />
        ))}
      </div>
    </div>
  );
}

// Full comments skeleton tree with realistic structure
interface CommentSkeletonTreeProps {
  count?: number;
}

export function CommentSkeletonTree({ count = 12 }: CommentSkeletonTreeProps) {
  // Create realistic-looking comments with varied length and width
  const comments = [
    { lines: 4, widths: [0.95, 1, 0.88, 0.45] },
    { lines: 2, widths: [0.92, 0.65] },
    { lines: 3, widths: [0.85, 0.78, 0.4] },
    { lines: 1, widths: [0.72] },
    { lines: 5, widths: [1, 0.95, 0.98, 0.82, 0.35] },
    { lines: 3, widths: [0.9, 0.88, 0.55] },
    { lines: 2, widths: [0.85, 0.6] },
    { lines: 4, widths: [1, 0.92, 0.95, 0.7] },
    { lines: 3, widths: [0.88, 0.82, 0.48] },
    { lines: 2, widths: [0.75, 0.52] },
    { lines: 1, widths: [0.68] },
    { lines: 3, widths: [0.95, 0.9, 0.6] },
  ];

  return (
    <div className="space-y-0 animate-pulse">
      {comments.slice(0, count).map((item, i) => (
        <CommentSkeleton 
          key={i} 
          lineCount={item.lines}
          widths={item.widths}
        />
      ))}
    </div>
  );
}

export function ItemDetailSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 lg:px-16 xl:px-24 py-4 animate-pulse">
      {/* Item header skeleton */}
      <article className="mb-6 pb-4 border-b border-border">
        {/* Title */}
        <div className="space-y-2 mb-3">
          <div className="h-5 bg-skeleton rounded w-4/5" />
          <div className="h-5 bg-skeleton rounded w-2/5" />
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-2">
          <div className="h-3 bg-skeleton rounded w-16" />
          <div className="h-3 bg-skeleton rounded w-20" />
          <div className="h-3 bg-skeleton rounded w-14" />
        </div>
      </article>

      {/* Comments section skeleton */}
      <section>
        {/* "X comments" header */}
        <div className="h-4 bg-skeleton rounded w-24 mb-3" />
        <CommentSkeletonTree count={12} />
      </section>
    </div>
  );
}
