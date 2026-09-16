import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { Radius } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useToast } from '@/context/toast';

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, resetPassword } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 24) + 16 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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

        <Text style={styles.wordmark}>✦  TRAVONAL</Text>

        <View style={styles.hero}>
          <SymbolView name="hand.wave.fill" size={36} tintColor="#111827" style={styles.heroEmoji} />
          <Text style={styles.heroTitle}>Welcome back.</Text>
          <Text style={styles.heroSubtitle}>
            Sign in to access your trips and profile.
          </Text>
        </View>

        <View style={styles.fields}>
          <TextInput
            style={styles.input}
            placeholder="Email address"
            placeholderTextColor="#9CA3AF"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
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
              onSubmitEditing={handleSignIn}
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
        </View>

        <Pressable
          onPress={handleForgotPassword}
          style={styles.forgotRow}
          accessibilityRole="button"
          accessibilityLabel="Forgot password"
        >
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.88 : 1 }]}
          onPress={handleSignIn}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Sign in</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{"Don't have an account? "}</Text>
          <Pressable
            onPress={() => router.push('/sign-up')}
            accessibilityRole="button"
            accessibilityLabel="Create account"
          >
            <Text style={styles.footerLink}>Create account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  content: {
    paddingHorizontal: 28,
    gap: 24,
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

  wordmark: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3,
    color: '#D1D5DB',
    marginTop: -8,
  },

  hero: {
    gap: 8,
    marginTop: 4,
  },
  heroEmoji: {
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -1.2,
    lineHeight: 42,
  },
  heroSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
  },

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
    marginTop: -12,
  },
  forgotText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
  },

  error: {
    fontSize: 13,
    color: '#EF4444',
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
