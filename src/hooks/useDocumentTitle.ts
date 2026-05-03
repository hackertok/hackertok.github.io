import { useEffect } from 'react';

/**
 * Sets `document.title` to `${title} | HackerTok` (or just `HackerTok` when
 * `title` is omitted). Restores the previous title on unmount, so it composes
 * cleanly with modal-like components that mount/unmount mid-route.
 */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title ? `${title} | HackerTok` : 'HackerTok';
    
    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
