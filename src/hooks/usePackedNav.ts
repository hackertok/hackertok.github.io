import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';

/** Item with an estimated rendered width, in px at a {@link BASELINE_ROOT_PX} root. */
export interface PackableItem {
  width: number;
  /**
   * How much of `width` is glyphs. That part tracks the reader's text size,
   * which is not always the same thing as the root font size — Android scales
   * text on its own, leaving every `rem` length untouched. The remainder is
   * padding and icons, which follow `rem`. Omit it and the whole width follows
   * `rem`, as it did before there was a probe to measure text with.
   */
  textWidth?: number;
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
  /** How much of `overflowWidth` is glyphs. See {@link PackableItem.textWidth}. */
  overflowTextWidth?: number;
  /** Px gap between items (matches the parent flex `gap-*`). */
  gap: number;
  /**
   * The width the text probe measures, in px, in the environment the estimates
   * came from. Without it the probe is ignored. See the `textProbeRef`
   * parameter.
   */
  textProbeBaseline?: number;
}

const UNMEASURED = Number.POSITIVE_INFINITY;

/**
 * The root font size the caller's estimates describe. Pills are sized in `rem`,
 * so a reader at 150% renders them 1.5× while the nav, hemmed in by the
 * viewport, does not grow to match — at 320px it shrinks, the logo and the
 * toggle having taken more. Estimates read as px would let the packer fill a
 * row that cannot hold it.
 */
const BASELINE_ROOT_PX = 16;

/**
 * Greedy left-to-right nav packing. Hides trailing items into overflow
 * when the container shrinks, keeping a `pinned` item regardless of where
 * it sits. Generic over `T extends PackableItem`.
 *
 * On first render / jsdom, container width = Infinity (all items visible).
 *
 * `textProbeRef` points at a hidden element carrying the items' own
 * typography. Its width against `options.textProbeBaseline` is the reader's
 * text scale, whatever produced it: a browser font setting, an OS text size, a
 * minimum font size, or simply a different system font than the one the
 * estimates were measured in. A ref rather than a field on `options`, which
 * would make every read of that object look like a ref read during render.
 */
export function usePackedNav<T extends PackableItem>(
  containerRef: RefObject<HTMLElement | null>,
  items: T[],
  options: UsePackedNavOptions,
  textProbeRef?: RefObject<HTMLElement | null>,
): PackedNav<T> {
  const [containerWidth, setContainerWidth] = useState<number>(UNMEASURED);
  const [rootFontPx, setRootFontPx] = useState<number>(BASELINE_ROOT_PX);
  const [probeWidth, setProbeWidth] = useState<number>(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    // Bail in environments where ResizeObserver isn't available (older
    // jsdom, some SSR runtimes). The state stays at the Infinity sentinel
    // so the consumer renders all items.
    if (!el || typeof ResizeObserver === 'undefined') return;

    let rafId: number | null = null;

    const probe = textProbeRef?.current;

    const measure = () => {
      setRootFontPx(
        parseFloat(getComputedStyle(document.documentElement).fontSize) || BASELINE_ROOT_PX,
      );
      // 0 until it has laid out, which the memo reads as "no probe" and falls
      // back to the root font size.
      if (probe) setProbeWidth(probe.getBoundingClientRect().width);

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
    // The dependency stated outright, though today the nav catches a text
    // change without it: its width is flex-given and sits still, but pills
    // grow taller as their glyphs do, and the observer above fires on height
    // just the same. What the packer actually reads is this width, and a row
    // ever given a fixed height would leave that arriving nowhere.
    if (probe) ro.observe(probe);
    return () => {
      ro.disconnect();
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafId);
      }
    };
  }, [containerRef, textProbeRef]);

  return useMemo<PackedNav<T>>(() => {
    if (items.length === 0) {
      return { visible: [], hidden: [], showOverflow: false };
    }

    // The two things a reader can enlarge, kept apart because they do not move
    // together: `rem` lengths follow the root font size, glyphs follow the
    // probe. A browser font setting moves both, Android's slider only the
    // second, and with no probe to read the first stands in for both.
    const remScale = rootFontPx / BASELINE_ROOT_PX;
    const textScale =
      probeWidth > 0 && options.textProbeBaseline
        ? probeWidth / options.textProbeBaseline
        : remScale;

    /** An estimate in the units the container is measured in. */
    const rendered = (width: number, textWidth = 0) =>
      (width - textWidth) * remScale + textWidth * textScale;

    const gap = options.gap * remScale;
    const widths = items.map((it) => rendered(it.width, it.textWidth));
    const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);

    // Everything fits — no overflow trigger needed.
    if (total <= containerWidth) {
      return {
        visible: items.slice(),
        hidden: [],
        showOverflow: false,
      };
    }

    // Overflow case — reserve space for the trigger and pack greedily.
    const budget =
      containerWidth - rendered(options.overflowWidth, options.overflowTextWidth);
    const taken = new Set<number>();
    let used = 0;

    // Claimed ahead of the pass, so the last slot in a narrow row goes to
    // the pinned item rather than to whatever sorts first. Skipped when it
    // cannot fit alone — nothing is worth overflowing the row.
    const pinned = items.findIndex((it) => it.pinned);
    if (pinned !== -1 && widths[pinned] <= budget) {
      taken.add(pinned);
      used = widths[pinned];
    }

    for (let i = 0; i < items.length; i++) {
      if (taken.has(i)) continue;
      const next = used + (taken.size > 0 ? gap : 0) + widths[i];
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
  }, [
    items,
    containerWidth,
    rootFontPx,
    probeWidth,
    options.gap,
    options.overflowWidth,
    options.overflowTextWidth,
    options.textProbeBaseline,
  ]);
}
