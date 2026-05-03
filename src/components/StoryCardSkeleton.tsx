interface StoryCardSkeletonProps {
  titleWidths?: number[];
  metaWidths?: number[];
}

// Bar heights are kept SHORTER than the real card's rendered heights
// so PageStage's grid stack sizes the cell to `max(skeleton, real)`
// and there's no visible contraction when the overlay unmounts:
//   - Title bars `h-5` (20px) ≤ real title line box (24/26px).
//   - Second title bar is `md:hidden` — desktop titles almost always
//     fit on one line, and a 2-bar skeleton would contract from ~46px
//     to ~26px when real content arrives.
//   - Meta-row `min-h-5` (20px) matches real `text-sm` row height.
export function StoryCardSkeleton({
  titleWidths = [0.8, 0.4],
  metaWidths = [0.08, 0.16, 0.1, 0.14, 0.12],
}: StoryCardSkeletonProps) {
  return (
    <article className="py-3 first:pt-0">
      <div className="space-y-1.5">
        {/* Title skeleton — varying widths for natural look. */}
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

        {/* Meta info — 5 pills (points / domain / time / user / comments). */}
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
  // Each 5-tuple holds meta-row pill widths in production order
  // (points / domain / time / user / comments). Points and time stay
  // narrow; domain and user float more; comments stays moderate.
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
