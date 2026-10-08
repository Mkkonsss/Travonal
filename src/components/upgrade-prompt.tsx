/**
 * UpgradePrompt — contextual bottom sheet shown when a usage gate blocks.
 *
 * Same layout for every feature — image, title, description, CTA.
 * Content adapts based on the `feature` prop.
 */

import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, Shadow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// ─── Feature content map ─────────────────────────────────────────────────────

const FEATURE_CONTENT: Record<string, { image: any; title: string; desc: string }> = {
  generate_trip: {
    image: require('@/assets/images/icon-chat-empty.png'),
    title: 'More AI trip plans',
    desc: 'Get 5 AI-powered itineraries every month with Tripseek+.',
  },
  chat: {
    image: require('@/assets/images/plus-feature-chat.png'),
    title: 'More AI messages',
    desc: 'Get 100 AI messages per month to plan the perfect trip.',
  },
  edit_trip: {
    image: require('@/assets/images/plus-feature-chat.png'),
    title: 'AI trip editing',
    desc: 'Let AI restructure your itinerary based on your instructions.',
  },
  analyze_trip: {
    image: require('@/assets/images/icon-chat-empty.png'),
    title: 'Trip analysis',
    desc: 'Get a detailed breakdown of your trip\'s pacing, variety, and budget.',
  },
  natural_search: {
    image: require('@/assets/images/icon-chat-empty.png'),
    title: 'Natural language search',
    desc: 'Search for activities in plain English — "a cozy cafe near the museum".',
  },
  import_place: {
    image: require('@/assets/images/plus-feature-import.png'),
    title: 'Import more places',
    desc: 'Add up to 15 places from links & photos every month with Tripseek+.',
  },
  export_pdf: {
    image: require('@/assets/images/icon-chat-empty.png'),
    title: 'Export your itinerary',
    desc: 'Save or print your trip as a PDF with Tripseek+.',
  },
  offline_trip: {
    image: require('@/assets/images/plus-feature-offline.png'),
    title: 'Offline trip access',
    desc: 'Download your trip to access it anywhere — no internet needed.',
  },
};

const DEFAULT_CONTENT = {
  image: require('@/assets/images/icon-chat-empty.png'),
  title: 'Upgrade to Tripseek+',
  desc: 'Your trips taken to the next level.',
};

// ─── Component ───────────────────────────────────────────────────────────────

export interface UpgradePromptProps {
  visible: boolean;
  feature: string;
  title?: string;
  description?: string;
  icon?: string;
  remaining?: number;
  total?: number;
  onClose: () => void;
}

export function UpgradePrompt({
  visible,
  feature,
  title,
  description,
  onClose,
}: UpgradePromptProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const content = FEATURE_CONTENT[feature] ?? DEFAULT_CONTENT;
  const displayTitle = title ?? content.title;
  const displayDesc = description ?? content.desc;

  function handleUpgrade() {
    onClose();
    router.push('/toveli-plus' as any);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          entering={FadeInDown.springify().damping(20)}
          style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 16 }]}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            {/* Handle */}
            <View style={[styles.handle, { backgroundColor: theme.border }]} />

            {/* Feature image */}
            <View style={styles.imageWrap}>
              <Image source={content.image} style={styles.featureImage} contentFit="contain" />
            </View>

            {/* Title + description */}
            <ThemedText style={styles.title}>{displayTitle}</ThemedText>
            <ThemedText style={[styles.desc, { color: theme.textSecondary }]}>{displayDesc}</ThemedText>

            {/* CTA */}
            <Pressable
              onPress={handleUpgrade}
              style={({ pressed }) => [styles.cta, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <ThemedText style={[styles.ctaText, { color: theme.background }]}>Upgrade to Tripseek+</ThemedText>
              <ThemedText style={[styles.ctaPrice, { color: theme.background }]}>$4.99/month</ThemedText>
            </Pressable>

            {/* Dismiss */}
            <Pressable onPress={onClose} style={styles.dismissBtn}>
              <ThemedText style={[styles.dismissText, { color: theme.textSecondary }]}>Not now</ThemedText>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ─── UsageBadge ──────────────────────────────────────────────────────────────

export function UsageBadge({ remaining, total, label }: { remaining: number; total: number; label?: string }) {
  const theme = useTheme();
  const isLow = remaining <= 1;
  return (
    <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={[styles.badgeText, { color: isLow ? theme.danger : theme.textSecondary }]}>
        {remaining}/{total} {label ?? 'remaining'}
      </ThemedText>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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
  imageWrap: {
    width: '100%',
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  featureImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  desc: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
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
  ctaText: { fontSize: 16, fontWeight: '700' },
  ctaPrice: { fontSize: 14, fontWeight: '500', opacity: 0.8 },
  dismissBtn: { alignItems: 'center', paddingVertical: 10 },
  dismissText: { fontSize: 14 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.xs,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
});
