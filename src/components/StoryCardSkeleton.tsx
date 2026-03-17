interface StoryCardSkeletonProps {
  titleWidths?: number[];
  metaWidths?: number[];
}

// Single story card skeleton with randomized widths
export function StoryCardSkeleton({ titleWidths = [0.8, 0.4], metaWidths = [0.12, 0.15, 0.1, 0.14] }: StoryCardSkeletonProps) {
  return (
    <article className="py-3 first:pt-0">
      <div className="space-y-2">
        {/* Title skeleton - varying widths for natural look */}
        <div className="space-y-1.5">
          <div 
            className="h-4 bg-skeleton rounded" 
            style={{ width: `${titleWidths[0] * 100}%` }} 
          />
          {titleWidths[1] > 0 && (
            <div 
              className="h-4 bg-skeleton rounded" 
              style={{ width: `${titleWidths[1] * 100}%` }} 
            />
          )}
        </div>

        {/* Meta info skeleton */}
        <div className="flex items-center gap-2">
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[0] * 100}%` }} />
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[1] * 100}%` }} />
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[2] * 100}%` }} />
          <div className="h-3 bg-skeleton rounded" style={{ width: `${metaWidths[3] * 100}%` }} />
        </div>
      </div>
    </article>
  );
}

interface StoryCardSkeletonListProps {
  count?: number;
}

export function StoryCardSkeletonList({ count = 10 }: StoryCardSkeletonListProps) {
  // Create varied story card skeletons for realistic appearance
  const variations = [
    { titleWidths: [0.92, 0.35], metaWidths: [0.08, 0.12, 0.09, 0.11] },
    { titleWidths: [0.78, 0.48], metaWidths: [0.1, 0.14, 0.08, 0.13] },
    { titleWidths: [0.85, 0], metaWidths: [0.09, 0.11, 0.1, 0.12] },      // Single line title
    { titleWidths: [0.95, 0.42], metaWidths: [0.11, 0.13, 0.07, 0.1] },
    { titleWidths: [0.72, 0.55], metaWidths: [0.08, 0.15, 0.09, 0.14] },
    { titleWidths: [0.88, 0.28], metaWidths: [0.1, 0.12, 0.08, 0.11] },
    { titleWidths: [0.65, 0], metaWidths: [0.09, 0.14, 0.1, 0.13] },      // Single line title
    { titleWidths: [0.9, 0.38], metaWidths: [0.11, 0.11, 0.09, 0.12] },
    { titleWidths: [0.82, 0.5], metaWidths: [0.08, 0.13, 0.08, 0.1] },
    { titleWidths: [0.75, 0.32], metaWidths: [0.1, 0.12, 0.1, 0.14] },
    { titleWidths: [0.98, 0.45], metaWidths: [0.09, 0.14, 0.07, 0.11] },
    { titleWidths: [0.7, 0], metaWidths: [0.11, 0.1, 0.09, 0.13] },       // Single line title
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
