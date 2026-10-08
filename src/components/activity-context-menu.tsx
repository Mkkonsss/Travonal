/**
 * ActivityContextMenu — overlay context menu shown on "..." tap.
 *
 * Uses absolute positioning instead of Modal to avoid iOS presentation
 * conflicts with in-app browser (openBrowserAsync / SFSafariViewController).
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/context/trips';
import type { MemoryCategory, TravelMemoryEntry } from '@/context/memory';

export interface ReactionOption {
  label: string;
  icon: string;
  sentiment: 'positive' | 'negative';
  memoryType: TravelMemoryEntry['type'];
  memoryDetail: (activity: Activity) => string;
  memoryCategory: MemoryCategory;
}

const LIKED_REACTIONS: ReactionOption[] = [
  {
    label: 'Loved it',
    icon: 'heart.fill',
    sentiment: 'positive',
    memoryType: 'preference_saved',
    memoryDetail: (a) => `Loved "${a.title}"`,
    memoryCategory: 'preference',
  },
  {
    label: 'Great value',
    icon: 'dollarsign.circle.fill',
    sentiment: 'positive',
    memoryType: 'preference_saved',
    memoryDetail: (a) => `"${a.title}" was great value`,
    memoryCategory: 'budget',
  },
  {
    label: 'Hidden gem',
    icon: 'sparkles',
    sentiment: 'positive',
    memoryType: 'preference_saved',
    memoryDetail: (a) => `"${a.title}" was a hidden gem`,
    memoryCategory: 'discovery',
  },
  {
    label: 'Would return',
    icon: 'arrow.uturn.left.circle.fill',
    sentiment: 'positive',
    memoryType: 'preference_saved',
    memoryDetail: (a) => `Would return to "${a.title}"`,
    memoryCategory: 'preference',
  },
];

const DISLIKED_REACTIONS: ReactionOption[] = [
  {
    label: 'Not my vibe',
    icon: 'hand.raised.fill',
    sentiment: 'negative',
    memoryType: 'activity_skipped',
    memoryDetail: (a) => `Didn't like "${a.title}" — not my vibe`,
    memoryCategory: 'preference',
  },
  {
    label: 'Too touristy',
    icon: 'camera.badge.ellipsis.fill',
    sentiment: 'negative',
    memoryType: 'activity_skipped',
    memoryDetail: (a) => `Found "${a.title}" too touristy`,
    memoryCategory: 'crowds',
  },
  {
    label: 'Too expensive',
    icon: 'dollarsign.circle.fill',
    sentiment: 'negative',
    memoryType: 'activity_skipped',
    memoryDetail: (a) => `Found "${a.title}" too expensive`,
    memoryCategory: 'budget',
  },
  {
    label: 'Too far',
    icon: 'car.fill',
    sentiment: 'negative',
    memoryType: 'activity_skipped',
    memoryDetail: (a) => `"${a.title}" was too far from other activities`,
    memoryCategory: 'logistics',
  },
  {
    label: 'Wrong type',
    icon: 'xmark.circle.fill',
    sentiment: 'negative',
    memoryType: 'activity_skipped',
    memoryDetail: (a) => `Doesn't want ${a.type} activities like "${a.title}"`,
    memoryCategory: 'activity_type',
  },
];

/** @deprecated Use LIKED_REACTIONS / DISLIKED_REACTIONS */
export const REACTIONS = DISLIKED_REACTIONS;

const TYPE_LABELS: Record<Activity['type'], string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  activity: 'Activity',
  food: 'Food',
};

interface ActivityContextMenuProps {
  activity: Activity | null;
  visible: boolean;
  onClose: () => void;
  onBook?: (activity: Activity) => void;
  bookLabel?: string;
  onReplace: (activity: Activity) => void;
  onMove: (activity: Activity) => void;
  onEdit: (activity: Activity) => void;
  onRemove: (activity: Activity) => void;
  onReaction: (activity: Activity, reaction: ReactionOption) => void;
}

