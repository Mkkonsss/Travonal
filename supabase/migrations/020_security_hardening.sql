-- 020_security_hardening.sql
-- Security fixes identified during security audit.
--
-- Fixes:
--   1. Enable RLS on discovery_device_history and discovery_viewed
--   2. Add WITH CHECK to UPDATE policies on 11 tables
--   3. Drop overly permissive photo_cache INSERT/UPDATE policies
--   4. Restrict trip_members INSERT to trip owners
--   5. Add auth.uid() verification + search_path to SECURITY DEFINER functions

-- ─── 1. Enable RLS on discovery tables (if they exist) ───────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'discovery_device_history') THEN
    ALTER TABLE discovery_device_history ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Authenticated users can read device history"
      ON discovery_device_history FOR SELECT
      USING (auth.uid() IS NOT NULL);

    CREATE POLICY "Authenticated users can insert device history"
      ON discovery_device_history FOR INSERT
      WITH CHECK (auth.uid() IS NOT NULL);

    CREATE POLICY "Authenticated users can delete device history"
      ON discovery_device_history FOR DELETE
      USING (auth.uid() IS NOT NULL);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'discovery_viewed') THEN
    ALTER TABLE discovery_viewed ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "Users can read own viewed history"
      ON discovery_viewed FOR SELECT
      USING (user_id = auth.uid());

    CREATE POLICY "Users can insert own viewed history"
      ON discovery_viewed FOR INSERT
      WITH CHECK (user_id = auth.uid());

    CREATE POLICY "Users can delete own viewed history"
      ON discovery_viewed FOR DELETE
      USING (user_id = auth.uid());
  END IF;
END
$$;


-- ─── 2. Add WITH CHECK to UPDATE policies ─────────────────────────────────────
-- Prevents users from changing user_id on their rows to transfer ownership.

-- profiles
DROP POLICY IF EXISTS "users can update own profile" ON profiles;
CREATE POLICY "users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- parsed_bookings
DROP POLICY IF EXISTS "Users can update own parsed bookings" ON parsed_bookings;
CREATE POLICY "Users can update own parsed bookings"
  ON parsed_bookings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_boards
DROP POLICY IF EXISTS "Users can update own boards" ON user_boards;
CREATE POLICY "Users can update own boards"
  ON user_boards FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_saved_places
DROP POLICY IF EXISTS "Users can update own saved places" ON user_saved_places;
CREATE POLICY "Users can update own saved places"
  ON user_saved_places FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_standalone_bookings
DROP POLICY IF EXISTS "Users can update own standalone bookings" ON user_standalone_bookings;
CREATE POLICY "Users can update own standalone bookings"
  ON user_standalone_bookings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_chat
DROP POLICY IF EXISTS "Users can update own chat" ON user_chat;
CREATE POLICY "Users can update own chat"
  ON user_chat FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_settings
DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;
CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_trip_chats
DROP POLICY IF EXISTS "Users can update own trip chats" ON user_trip_chats;
CREATE POLICY "Users can update own trip chats"
  ON user_trip_chats FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_pulse_history
DROP POLICY IF EXISTS "Users can update own pulse history" ON user_pulse_history;
CREATE POLICY "Users can update own pulse history"
  ON user_pulse_history FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- trip_members
DROP POLICY IF EXISTS "Users can claim invites and update their own membership" ON trip_members;
CREATE POLICY "Users can claim invites and update their own membership"
  ON trip_members FOR UPDATE
  USING (user_id IS NULL OR user_id = auth.uid())
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- user_identities
DROP POLICY IF EXISTS "Users can update their own identity" ON user_identities;
CREATE POLICY "Users can update their own identity"
  ON user_identities FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ─── 3. Drop overly permissive photo_cache INSERT/UPDATE policies ─────────────
-- Service role bypasses RLS automatically, so these WITH CHECK (true) policies
-- just grant public write access to anyone. Remove them.

DROP POLICY IF EXISTS "service role can insert photo cache" ON photo_cache;
DROP POLICY IF EXISTS "service role can update photo cache" ON photo_cache;


-- ─── 4. Restrict trip_members INSERT to trip owners ───────────────────────────
-- Previously any authenticated user could insert a membership row for any trip.

