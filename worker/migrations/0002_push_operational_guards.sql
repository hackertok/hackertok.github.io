ALTER TABLE app_state
ADD COLUMN queue_publishing_paused INTEGER NOT NULL DEFAULT 0
  CHECK (queue_publishing_paused IN (0, 1));

ALTER TABLE app_state
ADD COLUMN active_subscription_count INTEGER NOT NULL DEFAULT 0
  CHECK (active_subscription_count >= 0);

UPDATE app_state
   SET active_subscription_count = (
     SELECT COUNT(*)
       FROM subscriptions
      WHERE disabled_at IS NULL
   )
 WHERE id = 1;

CREATE TRIGGER subscriptions_active_insert
AFTER INSERT ON subscriptions
WHEN NEW.disabled_at IS NULL
BEGIN
  UPDATE app_state
     SET active_subscription_count = active_subscription_count + 1
   WHERE id = 1;
END;

CREATE TRIGGER subscriptions_active_disable
AFTER UPDATE OF disabled_at ON subscriptions
WHEN OLD.disabled_at IS NULL AND NEW.disabled_at IS NOT NULL
BEGIN
  UPDATE app_state
     SET active_subscription_count = MAX(active_subscription_count - 1, 0)
   WHERE id = 1;
END;

CREATE TRIGGER subscriptions_active_enable
AFTER UPDATE OF disabled_at ON subscriptions
WHEN OLD.disabled_at IS NOT NULL AND NEW.disabled_at IS NULL
BEGIN
  UPDATE app_state
     SET active_subscription_count = active_subscription_count + 1
   WHERE id = 1;
END;

CREATE TRIGGER subscriptions_active_delete
AFTER DELETE ON subscriptions
WHEN OLD.disabled_at IS NULL
BEGIN
  UPDATE app_state
     SET active_subscription_count = MAX(active_subscription_count - 1, 0)
   WHERE id = 1;
END;
