import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';

/** Item with an estimated rendered width (px). */
export interface PackableItem {
  width: number;
  /**
   * Claims a slot before the left-to-right pass; only the first such item
   * does. The active tab sets this — a row that overflows the pill for the
   * page you are on reads as the wrong page.
   */
  pinned?: boolean;
}

export interface PackedNav<T extends PackableItem> {
  /** Items that fit and should render in the visible nav. */
  visible: T[];
  /** Items that don't fit and should render inside the overflow menu. */
  hidden: T[];
  /** True when at least one item is hidden — caller renders an overflow trigger. */
  showOverflow: boolean;
}

export interface UsePackedNavOptions {
  /** Width budget for the overflow trigger + its gap (px). */
  overflowWidth: number;
  /** Px gap between items (matches the parent flex `gap-*`). */
  gap: number;
}

const UNMEASURED = Number.POSITIVE_INFINITY;

/**
 * Greedy left-to-right nav packing. Hides trailing items into overflow
 * when the container shrinks, keeping a `pinned` item regardless of where
 * it sits. Generic over `T extends PackableItem`.
 *
 * On first render / jsdom, container width = Infinity (all items visible).
 */
export function usePackedNav<T extends PackableItem>(
  containerRef: RefObject<HTMLElement | null>,
  items: T[],
  options: UsePackedNavOptions,
): PackedNav<T> {
  const [containerWidth, setContainerWidth] = useState<number>(UNMEASURED);

  useLayoutEffect(() => {
    const el = containerRef.current;
    // Bail in environments where ResizeObserver isn't available (older
    // jsdom, some SSR runtimes). The state stays at the Infinity sentinel
    // so the consumer renders all items.
    if (!el || typeof ResizeObserver === 'undefined') return;

    let rafId: number | null = null;

    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) {
        setContainerWidth(w);
        return;
      }
      // 0-width usually means "container hasn't fully laid out yet" —
      // first paint on slow devices, parent flex item with `min-w-0`
      // mid-resize, etc. Re-measure on the next animation frame; if it's
      // still 0 the element is genuinely offscreen / not in layout (e.g.
      // jsdom) and we fall through to the Infinity sentinel (= show
      // every item). One RAF retry is enough — beyond that the next
      // ResizeObserver entry will catch up naturally.
      if (rafId === null && typeof requestAnimationFrame !== 'undefined') {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const retry = el.getBoundingClientRect().width;
          if (retry > 0) setContainerWidth(retry);
        });
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafId);
      }
    };
  }, [containerRef]);

  return useMemo<PackedNav<T>>(() => {
    if (items.length === 0) {
      return { visible: [], hidden: [], showOverflow: false };
    }

    const total = items.reduce(
      (sum, it, i) => sum + it.width + (i > 0 ? options.gap : 0),
      0,
    );

    // Everything fits — no overflow trigger needed.
    if (total <= containerWidth) {
      return {
        visible: items.slice(),
        hidden: [],
        showOverflow: false,
      };
    }

    // Overflow case — reserve space for the trigger and pack greedily.
    const budget = containerWidth - options.overflowWidth;
    const taken = new Set<number>();
    let used = 0;

    // Claimed ahead of the pass, so the last slot in a narrow row goes to
    // the pinned item rather than to whatever sorts first. Skipped when it
    // cannot fit alone — nothing is worth overflowing the row.
    const pinned = items.findIndex((it) => it.pinned);
    if (pinned !== -1 && items[pinned].width <= budget) {
      taken.add(pinned);
      used = items[pinned].width;
    }

    for (let i = 0; i < items.length; i++) {
      if (taken.has(i)) continue;
      const next = used + (taken.size > 0 ? options.gap : 0) + items[i].width;
      // Stop on first non-fitting item. We don't try later items even
      // if they're smaller — a "best Show then skip Ask then take More"
      // pattern would shuffle items unpredictably as the viewport
      // changes. Strict left-to-right greedy keeps order stable.
      if (next > budget) break;
      taken.add(i);
      used = next;
    }

    // Filtered rather than sliced: the pinned item can sit past the run
    // that fits, and both lists must stay in the caller's order.
    return {
      visible: items.filter((_, i) => taken.has(i)),
      hidden: items.filter((_, i) => !taken.has(i)),
      showOverflow: taken.size < items.length,
    };
  }, [items, containerWidth, options.gap, options.overflowWidth]);
}
