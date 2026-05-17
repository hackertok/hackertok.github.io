import { useEffect } from 'react';

/** Sets `document.title`; restores on unmount. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title ? `${title} | HackerTok` : 'HackerTok';
    
    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
