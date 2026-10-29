/**
 * AIConsentProvider — shows the "Turn on Tripseek AI" sheet when the user first uses an AI
 * feature, and exposes the choice to the app (Guideline 5.1.2(i)).
 *
 * The sheet only ever appears right after the user taps something that uses AI, or turns
 * Tripseek AI on in Settings. Background AI is skipped quietly until they agree.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { PRIVACY_POLICY_URL } from '@/constants/legal';
import { Radius, Shadow, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import {
  type AIConsent,
  getAIConsent,
  loadAIConsent,
  onAIConsentChange,
  registerAIConsentRequester,
  setAIConsent,
} from '@/services/ai-consent';

interface AIConsentContextType {
  consent: AIConsent;
  /** Shows the consent sheet if needed. Resolves true when AI may be used. */
  requestConsent: () => Promise<boolean>;
  /** Turn AI off (Settings). Turning it on goes through requestConsent so the user sees the disclosure. */
  turnOff: () => Promise<void>;
}

const AIConsentContext = createContext<AIConsentContextType | null>(null);

export function AIConsentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [consent, setConsentState] = useState<AIConsent>(getAIConsent());
  const [visible, setVisible] = useState(false);
  const pending = useRef<Promise<boolean> | null>(null);
  const resolvePending = useRef<((granted: boolean) => void) | null>(null);

  useEffect(() => onAIConsentChange(setConsentState), []);

  // Consent is personal — reload it whenever a different account signs in
  useEffect(() => {
    loadAIConsent(user?.id);
  }, [user?.id]);

  const requestConsent = useCallback((): Promise<boolean> => {
    if (getAIConsent() === 'granted') return Promise.resolve(true);
    if (pending.current) return pending.current;
    pending.current = new Promise<boolean>((resolve) => {
      resolvePending.current = resolve;
      setVisible(true);
    });
    return pending.current;
  }, []);

  useEffect(() => registerAIConsentRequester(requestConsent), [requestConsent]);

  const finish = useCallback(async (granted: boolean) => {
    setVisible(false);
    await setAIConsent(granted);
    resolvePending.current?.(granted);
    resolvePending.current = null;
    pending.current = null;
  }, []);

  const turnOff = useCallback(() => setAIConsent(false), []);

  return (
    <AIConsentContext.Provider value={{ consent, requestConsent, turnOff }}>
      {children}
      <AIConsentSheet visible={visible} onAllow={() => finish(true)} onNotNow={() => finish(false)} />
    </AIConsentContext.Provider>
  );
}

export function useAIConsent(): AIConsentContextType {
  const ctx = useContext(AIConsentContext);
  if (!ctx) throw new Error('useAIConsent must be used within AIConsentProvider');
  return ctx;
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

function AIConsentSheet({ visible, onAllow, onNotNow }: { visible: boolean; onAllow: () => void; onNotNow: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onNotNow}>
      <Pressable style={styles.backdrop} onPress={onNotNow} accessibilityLabel="Not now">
        <Animated.View
          entering={FadeInDown.springify().damping(20)}
          style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 16 }]}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />

            <View style={[styles.iconWrap, { backgroundColor: theme.primaryMuted }]}>
              <SymbolView name="sparkles" size={26} tintColor={theme.primary} />
            </View>

            <ThemedText style={styles.title}>Turn on Tripseek AI</ThemedText>
            <ThemedText style={[styles.body, { color: theme.textSecondary }]}>
              Tripseek AI plans your trips, answers your messages, reads the links and screenshots you import, and
              pulls details from booking emails you forward. To do this, that content, along with relevant trip
              details, your travel preferences (like dietary or accessibility needs) and, for nearby suggestions,
              your location, is processed by our AI provider, Anthropic.
            </ThemedText>
            <Pressable
              onPress={() => PRIVACY_POLICY_URL && Linking.openURL(PRIVACY_POLICY_URL)}
              accessibilityRole="link"
              hitSlop={8}
            >
              <ThemedText style={[styles.learnMore, { color: theme.primary }]}>Learn more</ThemedText>
            </Pressable>
            <ThemedText style={[styles.footnote, { color: theme.textSecondary }]}>
              You can turn this off anytime in Settings.
            </ThemedText>

            <Pressable
              onPress={onAllow}
              style={({ pressed }) => [styles.allow, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
            >
              <ThemedText style={[styles.allowText, { color: theme.background }]}>Allow</ThemedText>
            </Pressable>
            <Pressable onPress={onNotNow} style={styles.notNow} accessibilityRole="button">
              <ThemedText style={[styles.notNowText, { color: theme.textSecondary }]}>Not now</ThemedText>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 8,
    paddingHorizontal: Spacing.four,
    ...Shadow.strong,
    shadowColor: '#000',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  learnMore: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  footnote: { fontSize: 13, lineHeight: 18, marginBottom: 20 },
  allow: {
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  allowText: { fontSize: 16, fontWeight: '700' },
  notNow: { alignItems: 'center', paddingVertical: 10 },
  notNowText: { fontSize: 14 },
});
