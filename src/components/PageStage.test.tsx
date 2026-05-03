import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PageStage } from './PageStage';

// PageStage drives a 3-state machine via rAF + setTimeout. Fake timers
// give us deterministic control of both. RTL `act()` wraps every state
// flush so React commits (and effect cleanups) run inside the act
// boundary — without it, the warning "test contains state updates not
// wrapped in act" fires on every transition.
function flushRAF() {
  // The component schedules transitions behind a double rAF (rAF inside
  // an rAF callback). vi.advanceTimersToNextFrame would only flush one
  // — manually advancing twice covers both.
  act(() => {
    vi.advanceTimersByTime(20);
  });
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

describe('PageStage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the skeleton overlay while loading', () => {
    render(
      <PageStage loading={true} skeleton={<div data-testid="skel">loading…</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );

    // Real children are always mounted (so navigation / focus / a11y
    // tree see a stable DOM) — the visual hiding is CSS, not React.
    expect(screen.getByTestId('real')).toBeInTheDocument();
    expect(screen.getByTestId('skel')).toBeInTheDocument();

    // No `fade-skeleton` / `play-real` class yet — wrapper is in the
    // bare 'skeleton' state.
    const wrapper = screen.getByTestId('real').closest('.page-stage');
    expect(wrapper).not.toHaveClass('fade-skeleton');
    expect(wrapper).not.toHaveClass('play-real');
  });

  it('keeps real children mounted across every state transition', () => {
    const { rerender } = render(
      <PageStage loading={true} skeleton={<div>skel</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );

    // State: skeleton.
    expect(screen.getByTestId('real')).toBeInTheDocument();

    // skeleton → transitioning.
    rerender(
      <PageStage loading={false} skeleton={<div>skel</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );
    flushRAF();
    expect(screen.getByTestId('real')).toBeInTheDocument();

    // transitioning → done (after the 1200ms timer plus slack).
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(screen.getByTestId('real')).toBeInTheDocument();
  });

  it('lands directly in `done` (no cascade) when initialReady is true', () => {
    render(
      <PageStage loading={false} skeleton={<div data-testid="skel">skel</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );

    // initialReady=true (loading=false at mount, triggerWhen default true)
    // means cached / prefetched data — PageStage skips the skeleton AND
    // the cascade and lands straight in 'done'. The entrance animation
    // is the cost-of-skeleton: if no skeleton was shown, no cascade is
    // earned. Wrapper carries `fade-skeleton` (so the post-cascade
    // opacity rules resolve to default opacity 1, not the
    // :not(.fade-skeleton) opacity:0 baseline) but never picks up
    // `play-real` (no animation runs).
    const wrapper = screen.getByTestId('real').closest('.page-stage')!;
    expect(wrapper).toHaveClass('fade-skeleton');
    expect(wrapper).not.toHaveClass('play-real');

    // Skeleton overlay was never mounted in the DOM — `done` state
    // unmounts it, even on first render.
    expect(screen.queryByTestId('skel')).not.toBeInTheDocument();

    // Advancing the timers must NOT toggle anything (no setTimeout
    // armed in the 'done' state). This pins the no-op behaviour.
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    expect(wrapper).toHaveClass('fade-skeleton');
    expect(wrapper).not.toHaveClass('play-real');
  });

  // Regression: only a *real* skeleton-to-content transition should
  // earn the entrance cascade. A pure cache hit (loading=false from
  // the start) lands in 'done' immediately. A refresh that flips
  // loading back to true *does* re-arm the cascade, because the
  // skeleton is shown again. This test pins both halves of the
  // contract.
  it('only animates the cascade when the user passed through the skeleton', () => {
    // Cache hit: loading=false from the start → no cascade.
    const { rerender } = render(
      <PageStage loading={false} skeleton={<div data-testid="skel">skel</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );
    const wrapper = screen.getByTestId('real').closest('.page-stage')!;
    expect(wrapper).not.toHaveClass('play-real');

    // Refresh: parent flips loading=true. Wrapper resets to skeleton.
    rerender(
      <PageStage loading={true} skeleton={<div data-testid="skel">skel</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );
    expect(wrapper).not.toHaveClass('fade-skeleton');
    expect(wrapper).not.toHaveClass('play-real');
    expect(screen.getByTestId('skel')).toBeInTheDocument();

    // Refresh resolves: loading=false again. Now the cascade DOES
    // play — the user saw the skeleton, so the entrance bridges back
    // to real content.
    rerender(
      <PageStage loading={false} skeleton={<div data-testid="skel">skel</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );
    flushRAF();
    expect(wrapper).toHaveClass('fade-skeleton');
    expect(wrapper).toHaveClass('play-real');
  });

  it('holds the trigger when triggerWhen is false', () => {
    const { rerender } = render(
      <PageStage
        loading={false}
        triggerWhen={false}
        skeleton={<div data-testid="skel">skel</div>}
      >
        <div data-testid="real">content</div>
      </PageStage>,
    );

    flushRAF();

    // Stays in 'skeleton' state because triggerWhen=false gates the
    // advance. Wrapper has neither fade-skeleton nor play-real.
    const wrapper = screen.getByTestId('real').closest('.page-stage')!;
    expect(wrapper).not.toHaveClass('fade-skeleton');
    expect(wrapper).not.toHaveClass('play-real');
    expect(screen.getByTestId('skel')).toBeInTheDocument();

    // Flipping triggerWhen=true releases the gate and the cascade runs.
    rerender(
      <PageStage
        loading={false}
        triggerWhen={true}
        skeleton={<div data-testid="skel">skel</div>}
      >
        <div data-testid="real">content</div>
      </PageStage>,
    );
    flushRAF();

    expect(wrapper).toHaveClass('fade-skeleton');
    expect(wrapper).toHaveClass('play-real');
  });

  it('resets to skeleton when loading flips back to true', () => {
    const { rerender } = render(
      <PageStage loading={false} skeleton={<div data-testid="skel">skel</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );

    // Land in 'done'.
    act(() => {
      vi.advanceTimersByTime(1300);
    });
    const wrapper = screen.getByTestId('real').closest('.page-stage')!;
    expect(wrapper).toHaveClass('fade-skeleton');
    expect(wrapper).not.toHaveClass('play-real');

    // Refresh: loading flips back to true. Wrapper must reset to
    // 'skeleton' (no fade-skeleton, no play-real) and re-mount the
    // overlay so the next fetch shows a skeleton instead of stale
    // content.
    rerender(
      <PageStage loading={true} skeleton={<div data-testid="skel">skel</div>}>
        <div data-testid="real">content</div>
      </PageStage>,
    );

    expect(wrapper).not.toHaveClass('fade-skeleton');
    expect(wrapper).not.toHaveClass('play-real');
    expect(screen.getByTestId('skel')).toBeInTheDocument();
  });

  // Regression for the CSS opacity-scope bug: the
  // .page-stage:not(.fade-skeleton) .stagger-fade { opacity: 0 } rule
  // is scoped so it ONLY applies in the 'skeleton' state. Without that
  // scope, removing play-real at t=1200ms would unset the animation
  // property and elements would snap back to opacity 0. This test
  // pins the post-cascade class projection — if the wrapper ever
  // KEEPS play-real (or LOSES fade-skeleton) in 'done', infinite-
  // scroll appended cards would either keep animating or jump to
  // opacity 0.
  it('reaches done with `fade-skeleton` set and `play-real` cleared', () => {
    render(
      <PageStage loading={false} skeleton={<div>skel</div>}>
        <div data-testid="real" className="stagger-fade">
          content
        </div>
      </PageStage>,
    );

    act(() => {
      vi.advanceTimersByTime(1300);
    });

    const wrapper = screen.getByTestId('real').closest('.page-stage')!;
    expect(wrapper.className).toContain('fade-skeleton');
    expect(wrapper.className).not.toContain('play-real');
  });
});
