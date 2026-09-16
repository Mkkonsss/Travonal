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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

    // Use the service-role client to perform privileged operations
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Delete user data rows (RLS won't block service-role)
    await adminClient.from('trips').delete().eq('user_id', userId);
    await adminClient.from('profiles').delete().eq('user_id', userId);

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
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
