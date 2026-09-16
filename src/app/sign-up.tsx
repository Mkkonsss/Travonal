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

export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSignUp() {
    if (!email.trim() || !password) return;
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (!agreedToTerms) {
      setError('Please agree to the Terms and Conditions');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await signUp(email.trim(), password);
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setDone(true);
    }
  }

  if (done) {
    return (
      <View style={[styles.root, styles.doneRoot, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        <SymbolView name="envelope.open.fill" size={48} tintColor="#111827" style={styles.doneEmoji} />
        <Text style={styles.doneTitle}>Check your email</Text>
        <Text style={styles.doneSubtitle}>
          We sent a confirmation link to {email}. Click it to activate your account, then sign in.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.88 : 1, marginTop: 32 }]}
          onPress={() => router.replace('/sign-in')}
          accessibilityRole="button"
          accessibilityLabel="Go to sign in"
        >
          <Text style={styles.primaryButtonText}>Go to sign in</Text>
        </Pressable>
      </View>
    );
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
          <SymbolView name="airplane" size={36} tintColor="#111827" style={styles.heroEmoji} />
          <Text style={styles.heroTitle}>One last step.</Text>
          <Text style={styles.heroSubtitle}>
            Create a free account to save your profile and access your trips from any device.
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
        </View>

        <Pressable
          onPress={() => setAgreedToTerms(!agreedToTerms)}
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
          style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.88 : 1 }]}
          onPress={handleSignUp}
          disabled={loading}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  doneRoot: {
    paddingHorizontal: 28,
    justifyContent: 'center',
  },
  doneEmoji: {
    marginBottom: 20,
  },
  doneTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
    marginBottom: 10,
  },
  doneSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
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

  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: -8,
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
    marginTop: -8,
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
