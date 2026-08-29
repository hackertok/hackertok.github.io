import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Tailwind compiles `hover:` inside `@media (hover: hover)` and its preflight
// zeroes `-webkit-tap-highlight-color`, so a hover affordance with no `active:`
// twin is invisible to a finger. Nothing rendered can catch that: a synthesised
// press leaves `:active` unset in headless Chromium, so this reads the source —
// the same bind themeColors.test.ts is in.

const SOURCE_ROOT = resolve(process.cwd(), 'src');

const sourceFiles = readdirSync(SOURCE_ROOT, { recursive: true, encoding: 'utf8' })
  .filter((path) => /\.tsx?$/.test(path) && !path.includes('.test.'))
  .map((path) => resolve(SOURCE_ROOT, path));

/** Prose about a class is not a class. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** `dark:hover:bg-muted/50` → variants `dark:`, property `bg`. The value is
 *  optional so a `hover:underline` still counts as an affordance. */
const HOVER_UTILITY = /((?:[a-z-]+:)*)hover:([a-z]+)[a-z0-9/.[\]-]*/g;

/**
 * Same variants and same property, not the same value: a press may be a
 * different shade than its hover, but it has to change the same thing. Both
 * boundaries earn their keep — the lookbehind stops a bare `hover:` settling
 * for the `dark:active:` beside it, and the lookahead stops a property passing
 * for one that merely starts the same way.
 */
function hoversWithoutAPress(text: string) {
  return [...text.matchAll(HOVER_UTILITY)]
    .filter(
      ([, variants, property]) =>
        !new RegExp(`(?<![\\w:/-])${variants}active:${property}(?![a-z])`).test(text),
    )
    .map(([hover, variants, property]) => ({ hover, twin: `${variants}active:${property}` }));
}

describe('every hover affordance has a press state a finger can reach', () => {
  it('pairs each hover utility with an active one on the same element', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      withoutComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((text, index) => {
          for (const { hover, twin } of hoversWithoutAPress(text)) {
            offenders.push(
              `${file.slice(SOURCE_ROOT.length + 1)}:${index + 1} — ${hover} has no ${twin} twin`,
            );
          }
        });
    }

    expect(offenders, `\n  ${offenders.join('\n  ')}\n`).toEqual([]);
  });

  it('recognises an unpaired hover when it sees one', () => {
    // The scan above can only mean something if it can fail, and the repo has
    // nothing left for it to catch.
    const paired = 'hover:bg-muted active:bg-muted dark:hover:bg-muted/50 dark:active:bg-muted/50';
    const darkPressOnly = 'hover:bg-muted dark:hover:bg-muted/50 dark:active:bg-muted/50';

    expect(hoversWithoutAPress(paired)).toEqual([]);
    expect(hoversWithoutAPress(darkPressOnly)).toEqual([
      { hover: 'hover:bg-muted', twin: 'active:bg' },
    ]);
    expect(hoversWithoutAPress('hover:underline')).toEqual([
      { hover: 'hover:underline', twin: 'active:underline' },
    ]);
  });
});
