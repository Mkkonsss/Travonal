import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Use expo-secure-store on native (Keychain/Keystore) for session tokens.
// Fall back to AsyncStorage on web where SecureStore is unavailable.
const secureStorage = Platform.OS === 'web'
  ? AsyncStorage
  : {
      getItem: (key: string) => SecureStore.getItemAsync(key),
      setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
      removeItem: (key: string) => SecureStore.deleteItemAsync(key),
    };

// The anon key is intentionally public — security is enforced by Row Level Security policies.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStorage,
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
