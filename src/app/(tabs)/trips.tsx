import { useRouter } from 'expo-router';
import { Alert, Dimensions, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useMemo, useRef, useState } from 'react';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TripActionSheet } from '@/components/trip-action-sheet';
import { Spacing, Radius, Shadow } from '@/constants/theme';
import { useTrips, Trip } from '@/context/trips';
import { useBoards } from '@/context/boards';
import { useTheme } from '@/hooks/use-theme';
import { useFabOnScroll } from '@/hooks/use-fab-scroll';
import { formatDateRange } from '@/services/trip-helpers';
import { useDestinationPhoto } from '@/hooks/use-destination-photo';
import { buildTripDayMap, TripDayInfo } from '@/services/calendar';
import { getTripReadiness } from '@/services/booking-links';

function tripGradient(dest: string): [string, string] {
  let h = 0;
  for (const ch of dest.toLowerCase()) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(h) % 360;
  return [`hsl(${hue}, 25%, 18%)`, `hsl(${(hue + 40) % 360}, 30%, 12%)`];
}

const STATUS_PILL: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: 'Draft', bg: 'rgba(255,255,255,0.15)', text: 'rgba(255,255,255,0.7)' },
  active: { label: 'Active', bg: 'rgba(16,185,129,0.85)', text: '#ffffff' },
  upcoming: { label: 'Upcoming', bg: 'rgba(0,0,0,0.5)', text: '#ffffff' },
  past: { label: 'Past', bg: 'rgba(255,255,255,0.12)', text: 'rgba(255,255,255,0.6)' },
  planned: { label: 'Dates TBD', bg: 'rgba(255,255,255,0.15)', text: 'rgba(255,255,255,0.7)' },
};

// ---------- Calendar helpers ----------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

// ---------- MonthCalendarSmall ----------

