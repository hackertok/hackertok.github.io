/**
 * Shared className constants for the meta-row family used across
 * `StoryCard`, `ItemArticle`, `CommentArticle`, and `UserProfile`. The
 * meta row is a flex strip of small icon+label items (points / domain /
 * time / author / comments / submissions / etc.) with NO dot-or-pipe
 * separators — gap alone (`gap-x-3.5`) supplies the rhythm.
 *
 * Two constants because the row mixes two visual modes:
 *
 *   1. `metaItemClass` — bare inline-flex used by non-clickable spans
 *      (points, time without a link, comments count, etc.).
 *   2. `metaPillClass` — clickable variant adding the nav-pill hover
 *      backdrop (`hover:bg-muted hover:text-foreground`) plus
 *      `px-1.5 py-0.5` padding. The matching negative margin
 *      (`-mx-1.5 -my-0.5`) cancels the padding for layout purposes so
 *      the row's 14px gap rhythm stays identical to the bare-span
 *      variant — only the hover background extends out into the gap.
 *      This pill backdrop replaces the older `hover:text-accent`
 *      text-shift "I'm clickable" cue, which axe flagged as a
 *      colour-only affordance for the `link-in-text-block` rule.
 *
 * Author links additionally append `font-medium` (a weight delta vs the
 * surrounding `font-normal`) which is what actually satisfies axe — see
 * `AuthorByline` for the centralised wrapper.
 */
export const metaItemClass = 'inline-flex items-center gap-1.5';

export const metaPillClass =
  'inline-flex items-center gap-1.5 px-1.5 py-0.5 -mx-1.5 -my-0.5 rounded-lg hover:bg-muted hover:text-foreground transition-colors';
