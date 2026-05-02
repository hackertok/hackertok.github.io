import { formatTimeAgo, formatAbsoluteTime, safeISOString } from '../api/hn';

interface RelativeTimeProps {
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/**
 * `<time>` element rendering a relative "X hours ago"-style label with the
 * absolute formatted time on `title` and an ISO-8601 `dateTime`. Centralises
 * the strict "relative-visible / absolute-on-hover / iso-on-attribute"
 * pattern used across the meta rows of `StoryCard`, `ItemArticle`,
 * `CommentArticle`, and `Comment`.
 *
 * Note `UserProfile` deliberately inverts the pair (visible = absolute date
 * via `formatAbsoluteDate`, `title` = relative age) for the join-date
 * presentation, so it does NOT use this component — adding a `mode` prop
 * would only collapse two near-identical templates into one parameterised
 * one without trimming the call site at all.
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
