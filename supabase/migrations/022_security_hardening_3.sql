-- Migration 022: Security Hardening Pass 3
-- Fixes remaining security audit findings:
--   1. Enable RLS on discovery_feed_cursors (was never enabled)
--   2. Fix overly permissive discovery_device_history policies
--   3. Add SET search_path to advance_feed_cursor and migrate_device_to_user
--   4. Harden advance_feed_cursor_device with SET search_path
--
-- All sections are guarded with IF EXISTS so this is safe to run even if
-- the discovery tables haven't been created yet.

-- ============================================================================
-- 1. discovery_feed_cursors — enable RLS + add scoped policies
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'discovery_feed_cursors') THEN
    ALTER TABLE discovery_feed_cursors ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users can read own feed cursors"
      ON discovery_feed_cursors FOR SELECT
      USING (user_id = auth.uid() OR user_id IS NULL);

    CREATE POLICY "Users can insert own feed cursors"
      ON discovery_feed_cursors FOR INSERT
      WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

    CREATE POLICY "Users can update own feed cursors"
      ON discovery_feed_cursors FOR UPDATE
      USING (user_id = auth.uid() OR user_id IS NULL)
      WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

    CREATE POLICY "Users can delete own feed cursors"
      ON discovery_feed_cursors FOR DELETE
      USING (user_id = auth.uid() OR user_id IS NULL);
  END IF;
END
$$;

-- ============================================================================
-- 2. discovery_device_history — replace overly permissive policies
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'discovery_device_history') THEN
    DROP POLICY IF EXISTS "Authenticated users can read device history" ON discovery_device_history;
    DROP POLICY IF EXISTS "Authenticated users can insert device history" ON discovery_device_history;
    DROP POLICY IF EXISTS "Authenticated users can delete device history" ON discovery_device_history;
    -- RLS stays enabled with no policies — only service_role can access
  END IF;
END
$$;

-- ============================================================================
-- 3. Harden advance_feed_cursor — add SET search_path
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'discovery_feed_cursors') THEN
    EXECUTE $fn$
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
      SET search_path = public
      AS $body$
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
      $body$;
    $fn$;
  END IF;
END
$$;

-- ============================================================================
-- 4. Harden advance_feed_cursor_device — add SET search_path
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'discovery_feed_cursors') THEN
    EXECUTE $fn$
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
      SET search_path = public
      AS $body$
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
      $body$;
    $fn$;
  END IF;
END
$$;

-- ============================================================================
-- 5. Harden migrate_device_to_user — add SET search_path + auth check
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'discovery_device_history') THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION migrate_device_to_user(
        p_device_id TEXT,
        p_user_id UUID
      )
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      BEGIN
        -- Verify caller is the target user (or service role)
        IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
          RAISE EXCEPTION 'Unauthorized: cannot migrate device to another user';
        END IF;

        -- Migrate device history into user history
        INSERT INTO discovery_user_history (user_id, place_id, first_shown_at)
        SELECT p_user_id, place_id, first_shown_at
        FROM discovery_device_history
        WHERE device_id = p_device_id
        ON CONFLICT (user_id, place_id) DO NOTHING;

        -- Remove migrated device history
        DELETE FROM discovery_device_history WHERE device_id = p_device_id;

        -- Migrate viewed events
        UPDATE discovery_viewed
        SET user_id = p_user_id, device_id = NULL
        WHERE device_id = p_device_id AND user_id IS NULL;

        -- Transfer any device feed cursors to the user
        UPDATE discovery_feed_cursors
        SET user_id = p_user_id, device_id = NULL
        WHERE device_id = p_device_id AND user_id IS NULL;
      END;
      $body$;
    $fn$;
  END IF;
END
$$;
