import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from './supabase';
import type { AuthError } from '@supabase/supabase-js';

// Required for expo-auth-session to properly close the browser after OAuth
WebBrowser.maybeCompleteAuthSession();

export type SocialAuthError = AuthError | Error | null;
export type SocialAuthResult = { error: SocialAuthError; cancelled?: boolean };

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
export async function signInWithApple(): Promise<SocialAuthResult> {
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
    // User tapped Cancel — not an error, but not a success either
    if (err?.code === 'ERR_REQUEST_CANCELED') return { error: null, cancelled: true };
    return { error: err instanceof Error ? err : new Error('Apple sign-in failed') };
  }
}

/**
 * Google Sign In — iOS + Android.
 * Opens a browser-based OAuth implicit flow via Supabase, which
 * returns session tokens directly in the redirect URL fragment.
 *
 * Setup required:
 *   1. Google Cloud Console → create OAuth 2.0 Web Client ID
 *   2. Add authorized redirect URI:
 *      https://<your-project>.supabase.co/auth/v1/callback
 *   3. Supabase Dashboard → Auth → Providers → Google → enable,
 *      paste Web Client ID + Secret
 */
export async function signInWithGoogle(): Promise<SocialAuthResult> {
  try {
    const redirectUri = makeRedirectUri({ scheme: 'tripseek', path: 'auth/callback' });

    // Use Supabase's authorize endpoint directly with implicit flow (no PKCE).
    // The PKCE flow's deferred code exchange fails on mobile with
    // "unable to exchange external code"; the implicit flow makes Supabase
    // exchange Google's code immediately during the callback and return
    // session tokens in the URL fragment instead.
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
    const oauthUrl =
      `${supabaseUrl}/auth/v1/authorize?provider=google` +
      `&redirect_to=${encodeURIComponent(redirectUri)}`;

    const result = await WebBrowser.openAuthSessionAsync(oauthUrl, redirectUri);

    if (result.type === 'success') {
      // Split URL into query and fragment — avoid new URL() which can fail with custom schemes in Hermes
      const [urlBeforeHash, hashString] = result.url.split('#');
      const [, queryString] = urlBeforeHash.split('?');
      const params = new URLSearchParams(queryString ?? '');

      // Surface OAuth errors from the redirect (e.g. redirect URL not whitelisted)
      const oauthError = params.get('error_description') || params.get('error');
      if (oauthError) return { error: new Error(oauthError) };

      // Implicit flow: tokens in URL fragment (#access_token=...&refresh_token=...)
      if (hashString) {
        const hashParams = new URLSearchParams(hashString);
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          return { error: sessionError };
        }
      }

      return { error: new Error('No session tokens in redirect URL') };
    }

    // User dismissed the browser — not an error, but not a success either
    return { error: null, cancelled: true };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Google sign-in failed') };
  }
}
