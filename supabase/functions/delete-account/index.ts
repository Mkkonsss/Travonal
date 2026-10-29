/**
 * Supabase Edge Function: delete-account
 *
 * Deletes the currently authenticated user's auth record and all associated
 * data (trips, profile rows) using the service-role key.
 *
 * DEPLOYMENT REQUIREMENTS:
 *   1. Deploy this function via `supabase functions deploy delete-account`
 *   2. Set the SUPABASE_SERVICE_ROLE_KEY secret:
 *        supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
 *   3. The SUPABASE_URL secret is automatically injected by the runtime.
 *
 * The service-role key must never be exposed client-side.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SignJWT, importPKCS8 } from 'https://deno.land/x/jose@v5.2.2/index.ts';

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

// Validate required env vars at startup — fail fast
const _REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const _MISSING_ENV = _REQUIRED_ENV.filter((k) => !Deno.env.get(k));
if (_MISSING_ENV.length > 0) {
  throw new Error("[delete-account] Missing required env vars: " + _MISSING_ENV.join(", "));
}

/**
 * Revoke the user's Sign in with Apple tokens — Apple requires this when an account that
 * uses Sign in with Apple is deleted. The app sends a fresh authorization code; we exchange
 * it for a refresh token and revoke that.
 *
 * Needs secrets (Apple Developer → Keys → a key with Sign in with Apple enabled):
 *   APPLE_SIWA_KEY_ID, APPLE_SIWA_PRIVATE_KEY (.p8 contents), APPLE_TEAM_ID
 *   APPLE_BUNDLE_ID (optional, defaults to com.tripseek.app)
 * Best effort: deletion goes ahead even if Apple can't be reached.
 */
async function revokeAppleSignIn(authorizationCode: string): Promise<void> {
  const keyId = Deno.env.get('APPLE_SIWA_KEY_ID');
  const privateKey = Deno.env.get('APPLE_SIWA_PRIVATE_KEY');
  const teamId = Deno.env.get('APPLE_TEAM_ID') ?? Deno.env.get('APPLE_WEATHER_TEAM_ID');
  const clientId = Deno.env.get('APPLE_BUNDLE_ID') ?? 'com.tripseek.app';
  if (!keyId || !privateKey || !teamId) {
    console.error('[delete-account] Sign in with Apple secrets not set — could not revoke Apple tokens');
    return;
  }

  const key = await importPKCS8(privateKey.replace(/\\n/g, '\n'), 'ES256');
  const now = Math.floor(Date.now() / 1000);
  const clientSecret = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setAudience('https://appleid.apple.com')
    .setSubject(clientId)
    .sign(key);

  const tokenResp = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResp.ok) {
    console.error('[delete-account] Apple token exchange failed:', tokenResp.status);
    return;
  }
  const tokens = await tokenResp.json() as { refresh_token?: string; access_token?: string };
  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) return;

  const revokeResp = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      token,
      token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
    }),
  });
  if (!revokeResp.ok) {
    console.error('[delete-account] Apple token revoke failed:', revokeResp.status);
  }
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
    // Validate the caller is authenticated using the anon key header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use the user's JWT to identify who is requesting deletion
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

    const userId = user.id;

    // Revoke Sign in with Apple first (needs the code the app just got from Apple)
    const body = await req.json().catch(() => ({})) as { appleAuthorizationCode?: string };
    if (typeof body.appleAuthorizationCode === 'string' && body.appleAuthorizationCode) {
      try {
        await revokeAppleSignIn(body.appleAuthorizationCode);
      } catch (err) {
        console.error('[delete-account] Apple revoke error:', err instanceof Error ? err.message : 'Unknown error');
      }
    }

    // Use the service-role client to perform privileged operations
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Delete user data rows (RLS won't block service-role)
    await adminClient.from('trips').delete().eq('user_id', userId);
    await adminClient.from('profiles').delete().eq('id', userId);

    // Delete the auth user itself
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      throw deleteError;
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    console.error('[delete-account]', err instanceof Error ? err.message : 'Unknown error');
    return new Response(JSON.stringify({ error: 'An internal error occurred' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
