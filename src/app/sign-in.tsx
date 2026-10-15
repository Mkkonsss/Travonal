import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Radius } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useToast } from '@/context/toast';
import { useTheme } from '@/hooks/use-theme';

const HERO_IMAGE = require('@/assets/images/sign-up-hero.png');

export default function SignInScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { signIn, signInWithApple, resetPassword } = useAuth();
  const { showToast } = useToast();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAppleSignIn() {
    setError(null);
    setSocialLoading('apple');
    const { error, cancelled } = await signInWithApple();
    setSocialLoading(null);
    if (cancelled) return;
    if (error) {
      setError(error.message);
    } else {
      router.replace('/(tabs)');
    }
  }

  async function handleSignIn() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      router.replace('/(tabs)');
    }
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      showToast('Enter your email above first', 'info');
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email.trim());
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      showToast('Password reset link sent to ' + email.trim(), 'success');
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 24) + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          {/* Back button — only shown if there's somewhere to go back to */}
          {navigation.canGoBack() && (
            <Pressable
              onPress={() => router.back()}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={12}
            >
              <View style={styles.backRow}>
                <SymbolView name="chevron.left" size={14} tintColor={theme.textSecondary} />
                <Text style={[styles.backText, { color: theme.textSecondary }]}>Back</Text>
              </View>
            </Pressable>
          )}

          {/* Title + image row */}
          <Animated.View entering={FadeInDown.delay(50).duration(400)} style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.text }]}>Welcome back.</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your trips are waiting.</Text>
            </View>
            <View style={styles.titleImage}>
              {HERO_IMAGE ? (
                <ExpoImage source={HERO_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement }]} />
              )}
            </View>
          </Animated.View>

          {/* Social buttons */}
          <Animated.View entering={FadeInDown.delay(120).duration(400)} style={styles.socialRow}>
            {Platform.OS === 'ios' && (
              <Pressable
                style={({ pressed }) => [styles.appleButton, { backgroundColor: theme.text, opacity: pressed ? 0.85 : 1 }]}
                onPress={handleAppleSignIn}
                disabled={socialLoading !== null || loading}
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
              >
                {socialLoading === 'apple' ? (
                  <ActivityIndicator color={theme.background} size="small" />
                ) : (
                  <>
                    <SymbolView name="apple.logo" size={18} tintColor={theme.background} />
                    <Text style={[styles.appleButtonText, { color: theme.background }]}>Continue with Apple</Text>
                  </>
                )}
              </Pressable>
            )}

          </Animated.View>

          {/* Divider */}
          <Animated.View entering={FadeInDown.delay(180).duration(400)} style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
            <Text style={[styles.dividerText, { color: theme.textSecondary }]}>or</Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
          </Animated.View>

          {/* Fields */}
          <Animated.View entering={FadeInDown.delay(240).duration(400)} style={styles.fields}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
              placeholder="Email address"
              placeholderTextColor={theme.textSecondary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              textContentType="emailAddress"
            />
            <View style={[styles.passwordBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <TextInput
                style={[styles.passwordInput, { color: theme.text }]}
                placeholder="Password"
                placeholderTextColor={theme.textSecondary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                textContentType="password"
                onSubmitEditing={handleSignIn}
              />
              <Pressable
                onPress={() => setShowPassword(!showPassword)}
                style={styles.showHide}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Text style={[styles.showHideText, { color: theme.textSecondary }]}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(300).duration(400)}>
            <Pressable
              onPress={handleForgotPassword}
              style={styles.forgotRow}
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
            >
              <Text style={[styles.forgotText, { color: theme.textSecondary }]}>Forgot password?</Text>
            </Pressable>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.text, opacity: pressed ? 0.88 : 1, marginTop: 16 }]}
              onPress={handleSignIn}
              disabled={loading || socialLoading !== null}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              {loading ? (
                <ActivityIndicator color={theme.background} />
              ) : (
                <Text style={[styles.primaryButtonText, { color: theme.background }]}>Sign in</Text>
              )}
            </Pressable>

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: theme.textSecondary }]}>{"Don't have an account? "}</Text>
              <Pressable
                onPress={() => router.push({ pathname: '/sign-up', params: { fromSignIn: '1' } } as any)}
                accessibilityRole="button"
                accessibilityLabel="Create account"
              >
                <Text style={[styles.footerLink, { color: theme.text }]}>Create account</Text>
              </Pressable>
            </View>
          </Animated.View>
        </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  backButton: {
    alignSelf: 'flex-start',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#9CA3AF',
  },

  content: {
    paddingHorizontal: 28,
    gap: 28,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  titleImage: {
    width: 96,
    height: 96,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    flexShrink: 0,
  },
  imagePlaceholder: {
    backgroundColor: '#F3F4F6',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.8,
    lineHeight: 34,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },

  // Social
  socialRow: {
    gap: 10,
  },
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#111827',
    borderRadius: Radius.md,
    paddingVertical: 15,
  },
  appleButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: -4,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '500',
  },

  // Fields
  fields: {
    gap: 12,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: Radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    color: '#111827',
  },
  passwordBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: Radius.sm,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 15,
    color: '#111827',
  },
  showHide: {
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  showHideText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#9CA3AF',
  },

  forgotRow: {
    alignSelf: 'flex-end',
  },
  forgotText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },

  error: {
    fontSize: 13,
    color: '#EF4444',
    marginTop: 8,
  },

  primaryButton: {
    backgroundColor: '#111827',
    borderRadius: Radius.md,
    paddingVertical: 17,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  footerText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
});
