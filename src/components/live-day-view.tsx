/**
 * Live Day View — shows today's schedule with a "now" indicator,
 * past activities dimmed, and the next-up activity highlighted.
 *
 * Refreshes every 60 seconds to keep the "now" position current.
 * Only renders when the trip is active and the user is viewing today.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Activity } from '@/context/trips';
import { getNowPosition, NowPosition } from '@/services/trip-status';
import type { Trip } from '@/context/trips';
import type { DayWeather } from '@/services/weather';

interface LiveDayViewProps {
  trip: Trip;
  timezone?: string;
  /** Today's weather data, if available */
  weather?: DayWeather | null;
  /** Render the activity content (card, menu, etc) — same as standard timeline */
  renderActivity: (activity: Activity, idx: number, total: number) => React.ReactNode;
  /** Called when user taps "I'm running late" */
  onRunningLate?: () => void;
  /** Called when user taps "Skip" on a specific activity */
  onSkipActivity?: (activity: Activity) => void;
  /** Called once when all activities for the day are complete */
  onDayComplete?: (dayNumber: number) => void;
}

function formatTimeDisplay(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
}

function weatherSymbolName(code: number): string {
  if (code <= 3) return 'sun.max.fill'; // clear/partly cloudy
  if (code >= 51 && code <= 67) return 'cloud.rain.fill'; // rain
  if (code >= 71 && code <= 77) return 'snowflake'; // snow
  if (code >= 80 && code <= 82) return 'cloud.sun.rain.fill'; // rain showers
  if (code >= 95) return 'cloud.bolt.rain.fill'; // thunderstorm
  if (code >= 45 && code <= 48) return 'cloud.fog.fill'; // fog
  return 'cloud.fill'; // cloudy
}

