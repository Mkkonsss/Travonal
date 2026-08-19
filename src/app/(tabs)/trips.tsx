import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useState } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TripActionSheet } from '@/components/trip-action-sheet';
import { Spacing } from '@/constants/theme';
import { useTrips, Trip } from '@/context/trips';
import { useTheme } from '@/hooks/use-theme';

// ---------- helpers ----------

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} \u2013 ${e.toLocaleDateString('en-US', opts)}`;
}

// ---------- TripRow ----------

function TripRow({ trip, index }: { trip: Trip; index: number }) {
  const router = useRouter();
  const theme = useTheme();
  const { deleteTrip } = useTrips();
  const [menuVisible, setMenuVisible] = useState(false);

  function handleDelete() {
    Alert.alert(
      'Delete trip?',
      `Are you sure you want to delete your trip to ${trip.title ?? trip.destination}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { setMenuVisible(false); deleteTrip(trip.id); } },
      ]
    );
  }

  function handleMenu() {
    setMenuVisible(true);
  }

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <Pressable
        onPress={() => router.push(`/trip/${trip.id}` as any)}
        style={({ pressed }) => [
          styles.tripRow,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${trip.destination}, ${trip.country}. ${formatDateRange(trip.startDate, trip.endDate)}`}
      >
        <View style={styles.tripRowLeft}>
          <ThemedText style={styles.tripEmoji}>{trip.emoji}</ThemedText>
          <View style={styles.tripInfo}>
            <ThemedText style={styles.tripDestination} numberOfLines={1}>{trip.title ?? trip.destination}</ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {trip.country}
            </ThemedText>
          </View>
        </View>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {formatDateRange(trip.startDate, trip.endDate)}
        </ThemedText>
        <Pressable onPress={(e) => { e.stopPropagation(); handleMenu(); }} style={styles.menuBtn} accessibilityRole="button" accessibilityLabel={`Trip menu for ${trip.destination}`}>
          <ThemedText style={[styles.menuIcon, { color: theme.textSecondary }]}>{'\u2026'}</ThemedText>
        </Pressable>
      </Pressable>
      <TripActionSheet
        visible={menuVisible}
        title={`${trip.emoji} ${trip.title ?? trip.destination}`}
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
  emptyText,
  startIndex,
}: {
  title: string;
  trips: Trip[];
  emptyText: string;
  startIndex: number;
}) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>
        {title} ({trips.length})
      </ThemedText>

      {trips.length === 0 ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {emptyText}
        </ThemedText>
      ) : (
        <View style={styles.tripList}>
          {trips.map((trip, i) => (
            <TripRow key={trip.id} trip={trip} index={startIndex + i} />
          ))}
        </View>
      )}
    </View>
  );
}

// ---------- Main Screen ----------

export default function TripsScreen() {
  const { trips, getTripState } = useTrips();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  // Categorize
  const drafts: Trip[] = [];
  const active: Trip[] = [];
  const upcoming: Trip[] = [];
  const past: Trip[] = [];

  for (const trip of trips) {
    const state = getTripState(trip);
    if (state === 'draft') drafts.push(trip);
    else if (state === 'active') active.push(trip);
    else if (state === 'upcoming') upcoming.push(trip);
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
              { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="New trip"
          >
            <ThemedText style={[styles.newTripText, { color: theme.primaryText }]}>+ New trip</ThemedText>
          </Pressable>
        </View>

        <TripSection
          title="Drafts"
          trips={drafts}
          emptyText="No drafts yet"
          startIndex={0}
        />

        <TripSection
          title="Active"
          trips={active}
          emptyText="No active trips"
          startIndex={drafts.length}
        />

        <TripSection
          title="Upcoming"
          trips={upcoming}
          emptyText="No upcoming trips"
          startIndex={drafts.length + active.length}
        />

        <TripSection
          title="Past"
          trips={past}
          emptyText="No past trips"
          startIndex={drafts.length + active.length + upcoming.length}
        />
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  newTripText: { fontSize: 14, fontWeight: '600' },

  section: { gap: 10, marginBottom: Spacing.four },

  tripList: { gap: 8 },

  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  tripRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  tripEmoji: { fontSize: 24, lineHeight: 32 },
  tripInfo: { flex: 1 },
  tripDestination: { fontSize: 15, fontWeight: '600' },
  menuBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { fontSize: 18, fontWeight: '700' },
});
