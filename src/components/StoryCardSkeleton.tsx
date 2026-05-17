interface StoryCardSkeletonProps {
  titleWidths?: number[];
  metaWidths?: number[];
}

// Heights ≤ real card to prevent PageStage contraction.
// Second title bar md:hidden (desktop titles fit one line).
export function StoryCardSkeleton({
  titleWidths = [0.8, 0.4],
  metaWidths = [0.08, 0.16, 0.1, 0.14, 0.12],
}: StoryCardSkeletonProps) {
  return (
    <article className="py-3 first:pt-0">
      <div className="space-y-1.5">
        {/* Title skeleton */}
        <div className="space-y-1">
          <div
            className="h-5 bg-skeleton rounded"
            style={{ width: `${titleWidths[0] * 100}%` }}
          />
          {titleWidths[1] > 0 && (
            <div
              className="h-5 bg-skeleton rounded md:hidden"
              style={{ width: `${titleWidths[1] * 100}%` }}
            />
          )}
        </div>

        <div className="flex items-center gap-x-3.5 gap-y-2 min-h-5">
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[0] * 100}%` }} />
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[1] * 100}%` }} />
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[2] * 100}%` }} />
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[3] * 100}%` }} />
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[4] * 100}%` }} />
        </div>
      </div>
    </article>
  );
}

interface StoryCardSkeletonListProps {
  count?: number;
}

export function StoryCardSkeletonList({ count = 10 }: StoryCardSkeletonListProps) {
  // Meta pill widths: points / domain / time / user / comments.
  const variations = [
    { titleWidths: [0.92, 0.35], metaWidths: [0.07, 0.18, 0.09, 0.13, 0.11] },
    { titleWidths: [0.78, 0.48], metaWidths: [0.08, 0.16, 0.08, 0.15, 0.10] },
    { titleWidths: [0.85, 0],    metaWidths: [0.09, 0.14, 0.10, 0.12, 0.12] }, // single-line title
    { titleWidths: [0.95, 0.42], metaWidths: [0.08, 0.20, 0.07, 0.10, 0.13] },
    { titleWidths: [0.72, 0.55], metaWidths: [0.07, 0.15, 0.09, 0.16, 0.09] },
    { titleWidths: [0.88, 0.28], metaWidths: [0.10, 0.13, 0.08, 0.14, 0.11] },
    { titleWidths: [0.65, 0],    metaWidths: [0.08, 0.17, 0.10, 0.13, 0.12] }, // single-line title
    { titleWidths: [0.90, 0.38], metaWidths: [0.09, 0.12, 0.09, 0.15, 0.10] },
    { titleWidths: [0.82, 0.50], metaWidths: [0.07, 0.16, 0.08, 0.11, 0.13] },
    { titleWidths: [0.75, 0.32], metaWidths: [0.10, 0.13, 0.10, 0.14, 0.09] },
    { titleWidths: [0.98, 0.45], metaWidths: [0.08, 0.19, 0.07, 0.12, 0.11] },
    { titleWidths: [0.70, 0],    metaWidths: [0.09, 0.11, 0.09, 0.16, 0.13] }, // single-line title
  ];

  return (
    <div className="space-y-0 divide-y divide-border animate-pulse">
      {Array.from({ length: count }, (_, i) => {
        const variation = variations[i % variations.length];
        return (
          <StoryCardSkeleton
            key={i}
            titleWidths={variation.titleWidths}
            metaWidths={variation.metaWidths}
          />
        );
      })}
    </div>
  );
}
