import { BellRing, X } from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { Button } from './ui';

export function PushNotificationOptIn() {
  const {
    status,
    shouldOffer,
    isRepair,
    threshold,
    enable,
    dismiss,
  } = usePushNotifications();

  if (!shouldOffer) return null;
  const enabling = status === 'enabling';
  const action = isRepair ? 'Repair alerts' : 'Enable alerts';

  return (
    <aside
      aria-label="Story notification offer"
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-md items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-card-foreground shadow-lg"
      data-testid="push-notification-opt-in"
    >
      <BellRing aria-hidden className="size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-sm">
        {isRepair
          ? 'Reconnect story alerts'
          : `Get notified when a story passes ${threshold.toLocaleString()} points`}
      </p>
      <Button
        size="sm"
        onClick={enable}
        disabled={enabling}
        aria-busy={enabling}
      >
        {enabling ? 'Enabling…' : action}
      </Button>
      {!enabling && (
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          aria-label="Dismiss notification offer"
          className="size-8 rounded-full text-muted-foreground"
        >
          <X aria-hidden className="size-4" />
        </Button>
      )}
    </aside>
  );
}
