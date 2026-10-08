-- 018_fix_usage_limits.sql
-- Sync usage limits to match product marketing:
--   Plus:  5 generations/mo, 100 assistance/mo, 15 imports/mo
--   Free:  1 generation/mo,  20 assistance/mo,  3 imports/mo

-- ─── check_and_use ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_and_use(
  p_user_id UUID,
  p_period TEXT,
  p_category TEXT,
  p_content_type TEXT DEFAULT NULL
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

-- ─── get_usage_summary ───────────────────────────────────────────────────────

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
