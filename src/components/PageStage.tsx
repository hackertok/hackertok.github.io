import { useEffect, useState, type ReactNode } from 'react';
import { STAGGER_CAP_MS } from '../lib/staggerDelay';

// Done-timer math, kept here so the constants live next to their only
// consumer. CSS owns the actual animation duration (`stage-fade-in
// 360ms` in `src/index.css`); the JS constant mirrors it so the timer
// derivation stays honest. SLACK absorbs scheduler jitter and the
// double-rAF that precedes 'transitioning'.
const ENTRANCE_ANIMATION_MS = 360;
const TIMER_SLACK_MS = 240;
const STAGE_DONE_TIMEOUT_MS =
  STAGGER_CAP_MS + ENTRANCE_ANIMATION_MS + TIMER_SLACK_MS;

interface PageStageProps {
  loading: boolean;
  skeleton: ReactNode;
  /**
   * Real content. Always mounted across every state so navigation,
   * focus, and screen readers see a stable tree. Visibility during the
   * cascade is driven by CSS class scoping (`stagger-fade` /
   * `story-stage-leader`) rather than React conditional rendering.
   */
  children: ReactNode;
  /**
   * Gate for the cascade. `FullScreenItem` passes `isPriority` so
   * offscreen swipe panels hold their entrance animation until the
   * user actually swipes to them.
   */
  triggerWhen?: boolean;
}

/**
 * Three-state choreography wrapper for any page that has a skeleton:
 *
 *   skeleton      → overlay opacity 1, real content opacity 0
 *   transitioning → overlay fades out (320ms), real content cascades in
 *   done          → overlay unmounted, real content stays at opacity 1
 *
 * Overlay and children are stacked via CSS grid (see `.page-stage` in
 * `src/index.css`) — NOT position:absolute — so the grid cell auto-
 * sizes to `max(skeleton, children)` and a cold load with empty
 * children doesn't render at 0×0.
 *
 * The CSS opacity rule on real children is scoped with `:not(.fade-
 * skeleton)` so it ONLY applies in `'skeleton'`; otherwise removing
 * `play-real` at t=1200ms would snap children back to opacity 0.
 */
export function PageStage({
  loading,
  skeleton,
  children,
  triggerWhen = true,
}: PageStageProps) {
  // Cache hits land directly in `done` so back-nav / refresh don't re-
  // burn the cascade — the entrance animation earns its motion by
  // bridging the skeleton-to-content swap, not as a free decoration on
  // every navigation. The reset effect at the bottom of this component
  // restores the skeleton state when `loading` flips back to true.
  const initialReady = !loading && triggerWhen;
  const [stage, setStage] = useState<'skeleton' | 'transitioning' | 'done'>(
    initialReady ? 'done' : 'skeleton',
  );

  // Double-rAF: one rAF gets to "after layout"; the second guarantees
  // "after the next paint", so the overlay is on screen before its
  // opacity transition starts. Without this the overlay never paints
  // when data resolves synchronously.
  useEffect(() => {
    if (stage === 'skeleton' && !loading && triggerWhen) {
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setStage('transitioning'));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
  }, [loading, triggerWhen, stage]);

  // After the cascade settles (cap + animation + slack), drop into
  // 'done': the `.page-stage.play-real .stagger-fade` rule stops
  // matching and infinite-scroll appends mount at default opacity 1.
  // Derived from STAGGER_CAP_MS so a tuning change to the cap keeps
  // the timer in sync (otherwise the longest-delay card would still
  // be animating when we drop play-real and snap it to its rest state).
  useEffect(() => {
    if (stage === 'transitioning') {
      const t = setTimeout(() => setStage('done'), STAGE_DONE_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
  }, [stage]);

  // Refresh / parent-link nav reuses this instance — without the reset
  // the second fetch would render stale children with `done` styling.
  useEffect(() => {
    if (loading && stage !== 'skeleton') setStage('skeleton');
  }, [loading, stage]);

  const stageClass =
    stage === 'transitioning'
      ? 'fade-skeleton play-real'
      : stage === 'done'
        ? 'fade-skeleton'
        : '';

  return (
    <div className={`page-stage ${stageClass}`.trim()}>
      <div className="page-stage-content">{children}</div>
      {stage !== 'done' && (
        <div className="skeleton-overlay" aria-hidden="true">
          {skeleton}
        </div>
      )}
    </div>
  );
}
