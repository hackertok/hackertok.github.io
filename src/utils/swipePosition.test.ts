import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveSwipePosition,
  readSwipePosition,
  clearSwipePosition,
  SWIPE_POSITION_KEY,
  SWIPE_POSITION_AHEAD,
} from './swipePosition';
import { createStoryItem } from '../test/factories';
import type { StoryItem } from '../types';

describe('swipePosition', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const stories: StoryItem[] = [
    createStoryItem({ id: 1, title: 'A' }),
    createStoryItem({ id: 2, title: 'B' }),
    createStoryItem({ id: 3, title: 'C' }),
  ];

  describe('save / read roundtrip', () => {
    it('persists and reads back a snapshot', () => {
      saveSwipePosition({ viewer: { from: 'top' }, storyId: 2, index: 1, scrollY: 320, stories });

      const result = readSwipePosition()!;

      expect(result).not.toBeNull();
      expect(result.viewer).toEqual({ from: 'top' });
      expect(result.storyId).toBe(2);
      expect(result.scrollY).toBe(320);
      expect(result.stories.map(s => s.id)).toEqual([1, 2, 3]);
      expect(result.savedAt).toBe(Date.now());
    });

    it('rewrites index window-relative so stories[index].id === storyId', () => {
      saveSwipePosition({ viewer: { from: 'top' }, storyId: 2, index: 1, scrollY: 0, stories });

      const result = readSwipePosition()!;
      expect(result.stories[result.index].id).toBe(2);
    });

    it('returns null when nothing is stored', () => {
      expect(readSwipePosition()).toBeNull();
    });
  });

  describe('lean projection', () => {
    it('omits the heavy `text` body from stored stories', () => {
      const withText = createStoryItem({ id: 9, type: 'ask', text: '<p>huge ask body</p>' });
      saveSwipePosition({ viewer: { from: 'ask' }, storyId: 9, index: 0, scrollY: 0, stories: [withText] });

      const result = readSwipePosition()!;
      expect(result.stories[0]).not.toHaveProperty('text');
      // The fields used by the list/title still survive.
      expect(result.stories[0].id).toBe(9);
      expect(result.stories[0].type).toBe('ask');
    });
  });

  describe('window: full scrollback from the front + bounded look-ahead', () => {
    it('keeps the whole scrollback from the front and only a bounded look-ahead', () => {
      const big: StoryItem[] = Array.from({ length: 200 }, (_, i) => createStoryItem({ id: i }));
      saveSwipePosition({ viewer: { from: 'top' }, storyId: 100, index: 100, scrollY: 0, stories: big });

      const result = readSwipePosition()!;
      // Behind the anchor: everything from the front (index 0) is preserved...
      expect(result.stories[0].id).toBe(0);
      expect(result.index).toBe(100);
      expect(result.stories[result.index].id).toBe(100);
      // ...ahead of it: only a bounded look-ahead, so the list can't grow unbounded.
      expect(result.stories.length).toBe(100 + SWIPE_POSITION_AHEAD + 1);
      expect(result.stories[result.stories.length - 1].id).toBe(100 + SWIPE_POSITION_AHEAD);
    });

    it('preserves feed order from the front so a prepended restore cannot reorder it', () => {
      const big: StoryItem[] = Array.from({ length: 50 }, (_, i) => createStoryItem({ id: i }));
      saveSwipePosition({ viewer: { from: 'top' }, storyId: 30, index: 30, scrollY: 0, stories: big });

      const result = readSwipePosition()!;
      expect(result.stories.map(s => s.id)).toEqual(
        Array.from({ length: 30 + SWIPE_POSITION_AHEAD + 1 }, (_, i) => i),
      );
    });

    it('does not pad ahead when the anchor is near the end of the feed', () => {
      const big: StoryItem[] = Array.from({ length: 200 }, (_, i) => createStoryItem({ id: i }));
      saveSwipePosition({ viewer: { from: 'top' }, storyId: 198, index: 198, scrollY: 0, stories: big });

      const result = readSwipePosition()!;
      expect(result.stories[result.stories.length - 1].id).toBe(199); // clamped to feed end
      expect(result.stories[result.index].id).toBe(198);
    });
  });

  describe('TTL', () => {
    it('returns the snapshot within the 30-minute window', () => {
      saveSwipePosition({ viewer: { from: 'top' }, storyId: 2, index: 1, scrollY: 0, stories });

      vi.advanceTimersByTime(29 * 60 * 1000);

      expect(readSwipePosition()).not.toBeNull();
    });

    it('expires (and removes) the snapshot after 30 minutes', () => {
      saveSwipePosition({ viewer: { from: 'top' }, storyId: 2, index: 1, scrollY: 0, stories });

      vi.advanceTimersByTime(31 * 60 * 1000);

      expect(readSwipePosition()).toBeNull();
      expect(sessionStorage.getItem(SWIPE_POSITION_KEY)).toBeNull();
    });
  });

  describe('corruption / shape tolerance', () => {
    it('returns null for corrupted JSON', () => {
      sessionStorage.setItem(SWIPE_POSITION_KEY, 'not valid json');
      expect(readSwipePosition()).toBeNull();
    });

    it('returns null when required fields are missing or malformed', () => {
      sessionStorage.setItem(SWIPE_POSITION_KEY, JSON.stringify({ storyId: 2, savedAt: Date.now() }));
      expect(readSwipePosition()).toBeNull();

      sessionStorage.setItem(
        SWIPE_POSITION_KEY,
        JSON.stringify({ viewer: { from: 'top' }, storyId: 'nope', stories: [], savedAt: Date.now() }),
      );
      expect(readSwipePosition()).toBeNull();
    });
  });

  describe('quota tolerance', () => {
    it('does not throw when sessionStorage.setItem fails', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      expect(() =>
        saveSwipePosition({ viewer: { from: 'top' }, storyId: 2, index: 1, scrollY: 0, stories }),
      ).not.toThrow();
    });
  });

  describe('field defaults', () => {
    it('defaults index and scrollY to 0 when absent but the record is otherwise valid', () => {
      sessionStorage.setItem(
        SWIPE_POSITION_KEY,
        JSON.stringify({ viewer: { from: 'top' }, storyId: 2, stories: [{ id: 2 }], savedAt: Date.now() }),
      );

      const result = readSwipePosition()!;
      expect(result).not.toBeNull();
      expect(result.index).toBe(0);
      expect(result.scrollY).toBe(0);
    });

    it('returns null when viewer is present but not an object', () => {
      sessionStorage.setItem(
        SWIPE_POSITION_KEY,
        JSON.stringify({ viewer: 'top', storyId: 2, stories: [], savedAt: Date.now() }),
      );

      expect(readSwipePosition()).toBeNull();
    });
  });

  describe('clearSwipePosition', () => {
    it('removes a stored snapshot', () => {
      saveSwipePosition({ viewer: { from: 'top' }, storyId: 2, index: 1, scrollY: 0, stories });
      clearSwipePosition();
      expect(readSwipePosition()).toBeNull();
    });

    it('does not throw when nothing is stored', () => {
      expect(() => clearSwipePosition()).not.toThrow();
    });
  });
});
