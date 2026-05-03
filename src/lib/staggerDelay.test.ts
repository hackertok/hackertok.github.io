import { describe, it, expect } from 'vitest';
import { decayDelay, STAGGER_CAP_MS } from './staggerDelay';

describe('decayDelay', () => {
  // Slot 0 is reserved for the story-header leader (`.story-stage-leader`)
  // which animates immediately without a stagger delay; the cascade for
  // every other slot starts AFTER that leader has already begun. Pinning
  // 0ms here also catches accidental off-by-one shifts in the formula.
  it('returns 0 for slot 0', () => {
    expect(decayDelay(0)).toBe(0);
  });

  // First real card lands one full per-card increment (50ms) after the
  // header leader. This is the "fastest interesting" delay in the
  // cascade — anything closer to the leader would feel like a single
  // burst rather than a sequence.
  it('returns the first per-card increment for slot 1', () => {
    expect(decayDelay(1)).toBe(50);
  });

  // Mid-curve sample anchors the decay shape. Linear stagger (50ms each)
  // would put slot 12 at 600ms (the cap); the decay formula puts it at
  // 457ms — a meaningful drop that proves the curve is actually decaying
  // and not just being clamped by the cap.
  it('puts the mid-curve slot 12 well below the cap', () => {
    expect(decayDelay(12)).toBe(457);
  });

  // Knee = 23: the formula reaches the cap exactly at this slot. Slot 24
  // and beyond use the early-return cap branch instead of the formula
  // (which would start producing non-monotonic values past the knee).
  // These two assertions together pin the knee location.
  it('hits the cap exactly at the knee (slot 23)', () => {
    expect(decayDelay(23)).toBe(STAGGER_CAP_MS);
  });

  it('returns the cap for slot 24 (first post-knee slot)', () => {
    expect(decayDelay(24)).toBe(STAGGER_CAP_MS);
  });

  // Far past the knee — picked so a regression that "forgot the cap"
  // (e.g. removed the early-return branch) would visibly fail with a
  // very large or even negative value from the unclamped formula.
  it('returns the cap for slot 50 (deep post-knee)', () => {
    expect(decayDelay(50)).toBe(STAGGER_CAP_MS);
  });

  // Inter-slot monotonicity: the cascade should never go BACKWARDS in
  // time (a later card landing earlier than an earlier card would look
  // like a glitch). Spot-check across the knee.
  it('produces a monotonically non-decreasing sequence across the knee', () => {
    for (let i = 0; i < 30; i++) {
      expect(decayDelay(i + 1)).toBeGreaterThanOrEqual(decayDelay(i));
    }
  });
});
