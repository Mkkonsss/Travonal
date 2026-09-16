/**
 * Activity Actions Menu — visible ••• button + reaction options.
 *
 * Combines quick reactions with replacement in one flow:
 * - "Replace" → triggers smart replace
 * - "Not my vibe" / "Too touristy" / etc. → saves memory signal + finds alternatives
 *
 * Supports both visible ••• button tap and long-press from parent.
 */

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/context/trips';

export interface ReactionOption {
  label: string;
  icon: string;
  /** Memory detail to save when this reaction is chosen */
  memoryDetail: (activity: Activity) => string;
  /** Memory category */
  memoryCategory: string;
}

const REACTIONS: ReactionOption[] = [
  {
    label: 'Not my vibe',
    icon: 'hand.raised.fill',
    memoryDetail: (a) => `Didn't like "${a.title}" — not my vibe`,
    memoryCategory: 'preference',
  },
  {
    label: 'Too touristy',
    icon: 'camera.badge.ellipsis.fill',
    memoryDetail: (a) => `Found "${a.title}" too touristy`,
    memoryCategory: 'crowds',
  },
  {
    label: 'Too expensive',
    icon: 'dollarsign.circle.fill',
    memoryDetail: (a) => `Found "${a.title}" too expensive`,
    memoryCategory: 'budget',
  },
  {
    label: 'Too far',
    icon: 'car.fill',
    memoryDetail: (a) => `"${a.title}" was too far from other activities`,
    memoryCategory: 'logistics',
  },
  {
    label: 'Wrong type',
    icon: 'xmark.circle.fill',
    memoryDetail: (a) => `Doesn't want ${a.type} activities like "${a.title}"`,
    memoryCategory: 'activity_type',
  },
];

interface ActivityActionsMenuProps {
  activity: Activity;
  tripDestination: string;
  /** Called when user wants to replace (triggers smart replace flow) */
  onReplace: (activity: Activity) => void;
  /** Called when user picks a reaction — parent should save to memory + find alternatives */
  onReaction: (activity: Activity, reaction: ReactionOption) => void;
  /** Called to move the activity */
  onMove?: (activity: Activity) => void;
  /** Called to edit the activity */
  onEdit?: (activity: Activity) => void;
  /** Called when user taps Book/Reserve — opens booking link */
  onBook?: (activity: Activity) => void;
  /** Label for the book button (e.g. "Book hotel", "Reserve", "Find tickets") */
  bookLabel?: string;
  /** Whether to show as external trigger (long-press already handled by parent) */
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
      {/* Visible ••• trigger button */}
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

      {/* Actions modal */}
      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            <View style={styles.handle} />
            <ThemedText style={styles.sheetTitle} numberOfLines={1}>
              {activity.title}
            </ThemedText>

            {/* Primary actions */}
            {onBook && (
              <Pressable
                onPress={() => { close(); onBook(activity); }}
                style={({ pressed }) => [
                  styles.menuItem,
                  { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
                ]}
              >
                <SymbolView name="link" size={18} tintColor={theme.primary} style={styles.menuIcon} />
                <ThemedText style={[styles.menuLabel, { color: theme.primary }]}>{bookLabel ?? 'Book'}</ThemedText>
              </Pressable>
            )}

            {!isLocked && (
              <Pressable
                onPress={handleReplace}
                style={({ pressed }) => [
                  styles.menuItem,
                  { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
                ]}
              >
                <SymbolView name="arrow.triangle.2.circlepath" size={18} tintColor={theme.text} style={styles.menuIcon} />
                <ThemedText style={styles.menuLabel}>Replace</ThemedText>
              </Pressable>
            )}

            {onMove && (
              <Pressable
                onPress={() => { close(); onMove(activity); }}
                style={({ pressed }) => [
                  styles.menuItem,
                  { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
                ]}
              >
                <SymbolView name="calendar" size={18} tintColor={theme.text} style={styles.menuIcon} />
                <ThemedText style={styles.menuLabel}>Move</ThemedText>
              </Pressable>
            )}

            {onEdit && (
              <Pressable
                onPress={() => { close(); onEdit(activity); }}
                style={({ pressed }) => [
                  styles.menuItem,
                  { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
                ]}
              >
                <SymbolView name="pencil" size={18} tintColor={theme.text} style={styles.menuIcon} />
                <ThemedText style={styles.menuLabel}>Edit</ThemedText>
              </Pressable>
            )}

            {/* Divider */}
            {!isLocked && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
                <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                  What's wrong with this?
                </ThemedText>

                {/* Reaction pills */}
                {REACTIONS.map((reaction) => (
                  <Pressable
                    key={reaction.label}
                    onPress={() => handleReaction(reaction)}
                    style={({ pressed }) => [
                      styles.menuItem,
                      { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
                    ]}
                  >
                    <SymbolView name={reaction.icon as any} size={18} tintColor={theme.text} style={styles.menuIcon} />
                    <ThemedText style={styles.menuLabel}>{reaction.label}</ThemedText>
                  </Pressable>
                ))}
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
  triggerBtn: {
    padding: 4,
    borderRadius: Radius.sm,
  },
  triggerText: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five + 20,
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
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: Spacing.three,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    gap: 12,
  },
  menuIcon: {
    width: 24,
    alignItems: 'center' as const,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginLeft: 12,
  },
  lockedNote: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 16,
  },
});
