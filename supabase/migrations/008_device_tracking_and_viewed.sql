-- Phase 4 + 5: Device tracking for signed-out users + viewed tracking
--
-- Phase 4: Allows signed-out users to get non-repeating feeds via a stable
-- device_id. On sign-in, device history is migrated to the authenticated user.
--
-- Phase 5: Distinguishes "served" (sent by server) from "viewed" (actually seen
-- by the user for ≥1s at ≥60% visibility). Viewed events provide stronger
-- behavioral signals than served-but-possibly-skipped events.

-- ─── discovery_device_history ────────────────────────────────────────────────
-- Mirrors discovery_user_history but keyed on device_id instead of user_id.
-- Used for signed-out feed exclusion. Merged into user_history on sign-in.

CREATE TABLE IF NOT EXISTS discovery_device_history (
  device_id    TEXT NOT NULL,
  place_id     TEXT NOT NULL,
  first_shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_id, place_id)
);

CREATE INDEX IF NOT EXISTS idx_device_history_device
  ON discovery_device_history (device_id);

-- ─── Extend discovery_feed_cursors for signed-out users ─────────────────────
-- Allow NULL user_id + add device_id column for signed-out cursor ownership.

ALTER TABLE discovery_feed_cursors ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE discovery_feed_cursors ADD COLUMN IF NOT EXISTS device_id TEXT;

-- Drop the old user-only unique index and replace with one that handles both
DROP INDEX IF EXISTS idx_feed_cursors_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_cursors_identity
  ON discovery_feed_cursors (
    COALESCE(user_id::text, device_id),
    mode,
    COALESCE(destination, '__worldwide__')
  );

-- Update advance_feed_cursor to accept device_id as alternative to user_id
CREATE OR REPLACE FUNCTION advance_feed_cursor(
  p_cursor_id UUID,
  p_user_id UUID,
  p_advance INT
)
RETURNS TABLE(
  old_position INT,
  new_position INT,
  total_items INT,
  is_recycled BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row discovery_feed_cursors%ROWTYPE;
BEGIN
  UPDATE discovery_feed_cursors
  SET cursor_position = cursor_position + p_advance
  WHERE id = p_cursor_id
    AND (user_id = p_user_id OR (user_id IS NULL AND p_user_id IS NULL))
    AND expires_at > NOW()
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  old_position  := v_row.cursor_position - p_advance;
  new_position  := v_row.cursor_position;
  total_items   := COALESCE(array_length(v_row.ranked_ids, 1), 0);
  is_recycled   := v_row.recycled;
  RETURN NEXT;
END;
$$;

-- Device-based cursor advance (for signed-out users)
CREATE OR REPLACE FUNCTION advance_feed_cursor_device(
  p_cursor_id UUID,
  p_device_id TEXT,
  p_advance INT
)
RETURNS TABLE(
  old_position INT,
  new_position INT,
  total_items INT,
  is_recycled BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row discovery_feed_cursors%ROWTYPE;
BEGIN
  UPDATE discovery_feed_cursors
  SET cursor_position = cursor_position + p_advance
  WHERE id = p_cursor_id
    AND device_id = p_device_id
    AND user_id IS NULL
    AND expires_at > NOW()
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  old_position  := v_row.cursor_position - p_advance;
  new_position  := v_row.cursor_position;
  total_items   := COALESCE(array_length(v_row.ranked_ids, 1), 0);
  is_recycled   := v_row.recycled;
  RETURN NEXT;
END;
$$;

-- ─── discovery_viewed ────────────────────────────────────────────────────────
-- Records places the user actually viewed (≥60% visible for ≥1 second).
-- Stronger signal than discovery_user_history (which tracks served places).

CREATE TABLE IF NOT EXISTS discovery_viewed (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID,                              -- NULL for signed-out users
  device_id    TEXT,                               -- set for signed-out users
  place_id     TEXT NOT NULL,
  dwell_ms     INT4,                               -- how long the card was visible
  category     TEXT,                                -- discovery_cat for analysis
  viewed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT viewed_has_identity CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_viewed_user
  ON discovery_viewed (user_id, viewed_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_viewed_device
  ON discovery_viewed (device_id, viewed_at DESC)
  WHERE device_id IS NOT NULL;

-- Unique: one view record per user/device + place (upsert updates dwell_ms)
CREATE UNIQUE INDEX IF NOT EXISTS idx_viewed_user_place
  ON discovery_viewed (user_id, place_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_viewed_device_place
  ON discovery_viewed (device_id, place_id)
  WHERE device_id IS NOT NULL;

-- ─── Migrate device history to user on sign-in ──────────────────────────────
-- Called once when a signed-out user authenticates. Copies device history
-- into user history, then deletes the device records.

CREATE OR REPLACE FUNCTION migrate_device_to_user(
  p_device_id TEXT,
  p_user_id UUID
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  migrated INT;
BEGIN
  -- Migrate device history → user history
  INSERT INTO discovery_user_history (user_id, place_id, first_shown_at)
  SELECT p_user_id, place_id, first_shown_at
  FROM discovery_device_history
  WHERE device_id = p_device_id
  ON CONFLICT (user_id, place_id) DO NOTHING;

  GET DIAGNOSTICS migrated = ROW_COUNT;

  -- Migrate viewed events
  UPDATE discovery_viewed
  SET user_id = p_user_id, device_id = NULL
  WHERE device_id = p_device_id AND user_id IS NULL;

  -- Transfer device cursors to user
  UPDATE discovery_feed_cursors
  SET user_id = p_user_id, device_id = NULL
  WHERE device_id = p_device_id AND user_id IS NULL;

  -- Clean up device history
  DELETE FROM discovery_device_history WHERE device_id = p_device_id;

  RETURN migrated;
END;
$$;
