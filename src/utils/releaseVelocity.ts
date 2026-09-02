/**
 * Trailing window for release speed: wide enough to smooth 60Hz jitter, short
 * enough that a pause before the flick falls outside it.
 */
const VELOCITY_WINDOW_MS = 80;

/** Below this, a sample pair is too close in time to divide by. */
const MIN_VELOCITY_SPAN_MS = 8;

/** ~130ms of moves at 120Hz, so the window above is always spannable. */
export const MAX_DRAG_SAMPLES = 16;

export interface DragSample {
  /** Clamped offset, so travel the panel never made isn't counted as speed. */
  x: number;
  t: number;
}

/**
 * Speed the panel was moving at when the finger left, in px/ms. `null` when the
 * drag is too brief to measure — the caller falls back to the gesture average.
 */
export function releaseVelocityFrom(samples: DragSample[], releaseTime: number): number | null {
  const last = samples[samples.length - 1];
  if (!last) return null;

  // Parked before lifting: no momentum to continue.
  if (releaseTime - last.t > VELOCITY_WINDOW_MS) return 0;

  // Measuring across the window needs a sample on the far side of it.
  let oldest = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    oldest = samples[i];
    if (last.t - oldest.t >= VELOCITY_WINDOW_MS) break;
  }

  const span = last.t - oldest.t;
  if (span < MIN_VELOCITY_SPAN_MS) return null;

  return Math.abs(last.x - oldest.x) / span;
}
