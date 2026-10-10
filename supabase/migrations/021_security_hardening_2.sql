-- Migration 021: Security Hardening Pass 2
-- Fixes remaining RLS gaps found in security audit:
--   1. trips UPDATE policy missing WITH CHECK
--   2. gmail_connections ALL policy missing WITH CHECK
--   3. merge_user_settings / merge_user_trip_chat SECURITY DEFINER without auth.uid() check
--   4. auth_user_trip_ids() missing SET search_path

-- ============================================================================
-- 1. trips — add WITH CHECK to UPDATE policy to prevent ownership transfer
-- ============================================================================

DROP POLICY IF EXISTS "Owners and editors can update trips" ON trips;
CREATE POLICY "Owners and editors can update trips" ON trips
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR id IN (
      SELECT trip_id FROM trip_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'member')
    )
  );

-- Trigger to prevent ownership transfer (WITH CHECK can't reference OLD values)
CREATE OR REPLACE FUNCTION prevent_trip_ownership_transfer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id != OLD.user_id THEN
    RAISE EXCEPTION 'Cannot transfer trip ownership';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_prevent_ownership_transfer ON trips;
CREATE TRIGGER trips_prevent_ownership_transfer
  BEFORE UPDATE ON trips
  FOR EACH ROW
  EXECUTE FUNCTION prevent_trip_ownership_transfer();

-- ============================================================================
-- 2. gmail_connections — replace FOR ALL with explicit policies including WITH CHECK
-- ============================================================================

DROP POLICY IF EXISTS "Users can manage own connection" ON gmail_connections;

CREATE POLICY "Users can select own gmail connection" ON gmail_connections
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own gmail connection" ON gmail_connections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own gmail connection" ON gmail_connections
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own gmail connection" ON gmail_connections
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 3. merge_user_settings — add auth.uid() verification
-- ============================================================================

CREATE OR REPLACE FUNCTION merge_user_settings(p_user_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO user_settings (user_id, data, updated_at)
  VALUES (p_user_id, p_patch, now())
  ON CONFLICT (user_id) DO UPDATE
    SET data = user_settings.data || p_patch,
        updated_at = now();
END;
$$;

-- ============================================================================
-- 4. merge_user_trip_chat — add auth.uid() verification
-- ============================================================================

CREATE OR REPLACE FUNCTION merge_user_trip_chat(p_user_id uuid, p_trip_id text, p_threads jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO user_trip_chats (user_id, chats, updated_at)
  VALUES (p_user_id, jsonb_build_object(p_trip_id, p_threads), now())
  ON CONFLICT (user_id) DO UPDATE
    SET chats = user_trip_chats.chats || jsonb_build_object(p_trip_id, p_threads),
        updated_at = now();
END;
$$;

-- ============================================================================
-- 5. auth_user_trip_ids — add SET search_path for safety
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_user_trip_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT trip_id FROM trip_members WHERE user_id = auth.uid()
$$;
