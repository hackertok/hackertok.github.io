import { formatTimeAgo, formatAbsoluteTime, safeISOString } from '../api/hn';

interface RelativeTimeProps {
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/**
 * Centralized `<time>` with relative label, absolute title, and ISO dateTime.
 * UserProfile uses its own inverted pair (absolute visible, relative on hover).
 */
export function RelativeTime({ timestamp }: RelativeTimeProps) {
  return (
    <time
      dateTime={safeISOString(timestamp)}
      title={formatAbsoluteTime(timestamp)}
    >
      {formatTimeAgo(timestamp)}
    </time>
  );
}