DROP POLICY IF EXISTS "Authenticated users can create invite codes" ON trip_members;
CREATE POLICY "Trip owners can create invite codes"
  ON trip_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = trip_id
        AND trips.user_id = auth.uid()
    )
  );


-- ─── 5. Harden SECURITY DEFINER functions ─────────────────────────────────────
-- Add auth.uid() verification so users can only call these for themselves.
-- Add SET search_path = public to prevent search path injection.

-- Note: These functions are called from edge functions with service role,
-- where auth.uid() returns NULL. We allow service-role callers by checking
-- if auth.uid() IS NULL (service role) OR matches the passed user ID.

CREATE OR REPLACE FUNCTION get_or_create_usage(p_user_id UUID, p_period TEXT)
RETURNS usage_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result usage_ledger;
BEGIN
  -- Allow service role (auth.uid() is NULL) or the user themselves
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s usage';
  END IF;

  SELECT * INTO result FROM usage_ledger WHERE user_id = p_user_id AND period = p_period;
  IF NOT FOUND THEN
    INSERT INTO usage_ledger (user_id, period)
    VALUES (p_user_id, p_period)
    ON CONFLICT (user_id, period) DO NOTHING;
    SELECT * INTO result FROM usage_ledger WHERE user_id = p_user_id AND period = p_period;
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION check_and_use(
  p_user_id UUID,
  p_period TEXT,
  p_category TEXT,
  p_content_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub user_subscriptions;
  ledger usage_ledger;
  is_plus BOOLEAN;
  limit_val INT;
  used_val INT;
  remaining INT;
BEGIN
  -- Allow service role (auth.uid() is NULL) or the user themselves
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RETURN jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'Unauthorized');
  END IF;

  SELECT * INTO sub FROM user_subscriptions WHERE user_id = p_user_id;
  is_plus := sub.plan IS NOT NULL
    AND sub.plan != 'free'
    AND sub.status IN ('active', 'grace_period')
    AND (sub.expires_at IS NULL OR sub.expires_at > NOW());

  SELECT * INTO ledger FROM get_or_create_usage(p_user_id, p_period);

  IF p_category = 'generation' THEN
    IF is_plus THEN
      limit_val := 5;
      used_val := ledger.generations_used;
    ELSE
      limit_val := 1;
      used_val := ledger.generations_used;
    END IF;
  ELSIF p_category = 'assistance' THEN
    IF is_plus THEN
      limit_val := 100;
      used_val := ledger.assistance_used;
    ELSE
      limit_val := 20;
      used_val := ledger.assistance_used;
    END IF;
  ELSIF p_category = 'import' THEN
    IF is_plus THEN
      limit_val := 15;
      used_val := ledger.imports_used;
    ELSE
      limit_val := 3;
      used_val := ledger.imports_used;
    END IF;
  ELSE
    RETURN jsonb_build_object('allowed', false, 'remaining', 0, 'reason', 'Unknown category');
  END IF;

  remaining := limit_val - used_val;

  IF remaining <= 0 THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'total', limit_val,
      'is_plus', is_plus,
      'reason', CASE
        WHEN p_category = 'generation' AND NOT is_plus THEN 'You''ve used your free trip plan this month. Upgrade for more.'
        WHEN p_category = 'generation' AND is_plus THEN 'You''ve used all 5 AI plans this month. Resets next billing cycle.'
        WHEN p_category = 'assistance' AND NOT is_plus THEN 'You''ve used your 20 free AI messages this month. Upgrade for 100 per month.'
        WHEN p_category = 'assistance' AND is_plus THEN 'You''ve used all 100 AI messages this month. Resets next billing cycle.'
        WHEN p_category = 'import' AND NOT is_plus THEN 'Upgrade to Tripseek+ to import more places from links & photos.'
        WHEN p_category = 'import' AND is_plus THEN 'You''ve added all 15 places this month. Resets next billing cycle.'
        ELSE 'Usage limit reached.'
      END
    );
  END IF;

  IF p_category = 'generation' THEN
    UPDATE usage_ledger
    SET generations_used = generations_used + 1,
        generations_lifetime = generations_lifetime + 1,
        updated_at = NOW()
    WHERE user_id = p_user_id AND period = p_period;
  ELSIF p_category = 'assistance' THEN
    UPDATE usage_ledger
    SET assistance_used = assistance_used + 1,
        updated_at = NOW()
    WHERE user_id = p_user_id AND period = p_period;
  ELSIF p_category = 'import' THEN
    UPDATE usage_ledger
    SET imports_used = imports_used + 1,
        imports_link_lifetime = CASE WHEN p_content_type = 'url' THEN imports_link_lifetime + 1 ELSE imports_link_lifetime END,
        imports_text_lifetime = CASE WHEN p_content_type = 'text' THEN imports_text_lifetime + 1 ELSE imports_text_lifetime END,
        imports_image_lifetime = CASE WHEN p_content_type = 'image_base64' THEN imports_image_lifetime + 1 ELSE imports_image_lifetime END,
        updated_at = NOW()
    WHERE user_id = p_user_id AND period = p_period;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', remaining - 1,
    'total', limit_val,
    'is_plus', is_plus
  );
