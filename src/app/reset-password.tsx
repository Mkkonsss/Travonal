import { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Radius } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useToast } from '@/context/toast';
import { supabase } from '@/services/supabase';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { clearRecovery } = useAuth();
  const { showToast } = useToast();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<TextInput>(null);

  async function handleSave() {
    setError(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    clearRecovery();
    showToast('Password updated successfully', 'success');
    router.replace('/(tabs)');
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
        {/* Back */}
        <Pressable
          onPress={() => { clearRecovery(); router.replace('/sign-in'); }}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={12}
        >
          <View style={styles.backRow}>
            <SymbolView name="chevron.left" size={14} tintColor="#9CA3AF" />
            <Text style={styles.backText}>Cancel</Text>
          </View>
        </Pressable>

        {/* Header */}
        <Animated.View entering={FadeInDown.delay(50).duration(400)}>
          <Text style={styles.title}>New password.</Text>
          <Text style={styles.subtitle}>Choose a new password for your account.</Text>
        </Animated.View>

        {/* Fields */}
        <Animated.View entering={FadeInDown.delay(120).duration(400)} style={styles.fields}>
          <View style={styles.passwordBox}>
            <TextInput
              style={styles.passwordInput}
              placeholder="New password"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="next"
              textContentType="newPassword"
              onSubmitEditing={() => confirmRef.current?.focus()}
              autoFocus
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

          <TextInput
            ref={confirmRef}
            style={styles.input}
            placeholder="Confirm new password"
            placeholderTextColor="#9CA3AF"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!showPassword}
            returnKeyType="done"
            textContentType="newPassword"
            onSubmitEditing={handleSave}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(180).duration(400)}>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.primaryButton, { opacity: pressed ? 0.88 : 1 }]}
            onPress={handleSave}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Save new password"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save new password</Text>
            )}
          </Pressable>
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
  content: {
    paddingHorizontal: 28,
    gap: 28,
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
    paddingHorizontal: 14,
    paddingVertical: 15,
  },
  showHideText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  error: {
    fontSize: 14,
    color: '#EF4444',
    marginBottom: 8,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: '#111827',
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
});
