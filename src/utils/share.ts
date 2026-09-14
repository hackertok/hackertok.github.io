/**
 * Sharing an item, with a clipboard path for the browsers that have no share
 * sheet. Kept out of the component so the capability matrix — which is most of
 * the complexity here — is testable without rendering anything.
 */

export type ShareOutcome =
  /** The system sheet took over; it provides its own confirmation. */
  | 'shared'
  /** The reader dismissed the sheet. A completed interaction, not a failure. */
  | 'dismissed'
  /** No sheet available (or it failed), so the URL went to the clipboard. */
  | 'copied'
  /** Neither route worked; the caller should stay silent rather than lie. */
  | 'unavailable';

const canUseShare = () => typeof navigator?.share === 'function';

// Types declare `navigator.clipboard` as always present, but it is absent in
// jsdom and outside a secure context, so this has to be a runtime check.
const canUseClipboard = () => typeof navigator?.clipboard?.writeText === 'function';

/** Whether a share control has anything to do on this platform. */
export function canShareOrCopy(): boolean {
  return canUseShare() || canUseClipboard();
}

/**
 * Absolute link to an item's own route. Built from `location.origin` rather than
 * a baked-in host so preview deploys and local runs share their own URL, and
 * from BASE_URL so it survives the app moving off the domain root.
 *
 * The `#` is load-bearing: routing is a HashRouter. `index.html` does redirect
 * `/item/123` into `/#/item/123`, but only the hash form avoids that round trip.
 */
export function itemPermalink(id: number | string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/item/${id}`;
}

/**
 * Hand `data` to the platform share sheet, falling back to the clipboard.
 *
 * Callers must invoke this directly from a user gesture: `navigator.share`
 * requires transient activation and rejects without it.
 */
export async function shareOrCopy(data: { title: string; url: string }): Promise<ShareOutcome> {
  if (canUseShare()) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      // Dismissal arrives as an exception, so it has to be told apart from a
      // real fault before anything is treated as one.
      if (error instanceof Error && error.name === 'AbortError') return 'dismissed';
      // Anything else (no activation, an OS-level refusal) still leaves the
      // reader wanting the URL, so fall through rather than dead-ending.
    }
  }

  if (canUseClipboard()) {
    try {
      await navigator.clipboard.writeText(data.url);
      return 'copied';
    } catch {
      return 'unavailable';
    }
  }

  return 'unavailable';
}
