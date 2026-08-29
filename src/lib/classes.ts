/**
 * Shared meta-row classNames. `metaItemClass` = non-clickable spans;
 * `metaPillClass` = clickable variant with hover backdrop and negative
 * margin to cancel padding so gap rhythm stays consistent.
 *
 * `active:` mirrors `hover:` because Tailwind scopes `hover:` behind
 * `@media (hover: hover)`, leaving a tap with no feedback otherwise.
 */
export const metaItemClass = 'inline-flex items-center gap-1.5';

export const metaPillClass =
  'inline-flex items-center gap-1.5 px-1.5 py-0.5 -mx-1.5 -my-0.5 rounded-lg hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground transition-colors';
