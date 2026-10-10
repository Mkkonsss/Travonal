import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User, AuthError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { supabase } from '@/services/supabase';
import { signInWithApple, signInWithGoogle, type SocialAuthError } from '@/services/social-auth';

// Deep link scheme — must match app.json "scheme"
const APP_SCHEME = 'tripseek';
const RESET_REDIRECT = `${APP_SCHEME}://reset-password`;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isRecovery: boolean;
  clearRecovery: () => void;
  signUp: (email: string, password: string, name: string) => Promise<{ error: AuthError | null }>;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signInWithApple: () => Promise<{ error: SocialAuthError }>;
  signInWithGoogle: () => Promise<{ error: SocialAuthError }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);

  // Handle a deep-link URL that may carry a Supabase recovery code.
  // Supabase redirects to: tripseek://reset-password?code=AUTH_CODE (PKCE)
  // or: tripseek://reset-password#access_token=...&type=recovery (implicit)
  async function handleDeepLink(url: string | null) {
    if (!url) return;
    if (!url.startsWith(RESET_REDIRECT)) return;

    // PKCE: ?code=...
    const parsed = Linking.parse(url);
    const code = parsed.queryParams?.code as string | undefined;
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(url);
      if (!error) setIsRecovery(true);
      return;
    }

    // Implicit: #access_token=...&refresh_token=...&type=recovery
    const hash = url.split('#')[1] ?? '';
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (!error) setIsRecovery(true);
    }
  }

  useEffect(() => {
    // Validate session with the server on mount (getUser round-trips to Supabase auth).
    // Falls back to getSession for offline/cached access if getUser fails.
    supabase.auth.getUser().then(({ data: { user }, error }) => {
      if (user && !error) {
        // User is valid — get the full session for token access
        supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
          setLoading(false);
        });
      } else {
        // Invalid or no user — clear session
        setSession(null);
        setLoading(false);
      }
    }).catch(() => {
      // Network error — fall back to cached session
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setLoading(false);
      });
    });

    // Keep session in sync with Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });

    // Handle deep link that was used to launch the app (cold start)
    Linking.getInitialURL().then(handleDeepLink);

    // Handle deep link when app is already running (warm start)
    const linkSub = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));

    return () => {
      subscription.unsubscribe();
      linkSub.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signUp(email: string, password: string, name: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name.trim() } },
    });
    return { error };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: RESET_REDIRECT,
    });
    return { error };
  }

  function clearRecovery() {
    setIsRecovery(false);
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, isRecovery, clearRecovery, signUp, signIn, signInWithApple, signInWithGoogle, signOut, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
