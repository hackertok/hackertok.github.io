import { StateView } from './StateView';

interface PollOptionNotSupportedProps {
  action?: { label: string; to?: string; onClick?: () => void };
  className?: string;
}

/** The notice's heading, and the tab title while it shows. */
export const POLL_OPTION_TITLE = "Poll options aren't supported";

/** Shown in place of a poll option (see `isPollOption`). */
export function PollOptionNotSupported({ action, className }: PollOptionNotSupportedProps) {
  return (
    <StateView
      variant="empty"
      title={POLL_OPTION_TITLE}
      description="This item is an option in a Hacker News poll. HackerTok shows polls, but not their options."
      action={action}
      className={className}
    />
  );
}
