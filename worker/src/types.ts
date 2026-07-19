export type Bindings = Env & {
  VAPID_PRIVATE_JWK: string;
};

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface SubscriptionRow {
  id: number;
  token_hash: string;
  endpoint_hash: string | null;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  vapid_key_id: string;
  created_at: number;
  activated_at: number;
  last_reconciled_at: number;
  expires_at: number | null;
  disabled_at: number | null;
  disabled_reason: string | null;
  tombstone_until: number | null;
}

export interface AppStateRow {
  phase: 'BOOTSTRAPPING' | 'ACTIVE';
  bootstrap_from: number | null;
  bootstrap_to: number | null;
  bootstrap_page: number;
  bootstrap_total_pages: number | null;
  detector_lease_token: string | null;
  detector_lease_expires_at: number | null;
  delivery_circuit_until: number | null;
  delivery_circuit_reason: string | null;
  queue_publishing_paused: 0 | 1;
  active_subscription_count: number;
  last_successful_scan_at: number | null;
  cleanup_cursor: number;
}

export interface StoryRow {
  story_id: number;
  title: string | null;
  score: number | null;
  hn_created_at: number | null;
  verified_at: number | null;
  verification_attempts: number;
  verification_state: 'candidate' | 'seeded' | 'event';
  last_verification_error: string | null;
  next_check_at: number | null;
  event_state: 'none' | 'fanout_pending' | 'fanout_active' | 'fanout_complete';
  audience_high_water_id: number | null;
  fanout_cursor: number;
  fanout_lease_token: string | null;
  fanout_lease_expires_at: number | null;
  fanout_wake_at: number | null;
  event_created_at: number | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DeliveryRow {
  id: number;
  story_id: number;
  subscription_id: number;
  state: 'pending' | 'leased' | 'retry' | 'accepted' | 'terminal' | 'paused';
  attempts: number;
  next_attempt_at: number;
  wake_at: number | null;
  lease_token: string | null;
  lease_expires_at: number | null;
  relay_status: number | null;
  result_class: string | null;
  accepted_at: number | null;
  terminal_at: number | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface FanoutMessage {
  kind: 'fanout';
  storyId: number;
}

export interface DeliveryMessage {
  kind: 'delivery';
  deliveryId: number;
}

export type WorkerQueueMessage = FanoutMessage | DeliveryMessage;

export interface AlertPayload {
  version: 1;
  id: number;
  title: string;
  score: number;
}
