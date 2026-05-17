interface CommentSkeletonProps {
  lineCount?: number;
  widths?: number[];
}

// Heights ≤ real Comment to prevent PageStage contraction on swap.
export function CommentSkeleton({ lineCount = 3, widths = [1, 0.92, 0.75] }: CommentSkeletonProps) {
  return (
    <div className="py-2">
      <div className="flex items-center gap-2 mb-0.5 min-h-5">
        <div className="w-2 h-2 bg-accent/30 rounded-sm" />
        <div className="h-3.5 bg-skeleton rounded" style={{ width: `${60 + widths[0] * 40}px` }} />
        <div className="h-3.5 bg-skeleton rounded w-16" />
      </div>

      <div className="ml-[20px] pt-2 space-y-2">
        {Array.from({ length: lineCount }, (_, i) => (
          <div
            key={i}
            className="h-4 bg-skeleton rounded"
            style={{ width: `${widths[i % widths.length] * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

interface CommentSkeletonTreeProps {
  count?: number;
}

export function CommentSkeletonTree({ count = 12 }: CommentSkeletonTreeProps) {
  // Varied lengths + widths so the skeleton doesn't read as repeating
  // identical rows.
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

// Inner content ONLY (chrome from consumer).
// Title h-6 ≤ real h1 to prevent PageStage contraction.
export function ItemDetailSkeleton() {
  return (
    <div className="animate-pulse">
      <article className="mb-6 pb-4 border-b border-border">
        <div className="mb-2">
          <div className="h-6 bg-skeleton rounded w-4/5" />
        </div>

        <div className="flex items-center gap-x-3.5 gap-y-2 min-h-5">
          <div className="h-3 bg-skeleton rounded w-12" />
          <div className="h-3 bg-skeleton rounded w-20" />
          <div className="h-3 bg-skeleton rounded w-14" />
          <div className="h-3 bg-skeleton rounded w-16" />
          <div className="h-3 bg-skeleton rounded w-16" />
        </div>
      </article>

      <section>
        <CommentSkeletonTree count={12} />
      </section>
    </div>
  );
}
