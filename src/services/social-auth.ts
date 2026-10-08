import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from './supabase';
import type { AuthError } from '@supabase/supabase-js';

// Required for expo-auth-session to properly close the browser after OAuth
WebBrowser.maybeCompleteAuthSession();

export type SocialAuthError = AuthError | Error | null;

/**
 * Apple Sign In — iOS only.
 * Uses expo-apple-authentication to get an identity token,
 * then exchanges it with Supabase for a session.
 *
 * Setup required:
 *   1. Supabase Dashboard → Auth → Providers → Apple → enable
 *   2. Apple Developer → App ID → enable "Sign In with Apple" capability
 *   3. Apple Developer → create Services ID + Key, add to Supabase
 */
export async function signInWithApple(): Promise<{ error: SocialAuthError }> {
  if (Platform.OS !== 'ios') {
    return { error: new Error('Apple Sign In is only available on iOS') };
  }

  try {
    // Lazy import so Android bundle doesn't include the module
    const AppleAuth = await import('expo-apple-authentication');
    const credential = await AppleAuth.signInAsync({
      requestedScopes: [
        AppleAuth.AppleAuthenticationScope.FULL_NAME,
        AppleAuth.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) {
      return { error: new Error('Apple did not return an identity token') };
    }

    // Build the full name from Apple credential (only provided on first sign-in)
    const fullName = [
      credential.fullName?.givenName,
      credential.fullName?.familyName,
    ]
      .filter(Boolean)
      .join(' ');

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      options: fullName ? { data: { full_name: fullName } } : undefined,
    });

    return { error };
  } catch (err: any) {
    // User tapped Cancel — not an error
    if (err?.code === 'ERR_REQUEST_CANCELED') return { error: null };
    return { error: err instanceof Error ? err : new Error('Apple sign-in failed') };
  }
}

/**
 * Google Sign In — iOS + Android.
 * Opens a browser-based OAuth flow via Supabase, then exchanges
 * the returned code for a session.
 *
 * Setup required:
 *   1. Google Cloud Console → create OAuth 2.0 Web Client ID
 *   2. Add authorized redirect URI:
 *      https://<your-project>.supabase.co/auth/v1/callback
 *   3. Supabase Dashboard → Auth → Providers → Google → enable,
 *      paste Web Client ID + Secret
 */
export async function signInWithGoogle(): Promise<{ error: SocialAuthError }> {
  try {
    const redirectUri = makeRedirectUri({ scheme: 'tripseek', path: 'auth/callback' });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUri,
        skipBrowserRedirect: true,
      },
    });

    if (error) return { error };
    if (!data.url) return { error: new Error('No OAuth URL returned from Supabase') };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

    if (result.type === 'success') {
      const { error: sessionError } = await supabase.auth.exchangeCodeForSession(result.url);
      return { error: sessionError };
    }

    // User dismissed the browser — not an error
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Google sign-in failed') };
  }
}
