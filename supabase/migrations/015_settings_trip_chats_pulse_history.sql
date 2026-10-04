-- user_settings: flat JSONB blob of preferences per user.
-- Uses a merge RPC so each source (TripPulse, Memory, Profile) can patch
-- its own keys without overwriting keys set by other sources.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings"
  ON user_settings FOR DELETE
  USING (auth.uid() = user_id);

-- Merge-patch RPC: insert on first write, then shallow-merge JSONB on update.
-- This lets TripPulseProvider push { tripPulseEnabled: true } without clobbering
-- { learningEnabled: false } written by MemoryProvider.
CREATE OR REPLACE FUNCTION merge_user_settings(p_user_id UUID, p_patch JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_settings (user_id, data, updated_at)
  VALUES (p_user_id, p_patch, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET data       = user_settings.data || p_patch,
        updated_at = NOW();
END;
$$;

-- user_trip_chats: per-trip AI edit-chat threads, stored as a tripId → threads map.
-- Uses a merge RPC so saving one trip's threads doesn't overwrite another trip's.

CREATE TABLE IF NOT EXISTS user_trip_chats (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  chats      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_trip_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own trip chats"
  ON user_trip_chats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own trip chats"
  ON user_trip_chats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trip chats"
  ON user_trip_chats FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own trip chats"
  ON user_trip_chats FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION merge_user_trip_chat(p_user_id UUID, p_trip_id TEXT, p_threads JSONB)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_trip_chats (user_id, chats, updated_at)
  VALUES (p_user_id, jsonb_build_object(p_trip_id, p_threads), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET chats      = user_trip_chats.chats || jsonb_build_object(p_trip_id, p_threads),
        updated_at = NOW();
END;
$$;

-- user_pulse_history: pulse alert lifecycle entries per user.

CREATE TABLE IF NOT EXISTS user_pulse_history (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_pulse_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own pulse history"
  ON user_pulse_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own pulse history"
  ON user_pulse_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pulse history"
  ON user_pulse_history FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pulse history"
  ON user_pulse_history FOR DELETE
  USING (auth.uid() = user_id);
