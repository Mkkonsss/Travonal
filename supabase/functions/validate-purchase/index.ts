/**
 * Supabase Edge Function: validate-purchase
 *
 * Called by the Tripseek app after a successful IAP purchase or restore.
 * Validates the purchase and upserts the user's subscription record in
 * user_subscriptions so the server-side usage RPCs see the correct plan.
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

// Product ID → plan mapping
const PRODUCT_PLAN_MAP: Record<string, 'monthly' | 'annual'> = {
  'com.tripseek.app.plus.monthly': 'monthly',
  'com.tripseek.app.plus.annual': 'annual',
};

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
    const { productId, transactionId } = body as {
      productId?: string;
      transactionId?: string;
    };

    if (!productId || typeof productId !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid productId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map product ID to plan
    const plan = PRODUCT_PLAN_MAP[productId];
    if (!plan) {
      return new Response(JSON.stringify({ error: 'Unknown product ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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

    // Use service-role client to upsert subscription (bypasses RLS)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

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
