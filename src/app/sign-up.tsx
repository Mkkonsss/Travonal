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
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { Image as ExpoImage } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Radius } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useToast } from '@/context/toast';

const HERO_IMAGE = require('@/assets/images/sign-up-hero.png');

export default function SignUpScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { fromSignIn } = useLocalSearchParams<{ fromSignIn?: string }>();
  const insets = useSafeAreaInsets();
  const { signUp, signInWithApple } = useAuth();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
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

  async function handleSignUp() {
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!email.trim() || !password) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!agreedToTerms) {
      setError('Please agree to the Terms and Conditions');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await signUp(email.trim(), password, name);
    setLoading(false);
    if (error) {
      setError(error.message);
    } else if (fromSignIn === '1') {
      router.replace({ pathname: '/onboarding', params: { survey: '1' } } as any);
    } else {
      router.replace('/(tabs)');
    }
  }

  return (
    <View style={styles.root}>
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
                <SymbolView name="chevron.left" size={14} tintColor="#9CA3AF" />
                <Text style={styles.backText}>Back</Text>
              </View>
            </Pressable>
          )}

          {/* Title + image row */}
          <Animated.View entering={FadeInDown.delay(50).duration(400)} style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>One last step.</Text>
              <Text style={styles.subtitle}>
                Free to join. Your trips, anywhere.
              </Text>
            </View>
            <View style={styles.titleImage}>
              {HERO_IMAGE ? (
                <ExpoImage source={HERO_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.imagePlaceholder]} />
              )}
            </View>
          </Animated.View>

          {/* Social buttons */}
          <Animated.View entering={FadeInDown.delay(120).duration(400)} style={styles.socialRow}>
            {Platform.OS === 'ios' && (
              <Pressable
                style={({ pressed }) => [styles.appleButton, { opacity: pressed ? 0.85 : 1 }]}
                onPress={handleAppleSignIn}
                disabled={socialLoading !== null || loading}
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
              >
                {socialLoading === 'apple' ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <SymbolView name="apple.logo" size={18} tintColor="#FFFFFF" />
                    <Text style={styles.appleButtonText}>Continue with Apple</Text>
                  </>
                )}
              </Pressable>
            )}

          </Animated.View>

          {/* Divider */}
          <Animated.View entering={FadeInDown.delay(180).duration(400)} style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </Animated.View>

          {/* Email / password fields */}
          <Animated.View entering={FadeInDown.delay(240).duration(400)} style={styles.fields}>
            <TextInput
              style={styles.input}
              placeholder="Your name"
              placeholderTextColor="#9CA3AF"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              returnKeyType="next"
              textContentType="name"
            />
            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor="#9CA3AF"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              textContentType="emailAddress"
            />
            <View style={styles.passwordBox}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Password"
                placeholderTextColor="#9CA3AF"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                textContentType="newPassword"
                onSubmitEditing={handleSignUp}
              />
              <Pressable
                onPress={() => setShowPassword(!showPassword)}
                style={styles.showHide}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              >
                <Text style={styles.showHideText}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(300).duration(400)}>
            <Pressable
              onPress={() => { setAgreedToTerms(!agreedToTerms); if (error) setError(null); }}
              style={styles.termsRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreedToTerms }}
            >
              <View style={[styles.checkbox, agreedToTerms && styles.checkboxActive]}>
                {agreedToTerms && <SymbolView name="checkmark" size={10} tintColor="#FFFFFF" />}
              </View>
              <Text style={styles.termsText}>
                {'I agree to the '}
                <Text style={styles.termsLink}>Terms and Conditions</Text>
              </Text>
            </Pressable>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.88 : 1, marginTop: 16 }]}
              onPress={handleSignUp}
              disabled={loading || socialLoading !== null}
              accessibilityRole="button"
              accessibilityLabel="Create account"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Create account</Text>
              )}
            </Pressable>

            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <Pressable
                onPress={() => router.replace('/sign-in')}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                <Text style={styles.footerLink}>Sign in</Text>
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

  // Terms
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    flexShrink: 0,
  },
  checkboxActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  termsText: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
  },
  termsLink: {
    color: '#111827',
    fontWeight: '600',
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
