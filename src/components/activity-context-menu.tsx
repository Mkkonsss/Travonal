/**
 * ActivityContextMenu — full-screen context menu shown on long-press or "..." tap.
 *
 * Consolidates the action sheet and inline controls into one clean surface.
 * Dimmed backdrop, activity preview, primary actions, and reaction options.
 */

import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/context/trips';

export interface ReactionOption {
  label: string;
  icon: string;
  memoryDetail: (activity: Activity) => string;
  memoryCategory: string;
}

export const REACTIONS: ReactionOption[] = [
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

const TYPE_LABELS: Record<Activity['type'], string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  activity: 'Activity',
  food: 'Food',
};

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

interface ActivityContextMenuProps {
  activity: Activity | null;
  visible: boolean;
  onClose: () => void;
  onBook?: (activity: Activity) => void;
  bookLabel?: string;
  onReplace: (activity: Activity) => void;
  onMove: (activity: Activity) => void;
  onEdit: (activity: Activity) => void;
  onCustomize?: (activity: Activity) => void;
  onLock: (activity: Activity) => void;
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
  onCustomize,
  onLock,
  onRemove,
  onReaction,
}: ActivityContextMenuProps) {
  const theme = useTheme();

  if (!activity) return null;

  const isProtected = !!(activity.locked || activity.fixed);

  function act(fn: (a: Activity) => void) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    fn(activity!);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          {/* Activity preview */}
          <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.previewInfo}>
              <ThemedText style={styles.previewTitle} numberOfLines={2}>
                {activity.title}
              </ThemedText>
              <ThemedText style={[styles.previewMeta, { color: theme.textSecondary }]}>
                {TYPE_LABELS[activity.type]}
                {activity.duration ? ` \u00B7 ${formatDuration(activity.duration)}` : ''}
                {activity.cost && activity.cost !== 'free' ? ` \u00B7 ${activity.cost}` : ''}
              </ThemedText>
              {activity.description ? (
                <ThemedText style={[styles.previewDesc, { color: theme.textSecondary }]} numberOfLines={2}>
                  {activity.description}
                </ThemedText>
              ) : null}
            </View>
            {isProtected && (
              <View style={[styles.protectedBadge, { backgroundColor: theme.primaryMuted }]}>
                <SymbolView name="lock.fill" size={10} tintColor={theme.textSecondary} />
                <ThemedText style={[styles.protectedBadgeText, { color: theme.textSecondary }]}>
                  {activity.fixed ? 'Fixed' : 'Locked'}
                </ThemedText>
              </View>
            )}
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

            {!isProtected && (
              <MenuItem
                icon="arrow.triangle.2.circlepath"
                label="Replace"
                theme={theme}
                onPress={() => act(onReplace)}
              />
            )}

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

            {onCustomize && !isProtected && (
              <MenuItem
                icon="slider.horizontal.3"
                label="Customize"
                theme={theme}
                onPress={() => act(onCustomize)}
              />
            )}

            {!activity.fixed && (
              <MenuItem
                icon={activity.locked ? 'lock.open.fill' : 'lock.fill'}
                label={activity.locked ? 'Unlock' : 'Lock'}
                theme={theme}
                onPress={() => act(onLock)}
              />
            )}

            {/* Divider */}
            {!isProtected && (
              <>
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
                <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                  WHAT'S WRONG WITH THIS?
                </ThemedText>
                {REACTIONS.map((reaction) => (
                  <MenuItem
                    key={reaction.label}
                    icon={reaction.icon}
                    label={reaction.label}
                    theme={theme}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onClose();
                      onReaction(activity, reaction);
                    }}
                  />
                ))}
              </>
            )}

            {/* Remove — always last */}
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <MenuItem
              icon="trash"
              label="Remove"
              color={theme.danger}
              theme={theme}
              onPress={() => act(onRemove)}
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
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
  protectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.xs,
    marginTop: 8,
  },
  protectedBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
    marginBottom: 4,
    marginLeft: 12,
  },
});
