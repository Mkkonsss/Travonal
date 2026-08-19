import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

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
  onLock: () => void;
  onRemove: () => void;
  onReplace: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onMoveAdvanced?: () => void;
  onEdit?: () => void;
  onCustomize?: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export function ActivityCard({
  activity,
  onLock,
  onRemove,
  onReplace,
  onMove,
  onMoveAdvanced,
  onEdit,
  onCustomize,
  isFirst,
  isLast,
}: ActivityCardProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);

  const isProtected = !!(activity.locked || activity.fixed);

  return (
    <View style={styles.activityContent}>
      <Pressable
        onPress={() => setExpanded(!expanded)}
        style={styles.activityMain}
        accessibilityRole="button"
        accessibilityLabel={`${activity.title} at ${activity.time}${isProtected ? ', locked' : ''}`}
        accessibilityHint="Tap to show activity controls"
      >
        <View style={styles.activityInfo}>
          <ThemedText style={styles.activityTitle}>{activity.title}</ThemedText>
          <ThemedText style={[styles.activityMeta, { color: theme.textSecondary }]}>
            {TYPE_LABELS[activity.type]}
            {activity.duration ? ` \u00B7 ${formatDuration(activity.duration)}` : ''}
            {activity.cost && activity.cost !== 'free' ? ` \u00B7 ${activity.cost}` : ''}
          </ThemedText>
        </View>
        {activity.fixed && (
          <ThemedText style={[styles.fixedBadge, { color: theme.textSecondary }]}>Fixed</ThemedText>
        )}
        {activity.locked && !activity.fixed && (
          <ThemedText style={[styles.lockBadge, { color: theme.primary }]}>Locked</ThemedText>
        )}
      </Pressable>

      {expanded && (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.controls}>
          {/* Lock / Unlock - not available for fixed activities */}
          {!activity.fixed && (
            <Pressable
              onPress={onLock}
              style={[styles.controlBtn, activity.locked && styles.controlBtnActive]}
              accessibilityRole="button"
              accessibilityLabel={activity.locked ? 'Unlock activity' : 'Lock activity'}
            >
              <ThemedText style={styles.controlText}>
                {activity.locked ? 'Unlock' : 'Lock'}
              </ThemedText>
            </Pressable>
          )}

          {/* Replace - available for all activities */}
          <Pressable
            onPress={onReplace}
            style={styles.controlBtn}
            accessibilityRole="button"
            accessibilityLabel="Replace activity"
          >
            <ThemedText style={styles.controlText}>Replace</ThemedText>
          </Pressable>

          {/* Move button -- opens move modal (not available for locked/fixed) */}
          {!isProtected && (
            <Pressable
              onPress={onMoveAdvanced ?? (() => onMove('down'))}
              style={styles.controlBtn}
              accessibilityRole="button"
              accessibilityLabel="Move activity"
            >
              <ThemedText style={styles.controlText}>Move</ThemedText>
            </Pressable>
          )}

          {/* Edit - available for all activities */}
          {onEdit && (
            <Pressable
              onPress={onEdit}
              style={styles.controlBtn}
              accessibilityRole="button"
              accessibilityLabel="Edit activity"
            >
              <ThemedText style={styles.controlText}>Edit</ThemedText>
            </Pressable>
          )}

          {/* Customize - apply transformations to this activity */}
          {onCustomize && !isProtected && (
            <Pressable
              onPress={onCustomize}
              style={styles.controlBtn}
              accessibilityRole="button"
              accessibilityLabel="Customize activity"
            >
              <ThemedText style={styles.controlText}>Customize</ThemedText>
            </Pressable>
          )}

          {/* Remove - available for all activities */}
          <Pressable
            onPress={onRemove}
            style={[styles.controlBtn, styles.controlBtnDanger]}
            accessibilityRole="button"
            accessibilityLabel="Remove activity"
          >
            <ThemedText style={[styles.controlText, { color: theme.danger }]}>
              Remove
            </ThemedText>
          </Pressable>

          {/* Protected info message */}
          {isProtected && (
            <View style={[styles.protectedMsg, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.protectedText, { color: theme.textSecondary }]}>
                {activity.fixed ? 'Fixed reservation — protected from auto-changes' : 'Locked — protected from auto-changes'}
              </ThemedText>
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  activityContent: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 16,
  },
  activityMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  lockBadge: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  fixedBadge: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  controlBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(229,229,229,0.08)',
  },
  controlBtnActive: {
    backgroundColor: 'rgba(229,229,229,0.16)',
  },
  controlBtnDanger: {
    backgroundColor: 'rgba(220,38,38,0.08)',
  },
  controlText: {
    fontSize: 12,
    fontWeight: '600',
  },
  protectedMsg: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginTop: 2,
  },
  protectedText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
});
