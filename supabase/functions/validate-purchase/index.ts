/**
 * Supabase Edge Function: validate-purchase
 *
 * Called by the Tripseek app after a successful IAP purchase or restore.
 * Checks the purchase with Apple's App Store Server API and upserts the user's
 * subscription record in user_subscriptions (real plan, status and expiry from Apple),
 * so the server-side usage RPCs see the correct plan. Renewals, expiries and refunds
 * arrive later via the app-store-notifications function.
 *
 * Until the In-App Purchase key secrets are set (see _shared/app-store.ts) it falls back
 * to the old unverified behaviour and logs an error — set them before release.
 *
 * DEPLOYMENT:
 *   supabase functions deploy validate-purchase
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
 *
 * REQUEST (POST, authenticated):
 *   { productId: string, transactionId?: string }
 *
 * RESPONSE:
 *   { success: true, plan: 'monthly'|'annual', expires_at: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { appStoreConfig, fetchSubscriptionState } from '../_shared/app-store.ts';
import { ownershipConflict, planForProduct, statusFromApple } from '../_shared/app-store-utils.ts';

const ALLOWED_ORIGINS = [
  'https://tripseekapp.com',
  'https://www.tripseekapp.com',
  'http://localhost:8081',
  'http://localhost:19006',
];

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get('origin') || '';
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return origin || ALLOWED_ORIGINS[0];
  return ALLOWED_ORIGINS[0];
}

function makeCorsHeaders(req: Request) {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(req),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

// Validate required env vars at startup
const _REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const _MISSING_ENV = _REQUIRED_ENV.filter((k) => !Deno.env.get(k));
if (_MISSING_ENV.length > 0) {
  throw new Error('[validate-purchase] Missing required env vars: ' + _MISSING_ENV.join(', '));
}

Deno.serve(async (req: Request) => {
  const corsHeaders = makeCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await anonClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body
    const body = await req.json();
    const { productId, transactionId, auto } = body as {
      productId?: string;
      transactionId?: string;
      auto?: boolean;
    };

    if (!productId || typeof productId !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid productId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map product ID to plan
    const plan = planForProduct(productId);
    if (!plan) {
      return new Response(JSON.stringify({ error: 'Unknown product ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service-role client (bypasses RLS)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Verified path: ask Apple what this purchase really is ──
    const config = appStoreConfig();
    if (config) {
      if (!transactionId || typeof transactionId !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing transactionId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const state = await fetchSubscriptionState(config, transactionId);
      const tx = state?.transaction;
      const verifiedPlan = planForProduct(tx?.productId);
      if (!state || !tx || !verifiedPlan || tx.bundleId !== config.bundleId) {
        return new Response(JSON.stringify({ error: 'Purchase could not be verified with Apple' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // One Apple subscription backs one Tripseek account
      const { data: otherOwner } = await adminClient
        .from('user_subscriptions')
        .select('user_id')
        .eq('original_transaction_id', tx.originalTransactionId)
        .neq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (ownershipConflict({ userId: user.id, appAccountToken: tx.appAccountToken, existingOwnerId: otherOwner?.user_id })) {
        return new Response(JSON.stringify({ error: 'This subscription is linked to another Tripseek account.' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const status = statusFromApple(state.appleStatus);
      const verifiedExpiresAt = tx.expiresDate ? new Date(tx.expiresDate).toISOString() : null;
      const { error: verifiedUpsertError } = await adminClient
        .from('user_subscriptions')
        .upsert(
          {
            user_id: user.id,
            plan: verifiedPlan,
            status,
            store: 'apple',
            product_id: tx.productId,
            original_transaction_id: tx.originalTransactionId,
            expires_at: verifiedExpiresAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
      if (verifiedUpsertError) {
        console.error('[validate-purchase] upsert error:', verifiedUpsertError.message);
        return new Response(JSON.stringify({ error: 'Failed to update subscription' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({ success: true, verified: true, plan: verifiedPlan, status, expires_at: verifiedExpiresAt }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Unverified fallback (no In-App Purchase key configured yet) ──
    console.error('[validate-purchase] APPLE_IAP_* secrets not set — purchase NOT verified with Apple. Set them before release.');

    // Background re-checks are only safe when Apple verifies ownership — without that,
    // one Apple ID's subscription could be attached to every account used on the device.
    if (auto === true) {
      return new Response(JSON.stringify({ success: false, error: 'Verification not configured' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Never downgrade an active annual subscription to monthly.
    // This can happen when StoreKit replays old monthly transactions
    // or restorePurchases sends multiple products.
    if (plan === 'monthly') {
      const { data: existing } = await adminClient
        .from('user_subscriptions')
        .select('plan, status, expires_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing?.plan === 'annual' && existing?.status === 'active' &&
          existing?.expires_at && new Date(existing.expires_at) > new Date()) {
        // Annual is still active — don't overwrite with monthly
        return new Response(
          JSON.stringify({ success: true, plan: existing.plan, expires_at: existing.expires_at }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // Calculate expiry: monthly = +31 days, annual = +366 days
    // (generous buffer; real expiry comes from App Store renewal notifications)
    const now = new Date();
    const expiresAt = new Date(now);
    if (plan === 'monthly') {
      expiresAt.setDate(expiresAt.getDate() + 31);
    } else {
      expiresAt.setDate(expiresAt.getDate() + 366);
    }

    const { error: upsertError } = await adminClient
      .from('user_subscriptions')
      .upsert(
        {
          user_id: user.id,
          plan,
          status: 'active',
          store: 'apple',
          product_id: productId,
          original_transaction_id: transactionId ?? null,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );

    if (upsertError) {
      console.error('[validate-purchase] upsert error:', upsertError.message);
      return new Response(JSON.stringify({ error: 'Failed to update subscription' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        plan,
        expires_at: expiresAt.toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err: unknown) {
    console.error('[validate-purchase]', err instanceof Error ? err.message : 'Unknown error');
    return new Response(JSON.stringify({ error: 'An internal error occurred' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
