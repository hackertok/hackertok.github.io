import { describe, it, expect } from 'vitest';
import { releaseVelocityFrom } from './releaseVelocity';

// The settle animation inherits this number: measure the wrong stretch of the
// drag and a committed swipe visibly slows the moment the finger leaves.
describe('releaseVelocityFrom', () => {
  it('reads the flick a reader ends on, not the pause before it', () => {
    const samples = [
      { x: 0, t: 0 },
      { x: -10, t: 200 },
      { x: -20, t: 400 },
      { x: -60, t: 440 },
      { x: -100, t: 480 },
    ];

    const velocity = releaseVelocityFrom(samples, 480);
    const gestureAverage = 100 / 480;

    // 80px over the trailing 80ms, against 0.21px/ms across the whole drag.
    expect(velocity).toBeCloseTo(1);
    expect(velocity!).toBeGreaterThan(gestureAverage * 4);
  });

  it('rides over a jittery final frame instead of trusting the last pair', () => {
    // Steady 1px/ms, but the last frame landed almost nowhere. The last two
    // points alone would report a quarter of the real speed.
    const samples = [
      { x: 0, t: 0 },
      { x: -40, t: 40 },
      { x: -80, t: 80 },
      { x: -81, t: 84 },
    ];

    const velocity = releaseVelocityFrom(samples, 84);
    const naiveLastPair = 1 / 4;

    expect(velocity).toBeCloseTo(0.96, 1);
    expect(velocity!).toBeGreaterThan(naiveLastPair * 3);
  });

  it('reports a standstill when the finger parked before lifting', () => {
    // Dragged fast, held 300ms, released: continuing that speed would fling a
    // panel the reader had already stopped.
    const samples = [
      { x: 0, t: 0 },
      { x: -120, t: 100 },
    ];

    expect(releaseVelocityFrom(samples, 400)).toBe(0);
  });

  it('declines to guess from a drag too brief to measure', () => {
    // `null` is not zero: it sends the caller back to its gesture average rather
    // than reporting a flick as motionless.
    expect(releaseVelocityFrom([], 0)).toBeNull();
    expect(releaseVelocityFrom([{ x: -30, t: 0 }], 0)).toBeNull();
    expect(releaseVelocityFrom([{ x: 0, t: 0 }, { x: -30, t: 4 }], 4)).toBeNull();
  });
});