export function LiveDayView({
  trip,
  timezone,
  weather,
  renderActivity,
  onRunningLate,
  onSkipActivity,
  onDayComplete,
}: LiveDayViewProps) {
  const theme = useTheme();
  const [nowPosition, setNowPosition] = useState<NowPosition>(() => getNowPosition(trip, timezone));
  const [dayCompleteNotified, setDayCompleteNotified] = useState(false);

  // Refresh "now" position every 60 seconds
  useEffect(() => {
    setNowPosition(getNowPosition(trip, timezone));
    const interval = setInterval(() => {
      setNowPosition(getNowPosition(trip, timezone));
    }, 60_000);
    return () => clearInterval(interval);
  }, [trip, timezone]);

  const { currentDay, currentTime, pastActivities, currentActivity, upcomingActivities } = nowPosition;
  const allActivities = [...pastActivities, ...(currentActivity ? [currentActivity] : []), ...upcomingActivities];

  // Trigger onDayComplete when all activities are done
  useEffect(() => {
    if (dayCompleteNotified) return;
    if (allActivities.length === 0) return;
    if (currentActivity === null && upcomingActivities.length === 0 && pastActivities.length > 0) {
      setDayCompleteNotified(true);
      onDayComplete?.(currentDay);
    }
  }, [dayCompleteNotified, allActivities.length, currentActivity, upcomingActivities.length, pastActivities.length, currentDay, onDayComplete]);

  if (allActivities.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
          No activities planned for today
        </ThemedText>
      </View>
    );
  }

  const pastIds = new Set(pastActivities.map((a) => a.id));
  const currentId = currentActivity?.id;
  const upcomingIds = new Set(upcomingActivities.map((a) => a.id));
  const nextUpId = upcomingActivities[0]?.id;

  // Determine where to insert the "now" indicator
  // It goes after the last past/current activity and before the first upcoming one
  const nowInsertAfterIdx = pastActivities.length + (currentActivity ? 1 : 0) - 1;

  return (
    <View style={styles.container}>
      {/* Live header */}
      <Animated.View entering={FadeIn.duration(300)} style={styles.liveHeader}>
        <View style={[styles.liveDot, { backgroundColor: theme.live }]} />
        <ThemedText style={[styles.liveLabel, { color: theme.live }]}>Live</ThemedText>
        {weather && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <SymbolView name={weatherSymbolName(weather.weatherCode)} size={14} tintColor={theme.textSecondary} />
            <ThemedText style={[styles.weatherInfo, { color: theme.textSecondary }]}>
              {Math.round(weather.temperatureMax)}°
            </ThemedText>
          </View>
        )}
        <ThemedText style={[styles.liveTime, { color: theme.textSecondary }]}>
          {formatTimeDisplay(currentTime)}
        </ThemedText>
      </Animated.View>

      {allActivities.map((activity, idx) => {
        const isPast = pastIds.has(activity.id);
        const isCurrent = activity.id === currentId;
        const isNextUp = activity.id === nextUpId;
        const showNowIndicator = idx === nowInsertAfterIdx + 1 || (nowInsertAfterIdx < 0 && idx === 0);

        return (
          <View key={activity.id}>
            {/* "Now" indicator — inserted before the first upcoming activity */}
            {showNowIndicator && nowInsertAfterIdx < 0 && (
              <NowIndicator
                time={currentTime}
                theme={theme}
                onRunningLate={onRunningLate}
              />
            )}

            <View style={[
              styles.activityWrapper,
              isPast && styles.pastActivity,
              isNextUp && [styles.nextUpActivity, { borderColor: theme.live + '40' }],
            ]}>
              {/* Status indicator */}
              <View style={styles.statusCol}>
                {isPast && (
                  <SymbolView name="checkmark.circle.fill" size={14} tintColor="#10B981" />
                )}
                {isCurrent && (
                  <View style={[styles.currentDot, { backgroundColor: theme.live }]} />
                )}
                {!isPast && !isCurrent && (
                  <View style={[styles.upcomingDot, { borderColor: theme.border }]} />
                )}
                {idx < allActivities.length - 1 && (
                  <View style={[
                    styles.connector,
                    { backgroundColor: isPast ? theme.border : theme.primary + '30' },
                  ]} />
                )}
              </View>

              {/* Activity content */}
              <View style={styles.contentCol}>
                {isNextUp && (
                  <ThemedText style={[styles.nextUpLabel, { color: theme.live }]}>Next up</ThemedText>
                )}
                {renderActivity(activity, idx, allActivities.length)}
                {isPast && onSkipActivity && (
                  <View style={styles.skipRow}>
                    <ThemedText style={[styles.doneLabel, { color: theme.textSecondary }]}>Done</ThemedText>
                  </View>
                )}
              </View>
            </View>

            {/* "Now" indicator — inserted after the last completed/current activity */}
            {idx === nowInsertAfterIdx && nowInsertAfterIdx >= 0 && (
              <NowIndicator
                time={currentTime}
                theme={theme}
                onRunningLate={onRunningLate}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function NowIndicator({
  time,
  theme,
  onRunningLate,
}: {
  time: string;
  theme: ReturnType<typeof useTheme>;
  onRunningLate?: () => void;
}) {
  return (
    <View style={styles.nowIndicator}>
      <View style={[styles.nowLine, { backgroundColor: theme.live }]} />
      <View style={[styles.nowBadge, { backgroundColor: theme.live }]}>
        <ThemedText style={styles.nowText}>Now {formatTimeDisplay(time)}</ThemedText>
      </View>
      <View style={[styles.nowLine, { backgroundColor: theme.live, flex: 1 }]} />
      {onRunningLate && (
        <Pressable
          onPress={onRunningLate}
          style={[styles.runningLateBtn, { borderColor: theme.live + '50' }]}
          accessibilityRole="button"
          accessibilityLabel="I'm running late"
        >
          <ThemedText style={[styles.runningLateText, { color: theme.live }]}>Running late?</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Inherits from parent
  },
  emptyContainer: {
    paddingVertical: Spacing.five,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
  },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.three,
    paddingHorizontal: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weatherInfo: {
    fontSize: 13,
  },
  liveTime: {
    fontSize: 13,
    marginLeft: 'auto',
  },
  activityWrapper: {
    flexDirection: 'row',
    minHeight: 60,
  },
  pastActivity: {
    opacity: 0.5,
  },
  nextUpActivity: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginHorizontal: -4,
    marginVertical: 2,
  },
  statusCol: {
    width: 28,
    alignItems: 'center',
    paddingTop: 4,
  },
  checkmark: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '700',
  },
  currentDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  upcomingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  connector: {
    width: 2,
    flex: 1,
    marginTop: 4,
  },
  contentCol: {
    flex: 1,
    paddingLeft: 8,
    paddingBottom: 12,
  },
  nextUpLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  skipRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  doneLabel: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  nowIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    gap: 8,
  },
  nowLine: {
    height: 2,
    width: 20,
  },
  nowBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  nowText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  runningLateBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  runningLateText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
