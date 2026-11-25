import { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { sanitizeHtml } from '../utils/sanitize';
import type { PollOption } from '../types';

// HN's biggest poll has 253 options, so a long one shows its top few until
// asked: the comments are under it.
const COLLAPSE_ABOVE = 12;
const COLLAPSED_COUNT = 10;

interface PollOptionsProps {
  options: PollOption[];
}

/**
 * A poll's options in the order given (HN's: most points first), each with its
 * points and share of all of them.
 */
export function PollOptions({ options }: PollOptionsProps) {
  const [expanded, setExpanded] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const total = options.reduce((sum, option) => sum + option.points, 0);
  const top = Math.max(0, ...options.map(option => option.points));
  const collapsible = options.length > COLLAPSE_ABOVE;
  const shown = collapsible && !expanded ? options.slice(0, COLLAPSED_COUNT) : options;

  const toggle = () => {
    const topBefore = toggleRef.current?.getBoundingClientRect().top ?? 0;
    flushSync(() => setExpanded(!expanded));
    // Collapsing pulls the toggle up past every option it hides, which would
    // leave the reader far down the comments: keep it where it was.
    const moved = (toggleRef.current?.getBoundingClientRect().top ?? 0) - topBefore;
    if (expanded && moved !== 0) window.scrollBy(0, moved);
  };

  return (
    <section aria-label="Poll options" className="poll">
      <ol className="flex flex-col gap-2">
        {shown.map(option => (
          <PollOptionRow
            key={option.id}
            option={option}
            share={total > 0 ? option.points / total : 0}
            leading={top > 0 && option.points === top}
          />
        ))}
      </ol>
      {collapsible && (
        <button
          ref={toggleRef}
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="mt-3 inline-flex items-center gap-1.5 px-2 py-1 -mx-2 -my-1 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
          {expanded ? 'Show fewer options' : `Show all ${options.length} options`}
        </button>
      )}
    </section>
  );
}

interface PollOptionRowProps {
  option: PollOption;
  share: number;
  leading: boolean;
}

function PollOptionRow({ option, share, leading }: PollOptionRowProps) {
  const sanitizedText = useMemo(() => sanitizeHtml(option.text), [option.text]);
  const percent = Math.round(share * 100);

  return (
    <li className="poll-option" data-leading={leading || undefined}>
      {/* The fill repeats the share the row spells out. */}
      <div aria-hidden className="poll-option-fill" style={{ width: `${share * 100}%` }} />
      <div className="relative">
        <div
          className={`comment-content break-words ${leading ? 'font-semibold' : ''}`}
          dangerouslySetInnerHTML={{ __html: sanitizedText }}
        />
        <div className="mt-1 text-sm tabular-nums text-muted-foreground">
          {option.points} {option.points === 1 ? 'point' : 'points'}
          <span aria-hidden> · </span>
          {percent === 0 && option.points > 0 ? '<1' : percent}%
        </div>
      </div>
    </li>
  );
}
