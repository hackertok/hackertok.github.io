PRAGMA foreign_keys = ON;

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  endpoint_hash TEXT UNIQUE,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT,
  vapid_key_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER NOT NULL,
  last_reconciled_at INTEGER NOT NULL,
  expires_at INTEGER,
  disabled_at INTEGER,
  disabled_reason TEXT,
  tombstone_until INTEGER,
  CHECK (
    (disabled_at IS NULL AND endpoint_hash IS NOT NULL AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL)
    OR disabled_at IS NOT NULL
  )
);

CREATE INDEX subscriptions_active_id
  ON subscriptions(id)
  WHERE disabled_at IS NULL;

CREATE INDEX subscriptions_tombstone_cleanup
  ON subscriptions(tombstone_until)
  WHERE disabled_at IS NOT NULL;

CREATE TABLE stories (
  story_id INTEGER PRIMARY KEY,
  title TEXT,
  score INTEGER,
  hn_created_at INTEGER,
  verified_at INTEGER,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  verification_state TEXT NOT NULL DEFAULT 'candidate'
    CHECK (verification_state IN ('candidate', 'seeded', 'event')),
  last_verification_error TEXT,
  next_check_at INTEGER,
  event_state TEXT NOT NULL DEFAULT 'none'
    CHECK (event_state IN ('none', 'fanout_pending', 'fanout_active', 'fanout_complete')),
  audience_high_water_id INTEGER,
  fanout_cursor INTEGER NOT NULL DEFAULT 0,
  fanout_lease_token TEXT,
  fanout_lease_expires_at INTEGER,
  fanout_wake_at INTEGER,
  event_created_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (story_id > 0)
);

CREATE INDEX stories_recheck
  ON stories(next_check_at, story_id)
  WHERE verification_state = 'candidate';

CREATE INDEX stories_fanout_recovery
  ON stories(event_state, fanout_wake_at, story_id)
  WHERE event_state IN ('fanout_pending', 'fanout_active');

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL REFERENCES stories(story_id) ON DELETE RESTRICT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'leased', 'retry', 'accepted', 'terminal', 'paused')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  wake_at INTEGER,
  lease_token TEXT,
  lease_expires_at INTEGER,
  relay_status INTEGER,
  result_class TEXT,
  accepted_at INTEGER,
  terminal_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (story_id, subscription_id)
);

CREATE INDEX deliveries_recovery
  ON deliveries(state, next_attempt_at, wake_at, id)
  WHERE state IN ('pending', 'retry', 'leased');

CREATE INDEX deliveries_subscription
  ON deliveries(subscription_id, id);

CREATE INDEX deliveries_cleanup
  ON deliveries(terminal_at, id)
  WHERE state IN ('accepted', 'terminal');

CREATE TABLE app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phase TEXT NOT NULL CHECK (phase IN ('BOOTSTRAPPING', 'ACTIVE')),
  bootstrap_from INTEGER,
  bootstrap_to INTEGER,
  bootstrap_page INTEGER NOT NULL DEFAULT 0,
  bootstrap_total_pages INTEGER,
  detector_lease_token TEXT,
  detector_lease_expires_at INTEGER,
  delivery_circuit_until INTEGER,
  delivery_circuit_reason TEXT,
  last_successful_scan_at INTEGER,
  cleanup_cursor INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

INSERT INTO app_state (id, phase, updated_at)
VALUES (1, 'BOOTSTRAPPING', unixepoch() * 1000);
