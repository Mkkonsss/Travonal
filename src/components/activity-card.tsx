/**
 * ActivityCard — displays a single activity in the timeline.
 *
 * Interactions:
 *  - Tap → onTap (navigate to place detail)
 *  - Long-press → onDrag (start drag-and-drop reorder)
 *  - "..." → onMenu (open context menu)
 */

import { Pressable, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Activity } from '@/context/trips';
import { useTheme } from '@/hooks/use-theme';

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

interface ActivityCardProps {
  activity: Activity;
  /** Photo URL for the activity thumbnail */
  photoUrl?: string | null;
  /** Short label for the book button, e.g. "Book hotel", "Reserve" */
  bookLabel?: string;
  /** "..." menu button → context menu */
  onMenu?: () => void;
  /** Tap the card → navigate to place detail */
  onTap?: () => void;
  /** Book button tapped */
  onBook?: () => void;
}

export function ActivityCard({
  activity,
  photoUrl,
  bookLabel,
  onMenu,
  onTap,
  onBook,
}: ActivityCardProps) {
  const theme = useTheme();
  const isProtected = !!(activity.locked || activity.fixed);
  const showBookBtn = onBook && !activity.bookingStatus && !activity.fixed;

  return (
    <View style={styles.activityContent}>
      <View style={styles.cardRow}>
        {/* Main content area — tap to view, hold to drag (handled by parent) */}
        <Pressable
          onPress={onTap}
          style={({ pressed }) => [
            styles.activityMain,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${activity.title} at ${activity.time}${isProtected ? ', locked' : ''}`}
          accessibilityHint="Tap for details, hold to reorder"
        >
          {photoUrl ? (
            <ExpoImage
              source={{ uri: photoUrl }}
              style={styles.thumbnail}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}
          <View style={styles.activityInfo}>
            <ThemedText style={styles.activityTitle}>{activity.title}</ThemedText>
            <ThemedText style={[styles.activityMeta, { color: theme.textSecondary }]}>
              {TYPE_LABELS[activity.type]}
              {activity.duration ? ` \u00B7 ${formatDuration(activity.duration)}` : ''}
              {activity.cost && activity.cost !== 'free' ? ` \u00B7 ${activity.cost}` : ''}
            </ThemedText>
            {/* Book button — inline below meta for unbooked activities */}
            {showBookBtn && (
              <Pressable
                onPress={(e) => { e.stopPropagation(); onBook(); }}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.bookBtn,
                  { borderColor: theme.primary + '40' },
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${bookLabel ?? 'Book'} ${activity.title}`}
              >
                <ThemedText style={[styles.bookBtnText, { color: theme.primary }]}>
                  {bookLabel ?? 'Book'}
                </ThemedText>
              </Pressable>
            )}
          </View>
          {activity.bookingStatus === 'booked' && (
            <View style={styles.statusRow}>
              <SymbolView name={"checkmark" as any} size={12} tintColor="#10B981" />
              <ThemedText style={[styles.statusBadge, { color: '#10B981' }]}>Booked</ThemedText>
            </View>
          )}
          {activity.bookingStatus === 'pending' && (
            <ThemedText style={[styles.statusBadge, { color: '#D97706' }]}>Pending</ThemedText>
          )}
        </Pressable>
        {activity.fixed && (
          <View style={[styles.lockPill, { backgroundColor: theme.textSecondary + '20' }]}>
            <SymbolView name={"pin.fill" as any} size={10} tintColor={theme.textSecondary} />
          </View>
        )}
        {activity.locked && !activity.fixed && (
          <View style={[styles.lockPill, { backgroundColor: theme.primary + '15' }]}>
            <SymbolView name={"lock.fill" as any} size={10} tintColor={theme.primary} />
          </View>
        )}

        {/* "..." menu trigger — opens context menu */}
        <Pressable
          onPress={onMenu}
          hitSlop={8}
          style={styles.menuTrigger}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${activity.title}`}
        >
          <ThemedText style={[styles.menuDots, { color: theme.textSecondary }]}>{'\u2022\u2022\u2022'}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  activityContent: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 16,
    overflow: 'visible',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  activityMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thumbnail: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  activityInfo: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  activityMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '600',
  },
  lockPill: {
    position: 'absolute',
    top: 0,
    right: 28,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  bookBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  menuTrigger: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  menuDots: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
