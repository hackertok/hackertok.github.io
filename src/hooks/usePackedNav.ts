import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';

/**
 * Minimum shape consumed by `usePackedNav` — only `width` is read by the
 * packer. Callers attach whatever else they need (key, label, icon, render
 * spec) on the same object, and the hook returns that same object back in
 * `visible` / `hidden` slices so no per-key lookup is needed downstream.
 */
export interface PackableItem {
  /** Estimated rendered width in CSS px. Should include internal padding. */
  width: number;
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
  /**
   * Width budget (in CSS px) consumed by the overflow trigger AND its
   * leading separator/gap. Subtracted from the container width before
   * packing so the trigger is guaranteed to fit alongside the visible
   * items when overflow is needed.
   */
  overflowWidth: number;
  /** Px gap between adjacent items (matches the parent flex `gap-*`). */
  gap: number;
}

const UNMEASURED = Number.POSITIVE_INFINITY;

/**
 * Greedy nav-overflow packing. Progressively hides trailing items into
 * the overflow menu when the container shrinks below the items' total
 * width. No item is force-included — if the budget is too small for
 * even the first item, every item lands in the overflow menu. Returns
 * the packed slices as the original item objects (not just keys) —
 * generic over `T extends PackableItem` so callers can attach render
 * data alongside `width` and read it straight off the result without
 * a separate lookup.
 *
 * Items are packed strictly left-to-right; the consumer controls
 * priority by ordering the input array. The Header puts the active
 * contextual pill (Comments / User / From) at index 0 when one exists,
 * falling back to the canonical first feed tab — but neither position
 * guarantees visibility on extremely narrow viewports. The consumer is
 * expected to mirror the active treatment into the overflow menu item
 * via `aria-current` + active styling (as Header does).
 *
 * On first render and in environments without DOM layout (jsdom, SSR), the
 * container width is treated as Infinity so every item is visible and the
 * overflow trigger stays hidden — this keeps tests assertion-friendly
 * without needing a ResizeObserver mock that fires entries, and avoids a
 * "everything hidden, then settles" flicker on production mount (the real
 * width is captured synchronously inside `useLayoutEffect` before paint).
 *
 * @example
 *   const navRef = useRef<HTMLElement>(null);
 *   const items = [
 *     { key: 'comments', width: 96, label: 'Comments' },
 *     { key: 'best', width: 56, label: 'Best' },
 *     { key: 'show', width: 60, label: 'Show' },
 *     { key: 'ask', width: 50, label: 'Ask' },
 *   ];
 *   const { visible, hidden, showOverflow } = usePackedNav(navRef, items, {
 *     overflowWidth: 105, // separator slot (~21) + 'more' pill (~84)
 *     gap: 4,
 *   });
 *   // visible / hidden are arrays of the same `{ key, width, label }`
 *   // objects — no key-based lookup needed in the renderer.
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
    const visible: T[] = [];
    let used = 0;

    for (let i = 0; i < items.length; i++) {
      const next = used + (i > 0 ? options.gap : 0) + items[i].width;
      if (next <= budget) {
        visible.push(items[i]);
        used = next;
      } else {
        // Stop on first non-fitting item. We don't try later items even
        // if they're smaller — a "best Show then skip Ask then take More"
        // pattern would shuffle items unpredictably as the viewport
        // changes. Strict left-to-right greedy keeps order stable.
        break;
      }
    }

    return {
      visible,
      hidden: items.slice(visible.length),
      showOverflow: true,
    };
  }, [items, containerWidth, options.gap, options.overflowWidth]);
}
