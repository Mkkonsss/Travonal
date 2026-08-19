import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTrips, Trip } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useInbox } from '@/context/inbox';
import { useTheme } from '@/hooks/use-theme';
import { TravelStyleCard } from '@/components/travel-style-card';
import { TripActionSheet } from '@/components/trip-action-sheet';
import { getAllPoolDestinations, getAlternatives } from '@/services/alternatives-pool';
import { buildTripDayMap, TripDayInfo } from '@/services/calendar';

// ---------- helpers ----------

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} \u2013 ${e.toLocaleDateString('en-US', opts)}`;
}

function daysUntil(dateStr: string) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [ty, tm, td] = dateStr.split('-').map(Number);
  const targetUtc = Date.UTC(ty, tm - 1, td);
  const diff = Math.round((targetUtc - todayUtc) / 86400000);
  if (diff < 0) return null;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff} days`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// TripDayInfo type and buildTripDayMap imported from @/services/calendar

// ---------- MonthCalendar (small card in horizontal scroll) ----------

function MonthCalendarSmall({
  year,
  month,
  tripDayMap,
  isCurrentMonth,
  onPress,
}: {
  year: number;
  month: number;
  tripDayMap: Map<string, TripDayInfo[]>;
  isCurrentMonth: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  // Count trips this month
  let tripDayCount = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const entries = tripDayMap.get(`${month}-${d}`);
    if (entries && entries.length > 0) tripDayCount++;
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.monthContainer,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: isCurrentMonth ? theme.primary : theme.border,
          borderWidth: isCurrentMonth ? 1.5 : 1,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${MONTH_NAMES_FULL[month]} ${year} calendar`}
    >
      <View style={styles.monthLabelRow}>
        <ThemedText type="smallBold" style={styles.monthLabel}>
          {MONTH_NAMES[month]}
        </ThemedText>
        {tripDayCount > 0 && (
          <View style={[styles.monthTripBadge, { backgroundColor: theme.primary }]}>
            <ThemedText style={[styles.monthTripBadgeText, { color: theme.primaryText }]}>{tripDayCount}d</ThemedText>
          </View>
        )}
      </View>

      <View style={styles.dayHeaderRow}>
        {DAY_HEADERS.map((d, i) => (
          <ThemedText
            key={i}
            style={[styles.dayHeaderText, { color: theme.textSecondary }]}
          >
            {d}
          </ThemedText>
        ))}
      </View>

      <View style={styles.daysGrid}>
        {cells.map((day, i) => {
          if (day === null) {
            return <View key={`empty-${i}`} style={styles.dayCell} />;
          }

          const infos = tripDayMap.get(`${month}-${day}`) ?? [];
          const todayFlag = isToday(day);

          // Use highest priority trip for the dot color
          const info = infos.length > 0
            ? infos.reduce((best, cur) => {
                const priority = { active: 2, upcoming: 1, past: 0 } as const;
                return priority[cur.state] > priority[best.state] ? cur : best;
              })
            : null;

          let dotColor: string | null = null;
          if (info) {
            if (info.state === 'active') dotColor = theme.live;
            else if (info.state === 'upcoming') dotColor = theme.primary;
            else dotColor = theme.textSecondary;
          }

          return (
            <View key={day} style={styles.dayCell}>
              <ThemedText
                style={[
                  styles.dayText,
                  { color: todayFlag ? theme.primary : theme.text },
                  todayFlag && styles.dayTextToday,
                ]}
              >
                {day}
              </ThemedText>
              {dotColor && (
                <View style={[styles.tripDot, { backgroundColor: dotColor }]} />
              )}
              {infos.length > 1 && (
                <View style={[styles.tripDot, { backgroundColor: theme.textSecondary, position: 'absolute', bottom: 1, right: 2 }]} />
              )}
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

// ---------- Month Modal (interactive popup) ----------

function MonthModal({
  visible,
  year,
  month,
  tripDayMap,
  onClose,
  onViewTrip,
}: {
  visible: boolean;
  year: number;
  month: number;
  tripDayMap: Map<string, TripDayInfo[]>;
  onClose: () => void;
  onViewTrip: (tripId: string) => void;
}) {
  const theme = useTheme();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedInfos = selectedDay ? (tripDayMap.get(`${month}-${selectedDay}`) ?? []) : [];

  // Collect all trips this month for the list
  const monthTrips = new Map<string, TripDayInfo>();
  for (let d = 1; d <= daysInMonth; d++) {
    const infos = tripDayMap.get(`${month}-${d}`) ?? [];
    for (const info of infos) {
      if (!monthTrips.has(info.tripId)) {
        monthTrips.set(info.tripId, info);
      }
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        <Pressable
          style={[styles.modalSheet, { backgroundColor: theme.background }]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="button"
          accessibilityLabel="Month calendar modal"
        >
          <View style={styles.modalHandle} />

          {/* Month title */}
          <ThemedText type="subtitle" style={styles.modalTitle}>
            {MONTH_NAMES_FULL[month]} {year}
          </ThemedText>

          {/* Day headers */}
          <View style={styles.modalDayHeaders}>
            {DAY_HEADERS.map((d, i) => (
              <ThemedText
                key={i}
                style={[styles.modalDayHeaderText, { color: theme.textSecondary }]}
              >
                {d}
              </ThemedText>
            ))}
          </View>

          {/* Calendar grid */}
          <View style={styles.modalDaysGrid}>
            {cells.map((day, i) => {
              if (day === null) {
                return <View key={`empty-${i}`} style={styles.modalDayCell} />;
              }

              const infos = tripDayMap.get(`${month}-${day}`) ?? [];
              const info = infos.length > 0
                ? infos.reduce((best, cur) => {
                    const p = { active: 2, upcoming: 1, past: 0 } as const;
                    return p[cur.state] > p[best.state] ? cur : best;
                  })
                : null;
              const todayFlag = isToday(day);
              const isSelected = selectedDay === day;

              let bgColor = 'transparent';
              let textColor: string = theme.text;
              let borderColor = 'transparent';

              if (isSelected && info) {
                bgColor = theme.primary;
                textColor = theme.primaryText;
              } else if (isSelected) {
                borderColor = theme.primary;
              } else if (info) {
                bgColor = info.state === 'active'
                  ? 'rgba(34,197,94,0.12)'
                  : info.state === 'upcoming'
                  ? theme.primaryMuted
                  : 'rgba(128,128,128,0.08)';
              }

              if (todayFlag && !isSelected) {
                textColor = theme.primary;
              }

              const accentColor = info
                ? info.state === 'active' ? theme.live
                  : info.state === 'upcoming' ? theme.primary
                  : theme.textSecondary
                : 'transparent';

              return (
                <Pressable
                  key={day}
                  onPress={() => setSelectedDay(isSelected ? null : day)}
                  style={[
                    styles.modalDayCell,
                    {
                      backgroundColor: bgColor,
                      borderRadius: 8,
                      borderWidth: borderColor !== 'transparent' ? 1.5 : 0,
                      borderColor,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Day ${day}`}
                >
                  <ThemedText
                    style={[
                      styles.modalDayText,
                      { color: textColor },
                      (todayFlag || isSelected) && { fontWeight: '700' },
                    ]}
                  >
                    {day}
                  </ThemedText>
                  {/* Subtle underline bar instead of overlapping dot */}
                  {info && !isSelected && (
                    <View style={[styles.modalTripBar, { backgroundColor: accentColor }]} />
                  )}
                </Pressable>
              );
            })}
          </View>

          {/* Selected day details — show ALL trips for this day */}
          {selectedInfos.length > 0 && (
            <Animated.View entering={FadeInDown.duration(200)}>
              {selectedInfos.map((selectedInfo) => (
                <Pressable
                  key={selectedInfo.tripId}
                  onPress={() => { onViewTrip(selectedInfo.tripId); onClose(); }}
                  style={({ pressed }) => [
                    styles.modalTripCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: selectedInfo.state === 'active' ? theme.live : theme.primary,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${selectedInfo.destination} trip`}
                >
                  <ThemedText style={styles.modalTripEmoji}>{selectedInfo.emoji}</ThemedText>
                  <View style={styles.modalTripContent}>
                    <ThemedText style={styles.modalTripDest}>{selectedInfo.destination}</ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      Day {selectedInfo.dayNumber} of {selectedInfo.totalDays}
                    </ThemedText>
                  </View>
                  <View style={[styles.modalTripBadge, {
                    backgroundColor: selectedInfo.state === 'active' ? theme.live
                      : selectedInfo.state === 'upcoming' ? theme.primary
                      : theme.textSecondary,
                  }]}>
                    <ThemedText style={[styles.modalTripBadgeText, { color: theme.primaryText }]}>
                      {selectedInfo.state === 'active' ? 'Live' : selectedInfo.state === 'upcoming' ? 'Upcoming' : 'Past'}
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </Animated.View>
          )}

          {/* Trips this month list */}
          {selectedInfos.length === 0 && monthTrips.size > 0 && (
            <View style={styles.modalTripsList}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginBottom: 8 }}>
                Trips this month
              </ThemedText>
              {Array.from(monthTrips.values()).map((info) => (
                <Pressable
                  key={info.tripId}
                  onPress={() => { onViewTrip(info.tripId); onClose(); }}
                  style={({ pressed }) => [
                    styles.modalTripCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${info.destination} trip`}
                >
                  <ThemedText style={styles.modalTripEmoji}>{info.emoji}</ThemedText>
                  <View style={styles.modalTripContent}>
                    <ThemedText style={styles.modalTripDest}>{info.destination}</ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      {info.totalDays} days
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {selectedInfos.length === 0 && monthTrips.size === 0 && (
            <ThemedText style={[styles.modalEmpty, { color: theme.textSecondary }]}>
              No trips planned this month
            </ThemedText>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------- YearCalendar ----------

function YearCalendar({
  year,
  onChangeYear,
  trips,
  getTripState,
}: {
  year: number;
  onChangeYear: (delta: number) => void;
  trips: Trip[];
  getTripState: (trip: Trip) => string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const now = new Date();
  const currentMonth = now.getFullYear() === year ? now.getMonth() : -1;

  const [modalMonth, setModalMonth] = useState<number | null>(null);

  const tripDayMap = buildTripDayMap(trips, getTripState, year);

  // Each month card is roughly 140px wide + 12px gap
  const MONTH_WIDTH = 152;
  const scrollPadding = 4; // from monthsScroll paddingHorizontal
  const centeredOffset = currentMonth >= 0
    ? Math.max(0, scrollPadding + currentMonth * MONTH_WIDTH - (screenWidth - MONTH_WIDTH) / 2 + 12)
    : 0;

  return (
    <View style={styles.yearSection}>
      {/* Year header with bigger, easier to tap navigation */}
      <View style={styles.yearHeader}>
        <Pressable
          onPress={() => onChangeYear(-1)}
          style={({ pressed }) => [
            styles.yearArrowBtn,
            { backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement, borderColor: theme.border },
          ]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous year"
        >
          <ThemedText style={[styles.yearArrowText, { color: theme.primary }]}>{'\u2039'}</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">{year}</ThemedText>
        <Pressable
          onPress={() => onChangeYear(1)}
          style={({ pressed }) => [
            styles.yearArrowBtn,
            { backgroundColor: pressed ? theme.primaryMuted : theme.backgroundElement, borderColor: theme.border },
          ]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next year"
        >
          <ThemedText style={[styles.yearArrowText, { color: theme.primary }]}>{'\u203A'}</ThemedText>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.monthsScroll}
        contentOffset={
          currentMonth >= 0
            ? { x: centeredOffset, y: 0 }
            : undefined
        }
      >
        {Array.from({ length: 12 }, (_, m) => (
          <MonthCalendarSmall
            key={m}
            year={year}
            month={m}
            tripDayMap={tripDayMap}
            isCurrentMonth={m === currentMonth}
            onPress={() => setModalMonth(m)}
          />
        ))}
      </ScrollView>

      {/* Month detail modal */}
      {modalMonth !== null && (
        <MonthModal
          visible
          year={year}
          month={modalMonth}
          tripDayMap={tripDayMap}
          onClose={() => setModalMonth(null)}
          onViewTrip={(tripId) => router.push(`/trip/${tripId}` as any)}
        />
      )}
    </View>
  );
}

// ---------- TodayCard (active trip) ----------

function TodayCard({ trip }: { trip: Trip }) {
  const router = useRouter();
  const theme = useTheme();

  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [sy, sm, sd] = trip.startDate.split('-').map(Number);
  const [ey, em, ed] = trip.endDate.split('-').map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  const currentDay = Math.max(
    1,
    Math.round((todayUtc - startUtc) / 86400000) + 1
  );
  const totalDays = Math.round((endUtc - startUtc) / 86400000) + 1;

  const todayActivities = trip.activities
    .filter((a) => a.day === currentDay)
    .sort((a, b) => a.time.localeCompare(b.time));

  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const nextActivity = todayActivities.find((a) => a.time >= nowTime);
  const fixedToday = todayActivities.find((a) => a.fixed);

  // Compute leave-by time (30 min buffer)
  let leaveByLabel: string | null = null;
  if (nextActivity && nextActivity.time > nowTime) {
    const [h, m] = nextActivity.time.split(':').map(Number);
    const totalMin = h * 60 + m - 30;
    if (totalMin >= 0) {
      const lh = Math.floor(totalMin / 60);
      const lm = totalMin % 60;
      const ampm = lh >= 12 ? 'PM' : 'AM';
      const displayH = lh > 12 ? lh - 12 : lh === 0 ? 12 : lh;
      leaveByLabel = `Leave by ${displayH}:${String(lm).padStart(2, '0')} ${ampm}`;
    }
  }

  // Format activity time for display
  function formatTime(time: string) {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  return (
    <Animated.View entering={FadeIn.duration(400)}>
      <Pressable
        onPress={() => router.push(`/trip/${trip.id}` as any)}
        style={({ pressed }) => [
          styles.todayCard,
          {
            borderColor: theme.live,
            backgroundColor: theme.backgroundElement,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Active trip: Day ${currentDay} of ${totalDays} in ${trip.destination}`}
      >
        <View style={styles.todayCardHeader}>
          <View style={[styles.liveDot, { backgroundColor: theme.live }]} />
          <ThemedText type="eyebrow" style={{ color: theme.live }}>
            Live
          </ThemedText>
        </View>

        <ThemedText type="headline">
          Day {currentDay} of {totalDays} {'\u00B7'} {trip.title ?? trip.destination}
        </ThemedText>

        {nextActivity ? (
          <View style={styles.todayInfo}>
            <ThemedText style={{ color: theme.text }}>
              Next: {formatTime(nextActivity.time)} {'\u2014'} {nextActivity.title}
            </ThemedText>
            {leaveByLabel && (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {leaveByLabel}
              </ThemedText>
            )}
          </View>
        ) : (
          <ThemedText style={{ color: theme.textSecondary }}>
            {todayActivities.length === 0
              ? 'No activities planned today'
              : 'All done for today'}
          </ThemedText>
        )}

        {fixedToday && fixedToday !== nextActivity && (
          <ThemedText type="smallBold" style={{ color: theme.primary }}>
            Fixed: {fixedToday.title} at {formatTime(fixedToday.time)}
          </ThemedText>
        )}

        <View style={styles.quickActionRow}>
          <Pressable
            onPress={() => {
              if (currentDay > totalDays) {
                Alert.alert('Trip ended', `This trip ended on ${trip.endDate}. You can still view it.`, [
                  { text: 'View trip', onPress: () => router.push(`/trip/${trip.id}` as any) },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              } else {
                router.push(`/trip/${trip.id}?day=${currentDay}` as any);
              }
            }}
            style={[styles.todayButton, { backgroundColor: theme.primary }]}
            accessibilityRole="button"
            accessibilityLabel="View today's activities"
          >
            <ThemedText style={[styles.todayButtonText, { color: theme.primaryText }]}>Change today</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => router.push(`/trip/${trip.id}?day=${Math.min(currentDay, totalDays)}&addActivity=1` as any)}
            style={[styles.quickActionChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Add activity to today"
          >
            <ThemedText style={[styles.quickActionChipText, { color: theme.primary }]}>+ Add</ThemedText>
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ---------- NextTripCountdown ----------

function NextTripCountdown({ trip }: { trip: Trip }) {
  const theme = useTheme();
  const countdown = daysUntil(trip.startDate);

  if (!countdown) return null;

  return (
    <Animated.View entering={FadeInDown.delay(100).springify()}>
      <View style={[styles.countdownCard, { backgroundColor: theme.primaryMuted, borderColor: theme.border }]}>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Next trip
        </ThemedText>
        <ThemedText type="headline">
          {trip.emoji} {trip.title ?? trip.destination}
        </ThemedText>
        <ThemedText type="smallBold" style={{ color: theme.primary }}>
          {countdown}
        </ThemedText>
      </View>
    </Animated.View>
  );
}

// ---------- Main Screen ----------

// ---------- Destination card data ----------

const DEST_EMOJIS: Record<string, string> = {
  Tokyo: '\u{1F5FC}',
  Barcelona: '\u{1F1EA}\u{1F1F8}',
  Kyoto: '\u26E9\uFE0F',
};

function scoreDestination(dest: string, profile: { pace: string; budget: string; interests: string[]; dietaryRestrictions: string[]; travelWith: string }) {
  const pool = getAlternatives(dest);
  let score = 0;
  const reasons: string[] = [];

  const allTags = [...new Set(pool.flatMap((p) => p.tags))];
  const matchedInterests = profile.interests.filter((i) => allTags.includes(i));
  if (matchedInterests.length > 0) {
    score += matchedInterests.length * 2;
    reasons.push(`Great for ${matchedInterests.slice(0, 2).join(' & ')}`);
  }

  const budgetAllowed: Record<string, string[]> = {
    budget: ['free', 'budget'],
    moderate: ['free', 'budget', 'moderate'],
    premium: ['free', 'budget', 'moderate', 'premium'],
  };
  const allowed = budgetAllowed[profile.budget] ?? budgetAllowed.moderate;
  const affordablePlaces = pool.filter((p) => allowed.includes(p.cost));
  const pct = Math.round((affordablePlaces.length / pool.length) * 100);
  if (pct >= 60) {
    score += 2;
    reasons.push(`${pct}% of spots fit your budget`);
  }

  const paceToEnergy: Record<string, string> = { relaxed: 'low', moderate: 'medium', active: 'high' };
  const targetEnergy = paceToEnergy[profile.pace] ?? 'medium';
  const paceMatches = pool.filter((p) => p.energyLevel === targetEnergy);
  if (paceMatches.length >= 3) {
    score += 1;
    reasons.push(`${paceMatches.length} ${profile.pace}-paced activities`);
  }

  if (profile.travelWith === 'family') {
    const familyCount = pool.filter((p) => p.familyFriendly).length;
    if (familyCount >= 2) {
      score += 1;
      reasons.push(`${familyCount} family-friendly spots`);
    }
  } else if (profile.travelWith === 'friends' || profile.travelWith === 'group') {
    const groupCount = pool.filter((p) => p.groupFriendly).length;
    if (groupCount >= 1) {
      score += 1;
      reasons.push('Group-friendly activities available');
    }
  }

  if (profile.dietaryRestrictions.length > 0) {
    const withDietary = pool.filter((p) => p.type === 'food' && p.dietaryOptions && p.dietaryOptions.length > 0);
    if (withDietary.length >= 1) {
      reasons.push(`${withDietary.length} spots list dietary options`);
    }
  }

  const activities = pool.filter((p) => p.type === 'activity').length;
  const food = pool.filter((p) => p.type === 'food').length;

  const matchLabel = score >= 5 ? 'Strong' : score >= 3 ? 'Good' : 'Fair';
  return { score, reasons, activities, food, total: pool.length, matchLabel };
}

export default function HomeScreen() {
  const { trips, getTripState, deleteTrip } = useTrips();
  const { profile } = useProfile();
  const { items: inboxItems } = useInbox();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  const now = new Date();
  const currentYear = now.getFullYear();

  const [viewYear, setViewYear] = useState(currentYear);
  const [actionSheetTrip, setActionSheetTrip] = useState<Trip | null>(null);
  const [expandedDest, setExpandedDest] = useState<string | null>(null);
  const [destinationInput, setDestinationInput] = useState('');
  const [showDestError, setShowDestError] = useState(false);
  const destinations = getAllPoolDestinations();

  const scoredDests = destinations
    .map((dest) => ({ dest, ...scoreDestination(dest, profile) }))
    .sort((a, b) => b.score - a.score);

  // Categorize trips
  const categorized = trips.map((t) => ({ trip: t, state: getTripState(t) }));
  const activeTrips = categorized.filter((c) => c.state === 'active').map((c) => c.trip);
  const upcomingTrips = categorized
    .filter((c) => c.state === 'upcoming')
    .map((c) => c.trip)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const pastTrips = categorized.filter((c) => c.state === 'past').map((c) => c.trip);
  const draftTrips = categorized.filter((c) => c.state === 'draft').map((c) => c.trip);

  const hasTrips = trips.length > 0;
  const hasOnlyPast = hasTrips && activeTrips.length === 0 && upcomingTrips.length === 0 && draftTrips.length === 0;
  const nextUpcoming = upcomingTrips[0];

  function handleDeleteTrip(trip: Trip) {
    Alert.alert(
      'Delete trip?',
      `Are you sure you want to delete "${trip.title ?? trip.destination}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { setActionSheetTrip(null); deleteTrip(trip.id); } },
      ]
    );
  }

  function handleTripMenu(trip: Trip) {
    setActionSheetTrip(trip);
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <ThemedText type="title" style={styles.title}>Home</ThemedText>
          <Pressable
            onPress={() => router.push('/inbox' as any)}
            style={({ pressed }) => [
              styles.inboxBtn,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Open inbox"
          >
            <ThemedText style={styles.inboxBtnText}>Inbox</ThemedText>
            {inboxItems.length > 0 && (
              <View style={[styles.inboxBadge, { backgroundColor: theme.primary }]}>
                <ThemedText style={[styles.inboxBadgeText, { color: theme.primaryText }]}>{inboxItems.length}</ThemedText>
              </View>
            )}
          </Pressable>
        </View>

        {!hasTrips ? (
          /* ========== Empty state: no trips ========== */
          <View style={styles.dashboard}>
            {/* Headline */}
            <Animated.View entering={FadeIn.duration(500)}>
              <ThemedText type="title" style={styles.heroTitle}>
                Where to next?
              </ThemedText>
            </Animated.View>

            {/* CTA */}
            <Animated.View entering={FadeInDown.delay(100).springify()}>
              <View style={styles.ctaInputRow}>
                <TextInput
                  style={[styles.ctaInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                  value={destinationInput}
                  onChangeText={(text) => {
                    setDestinationInput(text);
                    if (showDestError && text.trim()) setShowDestError(false);
                  }}
                  placeholder="Where do you want to go?"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="words"
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    const dest = destinationInput.trim();
                    if (dest) router.push(`/add-trip?initialDest=${encodeURIComponent(dest)}` as any);
                  }}
                />
                <Pressable
                  onPress={() => {
                    const dest = destinationInput.trim();
                    if (!dest) {
                      setShowDestError(true);
                      return;
                    }
                    setShowDestError(false);
                    router.push(`/add-trip?initialDest=${encodeURIComponent(dest)}` as any);
                  }}
                  style={({ pressed }) => [
                    styles.ctaButton,
                    {
                      backgroundColor: theme.primary,
                      opacity: pressed ? 0.85 : 1,
                      shadowColor: theme.primary,
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.25,
                      shadowRadius: 8,
                      elevation: 4,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Add trip details"
                >
                  <ThemedText style={[styles.ctaButtonText, { color: theme.primaryText }]}>Add trip details</ThemedText>
                </Pressable>
                {showDestError && (
                  <Animated.View entering={FadeIn.duration(200)}>
                    <ThemedText style={[styles.destErrorText, { color: '#EF4444' }]}>
                      Enter a destination first
                    </ThemedText>
                  </Animated.View>
                )}
              </View>
            </Animated.View>

            {/* Calendar */}
            <YearCalendar
              year={viewYear}
              onChangeYear={(d) => setViewYear((y: number) => y + d)}
              trips={trips}
              getTripState={getTripState}
            />

            {/* Destinations that match you */}
            <View style={styles.destSection}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>
                Destinations that match you
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.destScroll}
              >
                {scoredDests.map((item, i) => {
                  const isExpanded = expandedDest === item.dest;
                  return (
                    <Animated.View key={item.dest} entering={FadeInDown.delay(200 + i * 80).springify()}>
                      <Pressable
                        onPress={() => setExpandedDest(isExpanded ? null : item.dest)}
                        style={({ pressed }) => [
                          styles.destCard,
                          {
                            backgroundColor: theme.backgroundElement,
                            borderColor: isExpanded ? theme.primary : theme.border,
                            opacity: pressed ? 0.9 : 1,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.dest}, tap to see why it fits you`}
                      >
                        <ThemedText style={styles.destEmoji}>
                          {DEST_EMOJIS[item.dest] ?? '\u2708\uFE0F'}
                        </ThemedText>
                        <ThemedText style={styles.destName}>{item.dest}</ThemedText>
                        <ThemedText style={[styles.destWhyBtn, { color: theme.primary }]}>
                          {isExpanded ? 'Why this fits you' : 'Why this fits you \u203A'}
                        </ThemedText>

                        {/* Expanded: match reasons */}
                        {isExpanded && item.reasons.length > 0 && (
                          <Animated.View entering={FadeIn.duration(200)} style={styles.matchReasons}>
                            <View style={[styles.matchDivider, { backgroundColor: theme.border }]} />
                            <ThemedText style={[styles.matchReasonsTitle, { color: theme.primary }]}>
                              Why it matches you
                            </ThemedText>
                            {item.reasons.map((reason) => (
                              <View key={reason} style={styles.matchReasonRow}>
                                <ThemedText style={[styles.matchReasonDot, { color: theme.primary }]}>{'\u2022'}</ThemedText>
                                <ThemedText style={[styles.matchReasonText, { color: theme.textSecondary }]}>
                                  {reason}
                                </ThemedText>
                              </View>
                            ))}
                            <Pressable
                              onPress={() => router.push(`/add-trip?initialDest=${encodeURIComponent(item.dest)}` as any)}
                              style={({ pressed }) => [
                                styles.destCta,
                                { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={`Plan trip to ${item.dest}`}
                            >
                              <ThemedText style={[styles.destCtaText, { color: theme.primaryText }]}>Plan this trip</ThemedText>
                            </Pressable>
                          </Animated.View>
                        )}
                      </Pressable>
                    </Animated.View>
                  );
                })}
              </ScrollView>
            </View>

            {/* Travel style */}
            <Animated.View entering={FadeInDown.delay(450).springify()}>
              <TravelStyleCard
                profile={profile}
                onPress={() => router.push('/(tabs)/profile' as any)}
              />
            </Animated.View>
          </View>
        ) : (
          /* ========== Has trips ========== */
          <View style={styles.dashboard}>
            {/* Active trip: Today mode */}
            {activeTrips.map((trip) => (
              <TodayCard key={trip.id} trip={trip} />
            ))}

            {/* Upcoming trip countdown */}
            {nextUpcoming && activeTrips.length === 0 && (
              <NextTripCountdown trip={nextUpcoming} />
            )}

            {/* Calendar */}
            <YearCalendar
              year={viewYear}
              onChangeYear={(d) => setViewYear((y: number) => y + d)}
              trips={trips}
              getTripState={getTripState}
            />

            {/* Past-only CTA */}
            {hasOnlyPast && (
              <Animated.View entering={FadeInDown.delay(200).springify()}>
                <View style={styles.ctaSection}>
                  <ThemedText type="headline">Plan your next adventure</ThemedText>
                  <Pressable
                    onPress={() => router.push('/add-trip')}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Plan a trip"
                  >
                    <ThemedText style={[styles.primaryButtonText, { color: theme.primaryText }]}>Plan a trip</ThemedText>
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {/* Upcoming trips list (compact) */}
            {(upcomingTrips.length > 0 || draftTrips.length > 0) && (
              <View style={styles.upcomingSection}>
                <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>
                  Upcoming
                </ThemedText>
                {[...draftTrips, ...upcomingTrips].map((trip, i) => {
                  const isDraft = getTripState(trip) === 'draft';
                  return (
                    <Animated.View key={trip.id} entering={FadeInDown.delay(i * 60).springify()}>
                      <Pressable
                        onPress={() => router.push(`/trip/${trip.id}` as any)}
                        onLongPress={() => handleDeleteTrip(trip)}
                        style={({ pressed }) => [
                          styles.tripRow,
                          {
                            backgroundColor: theme.backgroundElement,
                            borderColor: theme.border,
                            opacity: pressed ? 0.92 : 1,
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`${trip.destination}, ${formatDateRange(trip.startDate, trip.endDate)}${isDraft ? ', draft' : ''}`}
                        accessibilityHint="Tap to open trip, long press to delete"
                      >
                        <View style={styles.tripRowLeft}>
                          <ThemedText style={styles.tripRowEmoji}>{trip.emoji}</ThemedText>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <ThemedText type="default" style={{ fontWeight: '600' as const, flexShrink: 1 }} numberOfLines={1}>
                                {trip.title ?? trip.destination}
                              </ThemedText>
                              {isDraft && (
                                <View style={[styles.draftBadge, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                                  <ThemedText type="small" style={{ color: theme.textSecondary, fontSize: 10 }}>Draft</ThemedText>
                                </View>
                              )}
                            </View>
                            <ThemedText type="small" style={{ color: theme.textSecondary }}>
                              {trip.country}
                            </ThemedText>
                          </View>
                        </View>
                        <View style={styles.tripRowRight}>
                          <ThemedText type="small" style={{ color: theme.textSecondary }}>
                            {formatDateRange(trip.startDate, trip.endDate)}
                          </ThemedText>
                          {!isDraft && daysUntil(trip.startDate) && (
                            <ThemedText type="smallBold" style={{ color: theme.primary }}>
                              {daysUntil(trip.startDate)}
                            </ThemedText>
                          )}
                        </View>
                        <Pressable
                          onPress={(e) => { e.stopPropagation(); handleTripMenu(trip); }}
                          hitSlop={8}
                          style={styles.tripMenuBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Trip menu for ${trip.destination}`}
                        >
                          <ThemedText style={[styles.tripMenuIcon, { color: theme.textSecondary }]}>{'\u2026'}</ThemedText>
                        </Pressable>
                      </Pressable>
                    </Animated.View>
                  );
                })}
              </View>
            )}

            {/* Past trips (compact) */}
            {pastTrips.length > 0 && (
              <View style={styles.pastSection}>
                <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>
                  Past
                </ThemedText>
                {pastTrips.map((trip) => (
                  <Pressable
                    key={trip.id}
                    onPress={() => router.push(`/trip/${trip.id}` as any)}
                    onLongPress={() => handleDeleteTrip(trip)}
                    style={[styles.pastRow, { borderBottomColor: theme.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Past trip: ${trip.destination}, ${formatDateRange(trip.startDate, trip.endDate)}`}
                    accessibilityHint="Tap to view trip, long press to delete"
                  >
                    <ThemedText style={styles.pastRowEmoji}>{trip.emoji}</ThemedText>
                    <ThemedText style={[styles.pastRowName, { color: theme.textSecondary }]}>
                      {trip.title ?? trip.destination}
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      {formatDateRange(trip.startDate, trip.endDate)}
                    </ThemedText>
                    <Pressable
                      onPress={(e) => { e.stopPropagation(); handleTripMenu(trip); }}
                      hitSlop={8}
                      style={styles.tripMenuBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Trip menu for ${trip.destination}`}
                    >
                      <ThemedText style={[styles.tripMenuIcon, { color: theme.textSecondary }]}>{'\u2026'}</ThemedText>
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {actionSheetTrip && (
        <TripActionSheet
          visible={!!actionSheetTrip}
          title={`${actionSheetTrip.emoji} ${actionSheetTrip.destination}`}
          onOpen={() => router.push(`/trip/${actionSheetTrip.id}` as any)}
          onEdit={() => router.push(`/trip/${actionSheetTrip.id}?openEdit=1` as any)}
          onDelete={() => handleDeleteTrip(actionSheetTrip)}
          onClose={() => setActionSheetTrip(null)}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.four },
  title: {},
  inboxBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  inboxBtnText: { fontSize: 14, fontWeight: '600' },
  inboxBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  inboxBadgeText: { fontSize: 10, fontWeight: '700' },

  // Empty state
  heroTitle: { fontSize: 28 },
  heroSubtitle: { fontSize: 15, marginTop: 4 },

  // Destination cards
  destSection: { gap: 12 },
  destScroll: { gap: 12, paddingVertical: 4 },
  destCard: {
    width: 170,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  destEmoji: { fontSize: 28, lineHeight: 36 },
  destName: { fontSize: 16, fontWeight: '700' },
  destMeta: { fontSize: 12, fontWeight: '500' },
  destWhyBtn: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  destTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  destTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  destTagText: { fontSize: 10, fontWeight: '600' },

  // Profile card
  profileCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  profileCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  profileEditHint: { fontSize: 13, fontWeight: '600' },
  profileChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  profileChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  profileChipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },

  // Match badge & expanded reasons
  matchBadge: { alignSelf: 'flex-start' as const, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 2 },
  matchBadgeText: { fontSize: 11, fontWeight: '700' as const },
  matchReasons: { gap: 8, marginTop: 4 },
  matchDivider: { height: StyleSheet.hairlineWidth, marginBottom: 4 },
  matchReasonsTitle: { fontSize: 12, fontWeight: '700' as const },
  matchReasonRow: { flexDirection: 'row' as const, gap: 6, alignItems: 'flex-start' as const },
  matchReasonDot: { fontSize: 12, lineHeight: 18 },
  matchReasonText: { fontSize: 12, lineHeight: 18, flex: 1 },
  destCta: { paddingVertical: 10, borderRadius: 10, alignItems: 'center' as const, marginTop: 4 },
  destCtaText: { fontSize: 13, fontWeight: '700' as const },

  // Scale indicator
  scaleContainer: { gap: 8 },
  scaleTitle: { fontSize: 13, fontWeight: '600' as const },
  scaleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 4 },
  scaleLine: { flex: 1, height: 2, borderRadius: 1 },
  scalePointCol: { alignItems: 'center' as const, gap: 4 },
  scaleDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  scaleDotActive: { width: 14, height: 14, borderRadius: 7 },
  scaleDotLabel: { fontSize: 11, fontWeight: '500' as const },

  // Profile sections
  profileSection: { gap: 4 },
  profileSectionLabel: { fontSize: 12, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },

  // CTA input
  ctaInputRow: { gap: 10 },
  ctaInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  ctaButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  ctaButtonText: { fontSize: 17, fontWeight: '700' },
  destErrorText: { fontSize: 13, fontWeight: '500', textAlign: 'center' },

  primaryButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { fontSize: 17, fontWeight: '700' },
  // Dashboard
  dashboard: { gap: 36 },

  // Year calendar
  yearSection: { gap: 12, alignItems: 'center' },
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  yearArrowBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  yearArrowText: { fontSize: 24, fontWeight: '300', lineHeight: 28 },
  monthsScroll: { gap: 12, paddingHorizontal: 4, paddingVertical: 4 },
  monthContainer: {
    width: 140,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  monthLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 6 },
  monthLabel: { textAlign: 'center' },
  monthTripBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6 },
  monthTripBadgeText: { fontSize: 8, fontWeight: '700' },
  dayHeaderRow: { flexDirection: 'row', marginBottom: 2, justifyContent: 'center' },
  dayHeaderText: { width: 17, textAlign: 'center', fontSize: 9, fontWeight: '500' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: 119 },
  dayCell: { width: 17, height: 18, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 9 },
  dayTextToday: { fontWeight: '700' },
  tripDot: { width: 3, height: 3, borderRadius: 1.5, position: 'absolute', bottom: 1 },

  // Month modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalSheet: {
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: { textAlign: 'center', marginBottom: 20 },
  modalDayHeaders: { flexDirection: 'row', marginBottom: 8 },
  modalDayHeaderText: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600' },
  modalDaysGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  modalDayCell: {
    width: '14.28%' as any,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 1,
  },
  modalDayText: { fontSize: 15 },
  modalTripBar: { width: 14, height: 3, borderRadius: 1.5, marginTop: 2 },
  modalTripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    gap: 10,
    marginBottom: 8,
  },
  modalTripEmoji: { fontSize: 28, lineHeight: 36 },
  modalTripContent: { flex: 1, gap: 2 },
  modalTripDest: { fontSize: 16, fontWeight: '600' },
  modalTripBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  modalTripBadgeText: { fontSize: 11, fontWeight: '600' },
  modalTripsList: { marginTop: 4 },
  modalEmpty: { textAlign: 'center', paddingVertical: 16, fontSize: 14 },

  // Today card
  todayCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: Spacing.three,
    gap: 8,
  },
  todayCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5 },
  todayInfo: { gap: 2 },
  todayButton: {
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  todayButtonText: { fontSize: 15, fontWeight: '600' },
  quickActionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  quickActionChip: { borderRadius: 10, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16, justifyContent: 'center' },
  quickActionChipText: { fontSize: 14, fontWeight: '600' },

  // Countdown
  countdownCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing.three,
    gap: 4,
  },

  // CTA
  ctaSection: { gap: 12, marginTop: 8 },

  // Upcoming section
  upcomingSection: { gap: 10 },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  tripRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  tripRowEmoji: { fontSize: 24, lineHeight: 32 },
  tripRowRight: { alignItems: 'flex-end', gap: 2, minWidth: 72 },
  draftBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  tripMenuBtn: { width: 36, height: 36, marginLeft: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  tripMenuIcon: { fontSize: 20, fontWeight: '700', lineHeight: 24 },

  // Past section
  pastSection: { gap: 8 },
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pastRowEmoji: { fontSize: 18, lineHeight: 26 },
  pastRowName: { flex: 1, fontSize: 15, fontWeight: '500' },

});
