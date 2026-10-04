-- User data sync tables: boards, saved places (inbox), and standalone bookings.
-- All use a simple JSONB blob keyed by user_id, matching the pattern used by memory.

-- ─── boards ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_boards (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own boards"
  ON user_boards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own boards"
  ON user_boards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own boards"
  ON user_boards FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own boards"
  ON user_boards FOR DELETE
  USING (auth.uid() = user_id);

-- ─── saved places (inbox) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_saved_places (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_saved_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own saved places"
  ON user_saved_places FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own saved places"
  ON user_saved_places FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saved places"
  ON user_saved_places FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved places"
  ON user_saved_places FOR DELETE
  USING (auth.uid() = user_id);

-- ─── standalone bookings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_standalone_bookings (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_standalone_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own standalone bookings"
  ON user_standalone_bookings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own standalone bookings"
  ON user_standalone_bookings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own standalone bookings"
  ON user_standalone_bookings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own standalone bookings"
  ON user_standalone_bookings FOR DELETE
  USING (auth.uid() = user_id);