export function ActivityContextMenu({
  activity,
  visible,
  onClose,
  onBook,
  bookLabel,
  onReplace,
  onMove,
  onEdit,
  onRemove,
  onReaction,
}: ActivityContextMenuProps) {
  const theme = useTheme();

  if (!visible || !activity) return null;

  function act(fn: (a: Activity) => void) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    fn(activity!);
  }

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={styles.overlay}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
          <Animated.View entering={SlideInDown.duration(250)} style={[styles.sheet, { backgroundColor: theme.background }]}>
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />

            {/* Activity preview */}
            <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.previewInfo}>
                <ThemedText style={styles.previewTitle} numberOfLines={2}>
                  {activity.title}
                </ThemedText>
                <ThemedText style={[styles.previewMeta, { color: theme.textSecondary }]}>
                  {TYPE_LABELS[activity.type]}
                  {activity.cost && activity.cost !== 'free' ? ` \u00B7 ${activity.cost}` : ''}
                </ThemedText>
                {activity.description ? (
                  <ThemedText style={[styles.previewDesc, { color: theme.textSecondary }]} numberOfLines={2}>
                    {activity.description}
                  </ThemedText>
                ) : null}
              </View>
            </View>

            <ScrollView style={styles.actionsScroll} bounces={false}>
              {/* Primary actions */}
              {onBook && (
                <MenuItem
                  icon="link"
                  label={bookLabel ?? 'Find tickets'}
                  color={theme.primary}
                  theme={theme}
                  onPress={() => act(onBook)}
                />
              )}

              <MenuItem
                icon="arrow.triangle.2.circlepath"
                label="Replace"
                theme={theme}
                onPress={() => act(onReplace)}
              />

              <MenuItem
                icon="calendar"
                label="Move"
                theme={theme}
                onPress={() => act(onMove)}
              />

              <MenuItem
                icon="pencil"
                label="Edit"
                theme={theme}
                onPress={() => act(onEdit)}
              />

              <MenuItem
                icon="trash"
                label="Remove"
                color={theme.danger}
                theme={theme}
                onPress={() => act(onRemove)}
              />

              {/* Reactions */}
              <View style={[styles.divider, { backgroundColor: theme.border }]} />
              <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                What'd you think?
              </ThemedText>
              <View style={styles.chipRow}>
                {LIKED_REACTIONS.map((reaction) => (
                  <Pressable
                    key={reaction.label}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onClose();
                      onReaction(activity, reaction);
                    }}
                    style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement }]}
                  >
                    <SymbolView name={reaction.icon as any} size={13} tintColor={theme.primary} />
                    <ThemedText style={[styles.chipLabel, { color: theme.text }]}>{reaction.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.chipRow, { marginTop: 6 }]}>
                {DISLIKED_REACTIONS.map((reaction) => (
                  <Pressable
                    key={reaction.label}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onClose();
                      onReaction(activity, reaction);
                    }}
                    style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement }]}
                  >
                    <SymbolView name={reaction.icon as any} size={13} tintColor={theme.text} />
                    <ThemedText style={[styles.chipLabel, { color: theme.text }]}>{reaction.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function MenuItem({ icon, label, color, theme, onPress }: {
  icon: string;
  label: string;
  color?: string;
  theme: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
      ]}
    >
      <SymbolView name={icon as any} size={18} tintColor={color ?? theme.text} style={styles.menuIcon} />
      <ThemedText style={[styles.menuLabel, color ? { color } : undefined]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: Spacing.three,
  },
  preview: {
    marginHorizontal: Spacing.four,
    borderRadius: Radius.md,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  previewInfo: {
    gap: 4,
  },
  previewTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  previewMeta: {
    fontSize: 13,
  },
  previewDesc: {
    fontSize: 13,
    marginTop: 4,
  },
  actionsScroll: {
    paddingHorizontal: Spacing.four,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    gap: 14,
  },
  menuIcon: {
    width: 24,
    alignItems: 'center' as const,
  },
  menuLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 12,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4, marginBottom: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Radius.full,
  },
  chipLabel: { fontSize: 13, fontWeight: '500' },
});
