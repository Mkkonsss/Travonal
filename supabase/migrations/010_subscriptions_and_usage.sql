-- Travonal+ subscription and usage tracking
--
-- Two tables:
--   user_subscriptions — server-side subscription state (source of truth)
--   usage_ledger       — per-account metered usage counters
--
-- The edge function checks these before executing paid AI actions.
-- Client-side caches display state only; enforcement is here.

-- ─── user_subscriptions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                  TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'monthly', 'annual')),
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'grace_period')),
  store                 TEXT CHECK (store IN ('apple', 'google')),
  product_id            TEXT,
  original_transaction_id TEXT,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: users can read their own subscription; edge function uses service role for writes.
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON user_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- ─── usage_ledger ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_ledger (
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Monthly period key, e.g. '2026-09'. Resets each billing cycle.
  period                TEXT NOT NULL,
  -- AI trip generation
  generations_used      INT NOT NULL DEFAULT 0,
  -- Lifetime generation counter (for free tier: 2 lifetime limit)
  generations_lifetime  INT NOT NULL DEFAULT 0,
  -- Assistance actions (chat, edit, analyze, fix, natural search, rank, enhance)
  assistance_used       INT NOT NULL DEFAULT 0,
  -- Import actions (link, text, screenshot)
  imports_used          INT NOT NULL DEFAULT 0,
  -- Free-tier lifetime import counters (tracked per content type)
  imports_link_lifetime  INT NOT NULL DEFAULT 0,
  imports_text_lifetime  INT NOT NULL DEFAULT 0,
  imports_image_lifetime INT NOT NULL DEFAULT 0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, period)
);

ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage"
  ON usage_ledger FOR SELECT
  USING (auth.uid() = user_id);

-- ─── Helper function: get or create current period ledger ───────────────────

CREATE OR REPLACE FUNCTION get_or_create_usage(p_user_id UUID, p_period TEXT)
RETURNS usage_ledger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result usage_ledger;
BEGIN
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

-- ─── Helper function: check + decrement usage atomically ────────────────────
-- Returns JSON { allowed: bool, remaining: int, reason: text }

CREATE OR REPLACE FUNCTION check_and_use(
  p_user_id UUID,
  p_period TEXT,
  p_category TEXT,       -- 'generation', 'assistance', 'import'
  p_content_type TEXT DEFAULT NULL  -- for imports: 'url', 'text', 'image_base64'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sub user_subscriptions;
  ledger usage_ledger;
  is_plus BOOLEAN;
  limit_val INT;
  used_val INT;
  remaining INT;
BEGIN
  -- Get subscription
  SELECT * INTO sub FROM user_subscriptions WHERE user_id = p_user_id;
  is_plus := sub.plan IS NOT NULL
    AND sub.plan != 'free'
    AND sub.status IN ('active', 'grace_period')
    AND (sub.expires_at IS NULL OR sub.expires_at > NOW());

  -- Get or create ledger
  SELECT * INTO ledger FROM get_or_create_usage(p_user_id, p_period);

  -- Determine limits and current usage
  IF p_category = 'generation' THEN
    IF is_plus THEN
      limit_val := 3;
      used_val := ledger.generations_used;
    ELSE
      -- Free tier: 2 lifetime
      limit_val := 2;
      used_val := ledger.generations_lifetime;
    END IF;
  ELSIF p_category = 'assistance' THEN
    IF is_plus THEN
      limit_val := 50;
      used_val := ledger.assistance_used;
    ELSE
      -- Free tier: 10 chat messages/month (only chat allowed free)
      limit_val := 10;
      used_val := ledger.assistance_used;
    END IF;
  ELSIF p_category = 'import' THEN
    IF is_plus THEN
      limit_val := 10;
      used_val := ledger.imports_used;
    ELSE
      -- Free tier: per content-type lifetime limits
      IF p_content_type = 'image_base64' THEN
        limit_val := 1;
        used_val := ledger.imports_image_lifetime;
      ELSIF p_content_type = 'text' THEN
        limit_val := 2;
        used_val := ledger.imports_text_lifetime;
      ELSE
        -- url
        limit_val := 2;
        used_val := ledger.imports_link_lifetime;
      END IF;
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
        WHEN p_category = 'generation' AND NOT is_plus THEN 'You''ve used both free AI plans. Upgrade to Travonal+ for more.'
        WHEN p_category = 'generation' AND is_plus THEN 'You''ve used all 3 AI plans this month. Resets next billing cycle.'
        WHEN p_category = 'assistance' AND NOT is_plus THEN 'You''ve used your 10 free messages this month. Upgrade for more.'
        WHEN p_category = 'assistance' AND is_plus THEN 'You''ve used all 50 AI actions this month. Resets next billing cycle.'
        WHEN p_category = 'import' AND NOT is_plus THEN 'Upgrade to Travonal+ for more imports.'
        WHEN p_category = 'import' AND is_plus THEN 'You''ve used all 10 imports this month. Resets next billing cycle.'
        ELSE 'Usage limit reached.'
      END
    );
  END IF;

  -- Decrement: update the appropriate counter
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
        imports_link_lifetime = CASE WHEN p_content_type IN ('url', 'text') AND p_content_type = 'url' THEN imports_link_lifetime + 1 ELSE imports_link_lifetime END,
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

-- ─── Helper function: rollback usage on error (error recovery is free) ──────

CREATE OR REPLACE FUNCTION rollback_usage(
  p_user_id UUID,
  p_period TEXT,
  p_category TEXT,
  p_content_type TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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

-- ─── Helper function: get usage summary for client display ──────────────────

CREATE OR REPLACE FUNCTION get_usage_summary(p_user_id UUID, p_period TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sub user_subscriptions;
  ledger usage_ledger;
  is_plus BOOLEAN;
BEGIN
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
        'generations', 3,
        'assistance', 50,
        'imports', 10
      )
    ELSE
      jsonb_build_object(
        'generations_lifetime', 2,
        'assistance', 10,
        'imports_link_lifetime', 2,
        'imports_text_lifetime', 2,
        'imports_image_lifetime', 1
      )
    END
  );
END;
$$;
