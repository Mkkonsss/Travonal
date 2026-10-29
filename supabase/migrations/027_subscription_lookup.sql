-- App Store Server Notifications identify a subscription by its original transaction ID;
-- index it so renewals, expiries and refunds can find the account quickly.
CREATE INDEX IF NOT EXISTS user_subscriptions_original_transaction_idx
  ON user_subscriptions (original_transaction_id);
