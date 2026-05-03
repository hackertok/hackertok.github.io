/**
 * Per-card increment for the entry cascade. The first card sits at this
 * exact delay; subsequent cards decay toward zero as `i` grows.
 */
export const STAGGER_PER_CARD_MS = 50;

/**
 * Cap for the longest delay any card receives. Past the knee (slot 23),
 * every card lands at this single value so the cascade resolves in
 * bounded time even on long lists / deeply-nested reply threads.
 */
export const STAGGER_CAP_MS = 600;

// Knee is the slot at which the per-step delta would otherwise reach 0.
// Derived from the linear-decay formula `delta(i) = D * (1 - i/K)` so
// `delta(K) = 0` — meaning slot K's delay equals the cap and slot K+1
// would not add anything new. With D=50ms and cap=600ms, K=23.
const KNEE = (2 * STAGGER_CAP_MS) / STAGGER_PER_CARD_MS - 1; // 23

/**
 * Decaying-stagger delay for slot `i`: each successive card adds a
 * smaller increment than the previous one, so the cascade visually
 * settles instead of stretching linearly across the viewport.
 *
 * Formula: `delay(i) = D * i * (2K + 1 - i) / (2K)` for i ≤ K.
 * Past slot K (i ≥ K+1) every slot returns the cap.
 *
 * Reference values (D=50, K=23, cap=600):
 *   i=0  →    0ms (slot 0 is the story-header leader, no delay)
 *   i=1  →   50ms
 *   i=12 →  457ms (mid-curve)
 *   i=23 →  600ms (knee = cap)
 *   i=24 →  600ms (post-knee, capped)
 *   i=50 →  600ms (capped)
 */
export function decayDelay(i: number): number {
  if (i >= KNEE + 1) return STAGGER_CAP_MS;
  return Math.round((STAGGER_PER_CARD_MS * i * (2 * KNEE + 1 - i)) / (2 * KNEE));
}
