import { useEffect } from 'react';

/**
 * Custom hook to update the document title
 * Automatically appends " | HackerTok" suffix
 * 
 * @param {string} title - The page-specific title (without suffix)
 * 
 * @example
 * // Sets title to "Best Stories | HackerTok"
 * useDocumentTitle('Best Stories');
 * 
 * @example
 * // Sets title to just "HackerTok" when no title provided
 * useDocumentTitle();
 */
export function useDocumentTitle(title) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title ? `${title} | HackerTok` : 'HackerTok';
    
    // Restore previous title on unmount (useful for modal-like components)
    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
