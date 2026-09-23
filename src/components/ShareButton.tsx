import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { metaPillClass } from '../lib/classes';
import { canShareOrCopy, shareOrCopy } from '../utils/share';

/** How long the copy confirmation holds before the label reverts. */
const COPIED_FEEDBACK_MS = 2000;

interface ShareButtonProps {
  title: string;
  url: string;
}

/**
 * Meta-row control that hands an item to the platform share sheet.
 *
 * Only the clipboard path gets visible feedback: the share sheet is its own
 * confirmation, whereas a copy is otherwise silent. The label carries that
 * feedback, but the button keeps a fixed accessible name so the control doesn't
 * appear to rename itself two seconds after being pressed; the copy is
 * announced separately instead.
 */
export function ShareButton({ title, url }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    },
    [],
  );

  const handleClick = useCallback(async () => {
    const outcome = await shareOrCopy({ title, url });
    // 'shared' and 'dismissed' both mean the sheet spoke for us, and
    // 'unavailable' has nothing truthful to report.
    if (outcome !== 'copied') return;

    setCopied(true);
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    revertTimerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, [title, url]);

  // A control that cannot act is worse than no control.
  if (!canShareOrCopy()) return null;

  return (
    <>
      <button type="button" onClick={handleClick} className={metaPillClass} aria-label="Share">
        {copied ? (
          <Check aria-hidden className="size-3.5" />
        ) : (
          <Share2 aria-hidden className="size-3.5" />
        )}
        <span aria-hidden>{copied ? 'copied' : 'share'}</span>
      </button>
      {/* Out of flow, so it adds no gap to the meta row. */}
      <span role="status" className="sr-only">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
    </>
  );
}
