import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { THEME_COLORS } from './themeConfig';

// THEME_COLORS is the runtime source of truth for the PWA status-bar color, but
// the same hexes are necessarily hardcoded where JS can't reach them: the
// index.html bootstrap (pre-React, anti-FOUC) and the static
// <meta name="theme-color"> default, plus the web app manifest (read by the OS
// for the install / splash chrome). ThemeProvider overwrites the meta tag on
// mount, so a drifted bootstrap or manifest hex can NOT be caught by a
// rendered-DOM test — only by cross-checking the literals, which is what this does.
const root = process.cwd();
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const manifest = JSON.parse(
  readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'),
) as { theme_color: string };

const BOOTSTRAP_RE = /isDark \? '(#[0-9a-fA-F]{6})' : '(#[0-9a-fA-F]{6})'/;
const STATIC_META_RE = /name="theme-color" content="(#[0-9a-fA-F]{6})"/;

describe('theme-color hexes stay in sync across THEME_COLORS / index.html / manifest', () => {
  it('the index.html bootstrap ternary matches THEME_COLORS', () => {
    const match = BOOTSTRAP_RE.exec(indexHtml);
    if (!match) throw new Error('bootstrap theme-color ternary not found in index.html');
    const [, dark, light] = match;
    expect(dark.toLowerCase()).toBe(THEME_COLORS.dark);
    expect(light.toLowerCase()).toBe(THEME_COLORS.light);
  });

  it('the static <meta name="theme-color"> default matches the light token', () => {
    const match = STATIC_META_RE.exec(indexHtml);
    if (!match) throw new Error('static theme-color meta not found in index.html');
    expect(match[1].toLowerCase()).toBe(THEME_COLORS.light);
  });

  it('the manifest theme_color matches the dark token (the PWA chrome is dark)', () => {
    expect(manifest.theme_color.toLowerCase()).toBe(THEME_COLORS.dark);
  });
});