function MonthCalendarSmall({
  month,
  year,
  dayMap,
  onPress,
}: {
  month: number;
  year: number;
  dayMap: Map<string, TripDayInfo[]>;
  onPress: () => void;
}) {
  const theme = useTheme();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();

  const cells: React.ReactNode[] = [];
  // Empty cells before the first day
  for (let i = 0; i < firstDay; i++) {
    cells.push(<View key={`e${i}`} style={calStyles.dayCell} />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${month}-${d}`;
    const infos = dayMap.get(key);
    const isToday = isCurrentMonth && d === todayDate;
    const hasTrip = !!infos && infos.length > 0;
    const tripState = hasTrip ? infos[0].state : null;

    cells.push(
      <View key={d} style={calStyles.dayCell}>
        <View style={[calStyles.dayDot, isToday && { backgroundColor: theme.primary }]}>
          <ThemedText
            style={[
              calStyles.dayText,
              { color: theme.textSecondary },
              hasTrip && { fontWeight: '600', color: theme.text },
              isToday && { color: '#fff', fontWeight: '700' },
            ]}
          >
            {d}
          </ThemedText>
        </View>
        {hasTrip && (
          <View style={[calStyles.dayBar, {
            backgroundColor: tripState === 'active' ? theme.live : tripState === 'upcoming' ? theme.primary : theme.border,
          }]} />
        )}
      </View>,
    );
  }

  return (
    <Pressable onPress={onPress} style={[calStyles.monthCard, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText style={[calStyles.monthLabel, { color: theme.text }]}>{MONTH_NAMES[month]}</ThemedText>
      <View style={calStyles.dayHeaderRow}>
        {DAY_HEADERS.map((h, i) => (
          <View key={i} style={calStyles.dayCell}>
            <ThemedText style={[calStyles.dayHeaderText, { color: theme.textSecondary }]}>{h}</ThemedText>
          </View>
        ))}
      </View>
      <View style={calStyles.dayGrid}>{cells}</View>
    </Pressable>
  );
}

// ---------- MonthModal ----------

function MonthModal({
  visible,
  month,
  year,
  dayMap,
  onClose,
  onTripPress,
}: {
  visible: boolean;
  month: number;
  year: number;
  dayMap: Map<string, TripDayInfo[]>;
  onClose: () => void;
  onTripPress: (tripId: string) => void;
}) {
  const theme = useTheme();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDate = today.getDate();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const selectedInfos = selectedDay ? dayMap.get(`${month}-${selectedDay}`) ?? [] : [];

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<View key={`e${i}`} style={calStyles.modalDayCell} />);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${month}-${d}`;
    const infos = dayMap.get(key);
    const isToday = isCurrentMonth && d === todayDate;
    const hasTrip = !!infos && infos.length > 0;
    const tripState = hasTrip ? infos[0].state : null;
    const isSelected = selectedDay === d;

    cells.push(
      <Pressable
        key={d}
        onPress={() => setSelectedDay(d === selectedDay ? null : d)}
        style={calStyles.modalDayCell}
      >
        <View
          style={[
            calStyles.modalDayDot,
            isToday && { backgroundColor: theme.primary },
            isSelected && { borderWidth: 2, borderColor: theme.primary },
          ]}
        >
          <ThemedText
            style={[
              calStyles.modalDayText,
              { color: theme.text },
              hasTrip && { fontWeight: '600' },
              isToday && { color: '#fff', fontWeight: '700' },
            ]}
          >
            {d}
          </ThemedText>
        </View>
        {hasTrip && (
          <View style={[calStyles.modalDayBar, {
            backgroundColor: tripState === 'active' ? theme.live : tripState === 'upcoming' ? theme.primary : theme.border,
          }]} />
        )}
      </Pressable>,
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={calStyles.modalOverlay} onPress={onClose}>
        <Pressable style={[calStyles.modalContent, { backgroundColor: theme.background }]} onPress={(e) => e.stopPropagation()}>
          <View style={calStyles.modalHeader}>
            <ThemedText style={calStyles.modalTitle}>
              {MONTH_NAMES_FULL[month]} {year}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={12}>
              <SymbolView name="xmark.circle.fill" size={24} tintColor={theme.textSecondary} />
            </Pressable>
          </View>

          <View style={calStyles.dayHeaderRow}>
            {DAY_HEADERS.map((h, i) => (
              <View key={i} style={calStyles.modalDayCell}>
                <ThemedText style={[calStyles.modalDayHeader, { color: theme.textSecondary }]}>{h}</ThemedText>
              </View>
            ))}
          </View>
          <View style={calStyles.dayGrid}>{cells}</View>

          {selectedInfos.length > 0 && (
            <View style={[calStyles.modalTrips, { borderTopColor: theme.border }]}>
              {selectedInfos.map((info) => (
                <Pressable
                  key={info.tripId}
                  onPress={() => { onClose(); onTripPress(info.tripId); }}
                  style={({ pressed }) => [calStyles.modalTripRow, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[calStyles.modalTripDest, { color: theme.text }]}>{info.destination}</ThemedText>
                    <ThemedText style={[calStyles.modalTripDay, { color: theme.textSecondary }]}>
                      Day {info.dayNumber} of {info.totalDays}
                    </ThemedText>
                  </View>
                  <View style={[calStyles.modalTripPill, {
                    backgroundColor: info.state === 'active' ? theme.live + '20' : theme.backgroundElement,
                  }]}>
                    <ThemedText style={[calStyles.modalTripPillText, {
                      color: info.state === 'active' ? theme.live : theme.textSecondary,
                    }]}>
                      {info.state === 'active' ? 'Active' : info.state === 'upcoming' ? 'Upcoming' : 'Past'}
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------- YearCalendar ----------

function YearCalendar({ trips, getTripState }: { trips: Trip[]; getTripState: (t: Trip) => string }) {
  const theme = useTheme();
  const listRef = useRef<FlatList>(null);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [modalMonth, setModalMonth] = useState<number | null>(null);
  const router = useRouter();

  const dayMap = useMemo(() => buildTripDayMap(trips, getTripState, viewYear), [trips, getTripState, viewYear]);

  const currentMonth = new Date().getMonth();
  const CARD_WIDTH = 160;
  const CARD_GAP = 10;
  const screenWidth = Dimensions.get('window').width;
  // The FlatList sits inside a ScrollView with paddingHorizontal: Spacing.four
  // so its available width is screenWidth - 2 * Spacing.four
  const listWidth = screenWidth - Spacing.four * 2;
  const SIDE_PADDING = (listWidth - CARD_WIDTH) / 2;
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i), []);

  return (
    <View style={calStyles.yearContainer}>
      {/* Year header */}
      <View style={calStyles.yearHeader}>
        <Pressable onPress={() => setViewYear((y) => y - 1)} hitSlop={12} style={calStyles.yearArrow}>
          <SymbolView name="chevron.left" size={14} tintColor={theme.textSecondary} />
        </Pressable>
        <ThemedText style={[calStyles.yearLabel, { color: theme.text }]}>{viewYear}</ThemedText>
        <Pressable onPress={() => setViewYear((y) => y + 1)} hitSlop={12} style={calStyles.yearArrow}>
          <SymbolView name="chevron.right" size={14} tintColor={theme.textSecondary} />
        </Pressable>
      </View>

      {/* Horizontal month cards — snaps month by month, centered */}
      <FlatList
        ref={listRef}
        data={months}
        keyExtractor={(item) => String(item)}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + CARD_GAP}
        decelerationRate={0}
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: SIDE_PADDING }}
        initialScrollIndex={currentMonth}
        getItemLayout={(_, index) => ({
          length: CARD_WIDTH + CARD_GAP,
          offset: index * (CARD_WIDTH + CARD_GAP),
          index,
        })}
        ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
        renderItem={({ item: i }) => (
          <MonthCalendarSmall
            month={i}
            year={viewYear}
            dayMap={dayMap}
            onPress={() => setModalMonth(i)}
          />
        )}
      />

      {/* Month detail modal */}
      {modalMonth !== null && (
        <MonthModal
          visible
          month={modalMonth}
          year={viewYear}
          dayMap={dayMap}
          onClose={() => setModalMonth(null)}
          onTripPress={(id) => router.push(`/trip/${id}` as any)}
        />
      )}
    </View>
  );
}

// ---------- TripRow ----------

function TripCard({ trip, index, state }: { trip: Trip; index: number; state: string }) {
  const router = useRouter();
  const { deleteTrip } = useTrips();
  const { clearPlannedTrip } = useBoards();
  const [menuVisible, setMenuVisible] = useState(false);
  const pill = STATUS_PILL[state] ?? STATUS_PILL.draft;
  const [gradStart, gradEnd] = tripGradient(trip.destination);
  const activityCount = trip.activities.length;
  const photoUrl = useDestinationPhoto(`${trip.destination}, ${trip.country}`);
  const imgOpacity = useSharedValue(0);
  const imgStyle = useAnimatedStyle(() => ({ opacity: imgOpacity.value }));

  function handleDelete() {
    Alert.alert(
      'Delete trip?',
      `Are you sure you want to delete your trip to ${trip.title ?? trip.destination}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { setMenuVisible(false); clearPlannedTrip(trip.id); deleteTrip(trip.id); } },
      ]
    );
  }

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <Pressable
        onPress={() => router.push(`/trip/${trip.id}` as any)}
        style={({ pressed }) => [styles.tripCard, { opacity: pressed ? 0.92 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={`${trip.destination}, ${trip.country}. ${formatDateRange(trip.startDate, trip.endDate, trip.datesKnown)}`}
      >
        <LinearGradient colors={[gradStart, gradEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tripCardGradient}>
          {photoUrl && (
            <Animated.View style={[StyleSheet.absoluteFill, imgStyle]}>
              <ExpoImage
                source={{ uri: photoUrl }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                onLoad={() => { imgOpacity.value = withTiming(1, { duration: 400 }); }}
              />
            </Animated.View>
          )}
          {photoUrl && <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />}
          {/* Top row: status pill + menu */}
          <View style={styles.tripCardTop}>
            <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
              <ThemedText style={[styles.statusPillText, { color: pill.text }]}>{pill.label}</ThemedText>
            </View>
            <Pressable onPress={(e) => { e.stopPropagation(); setMenuVisible(true); }} style={styles.menuBtn} accessibilityRole="button" accessibilityLabel={`Trip menu for ${trip.destination}`}>
              <SymbolView name="ellipsis" size={18} tintColor="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>

          {/* Bottom: destination info */}
          <View style={styles.tripCardBottom}>
            <ThemedText style={styles.tripCardTitle} numberOfLines={1}>{trip.title ?? trip.destination}</ThemedText>
            <ThemedText style={styles.tripCardDate}>{formatDateRange(trip.startDate, trip.endDate, trip.datesKnown)}</ThemedText>
            {activityCount > 0 && (
              <ThemedText style={styles.tripCardActivities}>{activityCount} {activityCount === 1 ? 'activity' : 'activities'}</ThemedText>
            )}
          </View>
        </LinearGradient>
      </Pressable>
      <TripActionSheet
        visible={menuVisible}
        title={trip.title ?? trip.destination}
        onOpen={() => router.push(`/trip/${trip.id}` as any)}
        onEdit={() => router.push(`/trip/${trip.id}?openEdit=1` as any)}
        onDelete={handleDelete}
        onClose={() => setMenuVisible(false)}
      />
    </Animated.View>
  );
}

// ---------- Section ----------

function TripSection({
  title,
  trips,
  state,
  startIndex,
}: {
  title: string;
  trips: Trip[];
  state: string;
  startIndex: number;
}) {
  const theme = useTheme();

  // Hide empty sections entirely
  if (trips.length === 0) return null;

  return (
    <View style={styles.section}>
      <ThemedText type="sectionTitle" style={{ color: theme.textSecondary }}>
        {title}
      </ThemedText>

      <View style={styles.tripList}>
        {trips.map((trip, i) => (
          <TripCard key={trip.id} trip={trip} index={startIndex + i} state={state} />
        ))}
      </View>
    </View>
  );
}

// ---------- Trips Empty State ----------

function TripsEmptyState({ onPlan }: { onPlan: () => void }) {
  const theme = useTheme();

  return (
    <Animated.View entering={FadeIn.duration(600)} style={emptyStyles.container}>
      <ThemedText style={emptyStyles.title}>Your adventures await</ThemedText>
      <Pressable
        onPress={onPlan}
        style={({ pressed }) => [
          emptyStyles.cta,
          { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Plan your first trip"
      >
        <ThemedText style={[emptyStyles.ctaText, { color: theme.primaryText }]}>
          Plan a trip
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const emptyStyles = StyleSheet.create({
  container: { gap: 14, paddingTop: 8, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center' },
  cta: { paddingHorizontal: 24, paddingVertical: 13, borderRadius: Radius.xl },
  ctaText: { fontSize: 15, fontWeight: '700' },
});

// ---------- Main Screen ----------

export default function TripsScreen() {
  const { trips, getTripState } = useTrips();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { onScroll, scrollEventThrottle } = useFabOnScroll();

  // Categorize
  const drafts: Trip[] = [];
  const active: Trip[] = [];
  const upcoming: Trip[] = [];
  const planned: Trip[] = [];
  const past: Trip[] = [];

  for (const trip of trips) {
    const state = getTripState(trip);
    if (state === 'draft') drafts.push(trip);
    else if (state === 'active') active.push(trip);
    else if (state === 'upcoming') upcoming.push(trip);
    else if (state === 'planned') planned.push(trip);
    else past.push(trip);
  }

  // Sort
  active.sort((a, b) => a.startDate.localeCompare(b.startDate));
  upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  past.sort((a, b) => b.startDate.localeCompare(a.startDate));

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
        <View style={styles.header}>
          <ThemedText type="title">Trips</ThemedText>
          <Pressable
            onPress={() => router.push('/add-trip')}
            style={({ pressed }) => [
              styles.newTripButton,
              { opacity: pressed ? 0.5 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="New trip"
          >
            <ThemedText style={[styles.newTripText, { color: theme.text }]}>+ New trip</ThemedText>
          </Pressable>
        </View>

        <YearCalendar trips={trips} getTripState={getTripState} />

        {/* Booking to-do card — shows unbooked items across upcoming trips */}
        {(() => {
          const now = new Date();
          const upcomingWithBookings = [...active, ...upcoming].filter((t) => {
            const readiness = getTripReadiness(t.activities);
            return readiness.total > 0 && readiness.percentage < 100;
          });
          if (upcomingWithBookings.length === 0) return null;

          let totalUnbooked = 0;
          let totalHotels = 0;
          let totalActivities = 0;
          for (const t of upcomingWithBookings) {
            for (const a of t.activities) {
              if (a.bookingStatus === 'booked') continue;
              if (a.type === 'hotel') { totalUnbooked++; totalHotels++; }
              else if (a.type === 'flight') { totalUnbooked++; }
              else if (a.type === 'activity') { totalUnbooked++; totalActivities++; }
              else if (a.type === 'food') { totalUnbooked++; }
            }
          }
          if (totalUnbooked === 0) return null;

          const parts: string[] = [];
          if (totalHotels > 0) parts.push(`${totalHotels} hotel${totalHotels > 1 ? 's' : ''}`);
          if (totalActivities > 0) parts.push(`${totalActivities} activit${totalActivities > 1 ? 'ies' : 'y'}`);
          const otherCount = totalUnbooked - totalHotels - totalActivities;
          if (otherCount > 0) parts.push(`${otherCount} other`);

          return (
            <Pressable
              onPress={() => {
                // Navigate to the first trip with unbooked items
                const first = upcomingWithBookings[0];
                router.push(`/(tabs)/trip/${first.id}?viewMode=reservations` as any);
              }}
              style={[styles.bookingTodoCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            >
              <View style={styles.bookingTodoHeader}>
                <SymbolView name={"calendar.badge.exclamationmark" as any} size={18} tintColor={theme.primary} />
                <ThemedText style={styles.bookingTodoTitle}>Booking to-do</ThemedText>
              </View>
              <ThemedText style={[styles.bookingTodoBody, { color: theme.textSecondary }]}>
                {parts.join(' and ')} need booking across {upcomingWithBookings.length} trip{upcomingWithBookings.length > 1 ? 's' : ''}
              </ThemedText>
              {upcomingWithBookings.slice(0, 3).map((t) => {
                const r = getTripReadiness(t.activities);
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => router.push(`/(tabs)/trip/${t.id}?viewMode=reservations` as any)}
                    style={styles.bookingTodoTrip}
                  >
                    <ThemedText style={styles.bookingTodoTripName} numberOfLines={1}>{t.destination}</ThemedText>
                    <ThemedText style={[styles.bookingTodoTripStatus, { color: theme.primary }]}>
                      {r.booked}/{r.total} booked
                    </ThemedText>
                  </Pressable>
                );
              })}
            </Pressable>
          );
        })()}

        <TripSection title="Active" trips={active} state="active" startIndex={0} />
        <TripSection title="Upcoming" trips={upcoming} state="upcoming" startIndex={active.length} />
        <TripSection title="Planned" trips={planned} state="planned" startIndex={active.length + upcoming.length} />
        <TripSection title="Drafts" trips={drafts} state="draft" startIndex={active.length + upcoming.length + planned.length} />
        <TripSection title="Past" trips={past} state="past" startIndex={active.length + upcoming.length + planned.length + drafts.length} />

        {trips.length === 0 && (
          <TripsEmptyState onPlan={() => router.push('/add-trip')} />
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.four,
  },

  newTripButton: {
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  newTripText: { fontSize: 14, fontWeight: '600' },

  bookingTodoCard: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.four,
  },
  bookingTodoHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 6,
  },
  bookingTodoTitle: { fontSize: 15, fontWeight: '700' as const },
  bookingTodoBody: { fontSize: 13, marginBottom: 10 },
  bookingTodoTrip: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 6,
  },
  bookingTodoTripName: { fontSize: 14, fontWeight: '500' as const, flex: 1 },
  bookingTodoTripStatus: { fontSize: 13, fontWeight: '600' as const },

  section: { gap: 10, marginBottom: Spacing.four },

  tripList: { gap: 12 },

  tripCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.medium,
    shadowColor: '#000000',
  },
  tripCardGradient: { padding: 20, minHeight: 160, justifyContent: 'space-between' },
  tripCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripCardEmoji: { fontSize: 36, lineHeight: 44, alignSelf: 'center' },
  tripCardBottom: { gap: 2 },
  tripCardTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  tripCardDate: { fontSize: 14, color: 'rgba(255,255,255,0.75)' },
  tripCardActivities: { fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 3 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.xl },
  statusPillText: { fontSize: 11, fontWeight: '600' },
  menuBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  menuIconLight: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.7)' },
});

// ---------- Calendar styles ----------

const calStyles = StyleSheet.create({
  yearContainer: { marginBottom: Spacing.four },
  yearHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 12,
  },
  yearLabel: { fontSize: 17, fontWeight: '700' },
  yearArrow: { padding: 4 },
  // Small month card
  monthCard: {
    width: 160,
    borderRadius: Radius.sm,
    padding: 10,
  },
  monthLabel: { fontSize: 13, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  dayHeaderRow: { flexDirection: 'row' },
  dayHeaderText: { fontSize: 8, fontWeight: '600', textAlign: 'center' },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: { fontSize: 8, fontWeight: '500', textAlign: 'center', lineHeight: 16, includeFontPadding: false },
  dayBar: { width: 10, height: 2, borderRadius: 1, marginTop: 1 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.lg,
    padding: 20,
    ...Shadow.strong,
    shadowColor: '#000',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalDayCell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDayHeader: { fontSize: 12, fontWeight: '600' },
  modalDayDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDayText: { fontSize: 13, fontWeight: '500', lineHeight: 16, includeFontPadding: false },
  modalDayBar: { width: 16, height: 3, borderRadius: 1.5, marginTop: 2 },
  modalTrips: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  modalTripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTripDest: { fontSize: 14, fontWeight: '600' },
  modalTripDay: { fontSize: 12 },
  modalTripPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.xs,
  },
  modalTripPillText: { fontSize: 11, fontWeight: '600' },
});
