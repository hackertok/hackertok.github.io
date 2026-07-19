UPDATE subscriptions
   SET verified_at = 0
 WHERE disabled_at IS NULL
   AND (verified_at IS NULL OR verified_at <> 0);

ALTER TABLE app_state
ADD COLUMN retained_subscription_count INTEGER NOT NULL DEFAULT 0
  CHECK (retained_subscription_count >= 0);

UPDATE app_state
   SET retained_subscription_count = (
     SELECT COUNT(*)
       FROM subscriptions
   )
 WHERE id = 1;

CREATE TRIGGER subscriptions_retained_insert
AFTER INSERT ON subscriptions
BEGIN
  UPDATE app_state
     SET retained_subscription_count = retained_subscription_count + 1
   WHERE id = 1;
END;

CREATE TRIGGER subscriptions_retained_delete
AFTER DELETE ON subscriptions
BEGIN
  UPDATE app_state
     SET retained_subscription_count = MAX(retained_subscription_count - 1, 0)
   WHERE id = 1;
END;

ALTER TABLE deliveries
ADD COLUMN relay_fault_at INTEGER;

ALTER TABLE deliveries
ADD COLUMN relay_fault_reconciled_at INTEGER;

CREATE INDEX deliveries_relay_fault_signals
  ON deliveries(result_class, relay_fault_at, subscription_id)
  WHERE relay_fault_at IS NOT NULL;