END;
$$;

CREATE OR REPLACE FUNCTION rollback_usage(
  p_user_id UUID,
  p_period TEXT,
  p_category TEXT,
  p_content_type TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service role (auth.uid() is NULL) or the user themselves
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot modify another user''s usage';
  END IF;

  IF p_category = 'generation' THEN
    UPDATE usage_ledger
    SET generations_used = GREATEST(generations_used - 1, 0),
        generations_lifetime = GREATEST(generations_lifetime - 1, 0),
        updated_at = NOW()
    WHERE user_id = p_user_id AND period = p_period;
  ELSIF p_category = 'assistance' THEN
    UPDATE usage_ledger
    SET assistance_used = GREATEST(assistance_used - 1, 0),
        updated_at = NOW()
    WHERE user_id = p_user_id AND period = p_period;
  ELSIF p_category = 'import' THEN
    UPDATE usage_ledger
    SET imports_used = GREATEST(imports_used - 1, 0),
        imports_link_lifetime = CASE WHEN p_content_type = 'url' THEN GREATEST(imports_link_lifetime - 1, 0) ELSE imports_link_lifetime END,
        imports_text_lifetime = CASE WHEN p_content_type = 'text' THEN GREATEST(imports_text_lifetime - 1, 0) ELSE imports_text_lifetime END,
        imports_image_lifetime = CASE WHEN p_content_type = 'image_base64' THEN GREATEST(imports_image_lifetime - 1, 0) ELSE imports_image_lifetime END,
        updated_at = NOW()
    WHERE user_id = p_user_id AND period = p_period;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_usage_summary(p_user_id UUID, p_period TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sub user_subscriptions;
  ledger usage_ledger;
  is_plus BOOLEAN;
BEGIN
  -- Allow service role (auth.uid() is NULL) or the user themselves
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot access another user''s usage summary';
  END IF;

  SELECT * INTO sub FROM user_subscriptions WHERE user_id = p_user_id;
  is_plus := sub.plan IS NOT NULL
    AND sub.plan != 'free'
    AND sub.status IN ('active', 'grace_period')
    AND (sub.expires_at IS NULL OR sub.expires_at > NOW());

  SELECT * INTO ledger FROM get_or_create_usage(p_user_id, p_period);

  RETURN jsonb_build_object(
    'is_plus', is_plus,
    'plan', COALESCE(sub.plan, 'free'),
    'status', COALESCE(sub.status, 'active'),
    'expires_at', sub.expires_at,
    'period', p_period,
    'generations_used', ledger.generations_used,
    'generations_lifetime', ledger.generations_lifetime,
    'assistance_used', ledger.assistance_used,
    'imports_used', ledger.imports_used,
    'imports_link_lifetime', ledger.imports_link_lifetime,
    'imports_text_lifetime', ledger.imports_text_lifetime,
    'imports_image_lifetime', ledger.imports_image_lifetime,
    'limits', CASE WHEN is_plus THEN
      jsonb_build_object(
        'generations', 5,
        'assistance', 100,
        'imports', 15
      )
    ELSE
      jsonb_build_object(
        'generations', 1,
        'assistance', 20,
        'imports', 3
      )
    END
  );
END;
$$;
