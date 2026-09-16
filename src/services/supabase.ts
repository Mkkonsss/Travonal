import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// AsyncStorage is used as the session store (Supabase's recommended approach for Expo).
// The anon key is intentionally public — security is enforced by Row Level Security policies.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Permanently delete the authenticated user's account.
 *
 * This calls the `delete-account` Edge Function which uses the service-role
 * key server-side to remove the auth user and all associated data.
 * The service-role key is never exposed client-side.
 *
 * Requires the function to be deployed:
 *   supabase functions deploy delete-account
 * And the secret to be set:
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<key>
 */
export async function deleteAccount(): Promise<{ error: Error | null }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { error: new Error('Not signed in') };

    const url = `${supabaseUrl}/functions/v1/delete-account`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return { error: new Error(body.error ?? `Delete failed: ${response.status}`) };
    }

    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Unknown error') };
  }
}
