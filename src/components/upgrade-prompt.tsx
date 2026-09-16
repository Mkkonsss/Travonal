/**
 * UpgradePrompt — contextual bottom sheet shown when a usage gate blocks.
 *
 * Shows what the user tried to do, what Plus gives them, and a CTA
 * to the paywall. Dismisses on backdrop tap. Does not re-show in
 * the same session after dismissal for the same feature.
 */

import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Shadow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface UpgradePromptProps {
  visible: boolean;
  /** What the user was trying to do */
  feature: string;
  /** What Plus gives them for this feature */
  title: string;
  description: string;
  /** Icon name (SF Symbols) */
  icon?: string;
  /** Remaining on current tier (shown when > 0 on Plus tier hitting limit) */
  remaining?: number;
  total?: number;
  onClose: () => void;
}

export function UpgradePrompt({
  visible,
  feature,
  title,
  description,
  icon = 'sparkles',
  onClose,
}: UpgradePromptProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  function handleUpgrade() {
    onClose();
    router.push('/travonal-plus' as any);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          entering={FadeInDown.springify().damping(20)}
          style={[
            styles.sheet,
            { backgroundColor: theme.background, paddingBottom: insets.bottom + 16 },
          ]}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            {/* Handle */}
            <View style={[styles.handle, { backgroundColor: theme.border }]} />

            {/* Icon + title */}
            <View style={styles.headerRow}>
              <View style={[styles.iconCircle, { backgroundColor: theme.primaryMuted }]}>
                <SymbolView name={icon as any} size={20} tintColor={theme.primary} />
              </View>
              <View style={styles.headerText}>
                <ThemedText style={styles.title}>{title}</ThemedText>
                <ThemedText style={[styles.description, { color: theme.textSecondary }]}>
                  {description}
                </ThemedText>
              </View>
            </View>

            {/* Plus benefits */}
            <View style={[styles.benefitsCard, { backgroundColor: theme.backgroundElement }]}>
              <Row icon="sparkles" text="AI trip plans — 3 per month" theme={theme} />
              <Row icon="bubble.left.fill" text="AI chat — 50 messages per month" theme={theme} />
              <Row icon="camera.fill" text="Screenshot import" theme={theme} />
              <Row icon="bolt.fill" text="Smart trip fixes with one tap" theme={theme} />
            </View>

            {/* CTA */}
            <Pressable
              onPress={handleUpgrade}
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <ThemedText style={[styles.ctaText, { color: theme.background }]}>
                Upgrade to Travonal+
              </ThemedText>
              <ThemedText style={[styles.ctaPrice, { color: theme.background }]}>
                $39.99/year
              </ThemedText>
            </Pressable>

            {/* Dismiss */}
            <Pressable onPress={onClose} style={styles.dismissBtn}>
              <ThemedText style={[styles.dismissText, { color: theme.textSecondary }]}>
                Not now
              </ThemedText>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function Row({ icon, text, theme }: { icon: string; text: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={styles.benefitRow}>
      <SymbolView name={icon as any} size={14} tintColor={theme.primary} />
      <ThemedText style={[styles.benefitText, { color: theme.text }]}>{text}</ThemedText>
    </View>
  );
}

/**
 * UsageBadge — small inline indicator showing remaining usage.
 * Place next to AI action buttons.
 */
export function UsageBadge({
  remaining,
  total,
  label,
}: {
  remaining: number;
  total: number;
  label?: string;
}) {
  const theme = useTheme();
  const isLow = remaining <= 1;

  return (
    <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText
        style={[
          styles.badgeText,
          { color: isLow ? theme.danger : theme.textSecondary },
        ]}
      >
        {remaining}/{total} {label ?? 'remaining'}
      </ThemedText>
    </View>
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
  headerRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 20,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  benefitsCard: {
    borderRadius: Radius.md,
    padding: 16,
    gap: 12,
    marginBottom: 20,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  benefitText: {
    fontSize: 14,
    fontWeight: '500',
  },
  cta: {
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
  },
  ctaPrice: {
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.8,
  },
  dismissBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  dismissText: {
    fontSize: 14,
  },
  // Usage badge
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.xs,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
