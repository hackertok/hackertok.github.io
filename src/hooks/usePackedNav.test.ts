import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { usePackedNav, type PackableItem } from './usePackedNav';

// Helper: make a fake `RefObject<HTMLElement>` that returns an element
// whose `getBoundingClientRect().width` is whatever we set. We don't use a
// real DOM element here — the hook only reads `width` off the bounding
// rect, so a minimal stub keeps the test focused on packing semantics.
function makeFakeRef(width: number) {
  const el = {
    getBoundingClientRect: () => ({ width } as DOMRect),
  } as unknown as HTMLElement;
  return { current: el } as React.RefObject<HTMLElement | null>;
}

// Test items add a `key` purely so the assertions can describe slices in
// human-readable order — `usePackedNav` itself only reads `width`. This
// shape mirrors how Header consumes the hook (NavItemSpec + width on the
// same object): the packer's output IS the renderable item, no per-key
// lookup needed.
interface TestItem extends PackableItem {
  key: string;
}

const keys = (items: TestItem[]) => items.map((i) => i.key);

const ITEMS_4: TestItem[] = [
  { key: 'comments', width: 96 },
  { key: 'best', width: 56 },
  { key: 'show', width: 60 },
  { key: 'ask', width: 50 },
];

describe('usePackedNav', () => {
  it('shows all items when container is wider than total content', () => {
    // Total width: 96 + 4 + 56 + 4 + 60 + 4 + 50 = 274px
    const { result } = renderHook(() =>
      usePackedNav(makeFakeRef(400), ITEMS_4, { overflowWidth: 105, gap: 4 }),
    );

    expect(keys(result.current.visible)).toEqual(['comments', 'best', 'show', 'ask']);
    expect(result.current.hidden).toEqual([]);
    expect(result.current.showOverflow).toBe(false);
  });

  it('shows all items on initial render before measurement (Infinity sentinel)', () => {
    // makeFakeRef(0) — a width of 0 is treated as "unmeasured" and the
    // hook stays at Infinity, ensuring all items render. This is what
    // keeps existing tests (which never trigger ResizeObserver entries)
    // assertion-friendly and also avoids a "everything-hidden" flash on
    // first paint in production before useLayoutEffect has measured.
    const { result } = renderHook(() =>
      usePackedNav(makeFakeRef(0), ITEMS_4, { overflowWidth: 105, gap: 4 }),
    );

    expect(keys(result.current.visible)).toEqual(['comments', 'best', 'show', 'ask']);
    expect(result.current.showOverflow).toBe(false);
  });

  it('packs all items into overflow when none fit the budget', () => {
    // budget = 130 - 105 = 25; comments alone is 96 → exceeds budget.
    // All items go into overflow.
    const { result } = renderHook(() =>
      usePackedNav(makeFakeRef(130), ITEMS_4, { overflowWidth: 105, gap: 4 }),
    );

    expect(keys(result.current.visible)).toEqual([]);
    expect(keys(result.current.hidden)).toEqual(['comments', 'best', 'show', 'ask']);
    expect(result.current.showOverflow).toBe(true);
  });

  it('hides items from the right as space shrinks', () => {
    // ITEMS_4 total = 96+4+56+4+60+4+50 = 274. overflowWidth = 105.

    // Narrow (220): doesn't fit (220 < 274). Budget = 220 - 105 = 115.
    // comments (96) fits. + 4 + best (56) = 156 > 115 → stops.
    const narrow = renderHook(() =>
      usePackedNav(makeFakeRef(220), ITEMS_4, { overflowWidth: 105, gap: 4 }),
    );
    expect(keys(narrow.result.current.visible)).toEqual(['comments']);
    expect(keys(narrow.result.current.hidden)).toEqual(['best', 'show', 'ask']);
    expect(narrow.result.current.showOverflow).toBe(true);

    // Medium (270): doesn't fit (270 < 274). Budget = 270 - 105 = 165.
    // comments (96) + 4 + best (56) = 156 ≤ 165 → both fit.
    // + 4 + show (60) = 220 > 165 → stops.
    const medium = renderHook(() =>
      usePackedNav(makeFakeRef(270), ITEMS_4, { overflowWidth: 105, gap: 4 }),
    );
    expect(keys(medium.result.current.visible)).toEqual(['comments', 'best']);
    expect(keys(medium.result.current.hidden)).toEqual(['show', 'ask']);
    expect(medium.result.current.showOverflow).toBe(true);

    // Roomy (273): JUST below total. Budget = 273 - 105 = 168. Same
    // packing as medium — boundary case showing the overflow trigger
    // is "expensive": once it appears, we sacrifice multiple items
    // before it's cheaper to drop it again.
    const roomy = renderHook(() =>
      usePackedNav(makeFakeRef(273), ITEMS_4, { overflowWidth: 105, gap: 4 }),
    );
    expect(keys(roomy.result.current.visible)).toEqual(['comments', 'best']);
    expect(roomy.result.current.showOverflow).toBe(true);

    // Bump container to 274 (total exactly) → all 4 fit, no overflow.
    const exact = renderHook(() =>
      usePackedNav(makeFakeRef(274), ITEMS_4, { overflowWidth: 105, gap: 4 }),
    );
    expect(keys(exact.result.current.visible)).toEqual(['comments', 'best', 'show', 'ask']);
    expect(exact.result.current.showOverflow).toBe(false);
  });

  it('reaches the 3-visible state when the overflow trigger is cheap enough', () => {
    // With a tiny overflow trigger (40px, e.g. an icon-only "more" button),
    // there's room to show 3 items + the trigger when ask alone is the
    // overflow. Container 270 → budget 230. comments+best+show = 220 ≤ 230
    // fits. + 4 + ask (50) = 274 > 230 → stops. visible=[c,b,s], hidden=[a].
    const { result } = renderHook(() =>
      usePackedNav(makeFakeRef(270), ITEMS_4, { overflowWidth: 40, gap: 4 }),
    );
    expect(keys(result.current.visible)).toEqual(['comments', 'best', 'show']);
    expect(keys(result.current.hidden)).toEqual(['ask']);
    expect(result.current.showOverflow).toBe(true);
  });

  it('handles empty input', () => {
    const { result } = renderHook(() =>
      usePackedNav(makeFakeRef(400), [] as TestItem[], { overflowWidth: 105, gap: 4 }),
    );

    expect(result.current.visible).toEqual([]);
    expect(result.current.hidden).toEqual([]);
    expect(result.current.showOverflow).toBe(false);
  });

  it('uses strict left-to-right greedy packing (does not skip items to fit smaller ones later)', () => {
    // 4 items: large, large, tiny, large.
    // budget after overflow reserve should fit only [items[0], tiny], but
    // greedy left-to-right stops at the first non-fitting item. We
    // intentionally don't backfill tiny items past a hidden one — would
    // shuffle order unpredictably as the viewport changes.
    const items: TestItem[] = [
      { key: 'a', width: 100 },
      { key: 'b', width: 80 }, // doesn't fit
      { key: 'c', width: 10 }, // would fit if we skipped b
      { key: 'd', width: 80 },
    ];
    // total = 100 + 4 + 80 + 4 + 10 + 4 + 80 = 282. Container 200 doesn't fit.
    // Reserve 50 → budget 150. items[0]=100. Try b: 100+4+80=184 > 150 STOP.
    const { result } = renderHook(() =>
      usePackedNav(makeFakeRef(200), items, { overflowWidth: 50, gap: 4 }),
    );

    expect(keys(result.current.visible)).toEqual(['a']);
    expect(keys(result.current.hidden)).toEqual(['b', 'c', 'd']);
  });

  it('repacks when items array changes (e.g. active context changes)', () => {
    // Start with comments-led ordering at a width that fits all 4.
    const { result, rerender } = renderHook(
      ({ items }: { items: TestItem[] }) =>
        usePackedNav(makeFakeRef(400), items, { overflowWidth: 105, gap: 4 }),
      { initialProps: { items: ITEMS_4 } },
    );
    expect(keys(result.current.visible)).toEqual(['comments', 'best', 'show', 'ask']);

    // Switch to feed-only nav (no contextual). Same width, fewer items —
    // still all visible.
    act(() => {
      rerender({
        items: [
          { key: 'best', width: 56 },
          { key: 'show', width: 60 },
          { key: 'ask', width: 50 },
        ],
      });
    });
    expect(keys(result.current.visible)).toEqual(['best', 'show', 'ask']);
    expect(result.current.showOverflow).toBe(false);
  });

  it('uses ref.current consistently across renders', () => {
    // Smoke test: the hook should not error when the ref starts unset and
    // is populated later. Returns Infinity-default packing while ref is null.
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement>(null);
      return usePackedNav(ref, ITEMS_4, { overflowWidth: 105, gap: 4 });
    });

    expect(keys(result.current.visible)).toEqual(['comments', 'best', 'show', 'ask']);
    expect(result.current.showOverflow).toBe(false);
  });
});
