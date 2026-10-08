/**
 * Activity Actions Menu — visible ••• button + reaction options.
 *
 * Combines quick reactions with replacement in one flow:
 * - "Replace" → triggers smart replace
 * - "What'd you think?" → liked/disliked chips that save memory signals
 */

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
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

interface ActivityActionsMenuProps {
  activity: Activity;
  tripDestination: string;
  onReplace: (activity: Activity) => void;
  onReaction: (activity: Activity, reaction: ReactionOption) => void;
  onMove?: (activity: Activity) => void;
  onEdit?: (activity: Activity) => void;
  onBook?: (activity: Activity) => void;
  bookLabel?: string;
  externalOpen?: boolean;
  onExternalClose?: () => void;
}

export function ActivityActionsMenu({
  activity,
  onReplace,
  onReaction,
  onMove,
  onEdit,
  onBook,
  bookLabel,
  externalOpen,
  onExternalClose,
}: ActivityActionsMenuProps) {
  const theme = useTheme();
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = internalOpen || !!externalOpen;
  const isLocked = !!(activity.locked || activity.fixed);

  function close() {
    setInternalOpen(false);
    onExternalClose?.();
  }

  function handleReaction(reaction: ReactionOption) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    close();
    onReaction(activity, reaction);
  }

  function handleReplace() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    close();
    onReplace(activity);
  }

  return (
    <>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setInternalOpen(true);
        }}
        hitSlop={8}
        style={styles.triggerBtn}
        accessibilityRole="button"
        accessibilityLabel={`More actions for ${activity.title}`}
      >
        <ThemedText style={[styles.triggerText, { color: theme.textSecondary }]}>{'\u2022\u2022\u2022'}</ThemedText>
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            <View style={styles.handle} />
            <ThemedText style={styles.sheetTitle} numberOfLines={1}>{activity.title}</ThemedText>

            {/* Primary actions */}
            {onBook && (
              <Pressable onPress={() => { close(); onBook(activity); }} style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? theme.backgroundElement : 'transparent' }]}>
                <SymbolView name="link" size={18} tintColor={theme.primary} style={styles.menuIcon} />
                <ThemedText style={[styles.menuLabel, { color: theme.primary }]}>{bookLabel ?? 'Book'}</ThemedText>
              </Pressable>
            )}
            {!isLocked && (
              <Pressable onPress={handleReplace} style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? theme.backgroundElement : 'transparent' }]}>
                <SymbolView name="arrow.triangle.2.circlepath" size={18} tintColor={theme.text} style={styles.menuIcon} />
                <ThemedText style={styles.menuLabel}>Replace</ThemedText>
              </Pressable>
            )}
            {onMove && (
              <Pressable onPress={() => { close(); onMove(activity); }} style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? theme.backgroundElement : 'transparent' }]}>
                <SymbolView name="calendar" size={18} tintColor={theme.text} style={styles.menuIcon} />
                <ThemedText style={styles.menuLabel}>Move</ThemedText>
              </Pressable>
            )}
            {onEdit && (
              <Pressable onPress={() => { close(); onEdit(activity); }} style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? theme.backgroundElement : 'transparent' }]}>
                <SymbolView name="pencil" size={18} tintColor={theme.text} style={styles.menuIcon} />
                <ThemedText style={styles.menuLabel}>Edit</ThemedText>
              </Pressable>
            )}

            {/* Feedback section */}
            {!isLocked && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
                <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>What'd you think?</ThemedText>

                {/* Liked chips */}
                <View style={styles.chipRow}>
                  {LIKED_REACTIONS.map((reaction) => (
                    <Pressable
                      key={reaction.label}
                      onPress={() => handleReaction(reaction)}
                      style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement }]}
                    >
                      <SymbolView name={reaction.icon as any} size={13} tintColor={theme.primary} />
                      <ThemedText style={[styles.chipLabel, { color: theme.text }]}>{reaction.label}</ThemedText>
                    </Pressable>
                  ))}
                </View>

                {/* Disliked chips */}
                <View style={styles.chipRow}>
                  {DISLIKED_REACTIONS.map((reaction) => (
                    <Pressable
                      key={reaction.label}
                      onPress={() => handleReaction(reaction)}
                      style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? theme.backgroundElement : theme.backgroundElement }]}
                    >
                      <SymbolView name={reaction.icon as any} size={13} tintColor={theme.textSecondary} />
                      <ThemedText style={[styles.chipLabel, { color: theme.textSecondary }]}>{reaction.label}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {isLocked && (
              <ThemedText style={[styles.lockedNote, { color: theme.textSecondary }]}>
                This activity is locked. Unlock it to replace or react.
              </ThemedText>
            )}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerBtn: { padding: 4, borderRadius: Radius.sm },
  triggerText: { fontSize: 16, fontWeight: '700', letterSpacing: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five + 20,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center', marginTop: 10, marginBottom: Spacing.three,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: Spacing.three },
  menuItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: Radius.sm, gap: 12,
  },
  menuIcon: { width: 24, alignItems: 'center' as const },
  menuLabel: { fontSize: 15, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  sectionLabel: {
    fontSize: 12, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: 10, marginLeft: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Radius.full,
  },
  chipLabel: { fontSize: 13, fontWeight: '500' },
  lockedNote: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },
});
