import { describe, it, expect, afterEach, vi } from 'vitest';
import { canShareOrCopy, itemPermalink, shareOrCopy } from './share';

/**
 * jsdom ships neither `navigator.share` nor `navigator.clipboard`, so each
 * capability has to be installed per test. `configurable` matters: without it
 * the property can't be removed again and would leak into the next test.
 */
function stubNavigator(props: { share?: unknown; clipboard?: unknown }) {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
  }
}

function clearNavigatorStubs() {
  for (const key of ['share', 'clipboard']) {
    if (key in navigator) {
      Reflect.deleteProperty(navigator, key);
    }
  }
}

const payload = { title: 'Rust Is the Future', url: 'https://example.test/#/item/1' };

afterEach(() => {
  clearNavigatorStubs();
  vi.restoreAllMocks();
});

describe('itemPermalink', () => {
  it('builds an absolute hash-route URL on the current origin', () => {
    expect(itemPermalink(42)).toBe(`${window.location.origin}/#/item/42`);
  });

  it('accepts a string id without reformatting it', () => {
    expect(itemPermalink('42')).toBe(`${window.location.origin}/#/item/42`);
  });
});

describe('canShareOrCopy', () => {
  it('is false when the platform offers neither route', () => {
    expect(canShareOrCopy()).toBe(false);
  });

  it('is true with only the share sheet', () => {
    stubNavigator({ share: vi.fn() });
    expect(canShareOrCopy()).toBe(true);
  });

  it('is true with only the clipboard', () => {
    stubNavigator({ clipboard: { writeText: vi.fn() } });
    expect(canShareOrCopy()).toBe(true);
  });

  it('is false when clipboard exists but cannot write (non-secure context)', () => {
    stubNavigator({ clipboard: {} });
    expect(canShareOrCopy()).toBe(false);
  });
});

describe('shareOrCopy', () => {
  it('prefers the share sheet and reports it handled the interaction', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    stubNavigator({ share, clipboard: { writeText } });

    await expect(shareOrCopy(payload)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith(payload);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('treats a dismissed sheet as a completed interaction, not a copy', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const writeText = vi.fn();
    stubNavigator({ share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } });

    await expect(shareOrCopy(payload)).resolves.toBe('dismissed');
    // The reader chose to back out; silently copying instead would override that.
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls through to the clipboard when the sheet fails for any other reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({
      share: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      clipboard: { writeText },
    });

    await expect(shareOrCopy(payload)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(payload.url);
  });

  it('copies the URL when there is no share sheet at all', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ clipboard: { writeText } });

    await expect(shareOrCopy(payload)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(payload.url);
  });

  it('reports unavailable rather than claiming success when the copy is refused', async () => {
    stubNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });

    await expect(shareOrCopy(payload)).resolves.toBe('unavailable');
  });

  it('reports unavailable when neither route exists', async () => {
    await expect(shareOrCopy(payload)).resolves.toBe('unavailable');
  });
});
