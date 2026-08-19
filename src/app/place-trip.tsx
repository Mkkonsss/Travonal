import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TimePickerButton, defaultTimeForType, defaultDurationForType } from '@/components/time-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useInbox } from '@/context/inbox';
import { useTrips } from '@/context/trips';
import { useTheme } from '@/hooks/use-theme';
import { getTripDayCount } from '@/services/itinerary-engine';

export default function PlaceTripScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { items, markPlanned } = useInbox();
  const { trips, addActivity } = useTrips();

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState('10:00');
  const [selectedDuration, setSelectedDuration] = useState(60);

  const item = items.find((i) => i.id === itemId);

  if (!item) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.centered}>
          <ThemedText style={{ color: theme.textSecondary }}>Item not found</ThemedText>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
            <ThemedText style={[styles.backBtnText, { color: theme.primary }]}>Go back</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  const selectedTrip = trips.find((t) => t.id === selectedTripId);
  const totalDays = selectedTrip ? getTripDayCount(selectedTrip.startDate, selectedTrip.endDate) : 0;

  function handleConfirm() {
    if (!selectedTripId || !selectedDay || !item) return;

    addActivity(selectedTripId, {
      title: item.title,
      day: selectedDay,
      time: selectedTime,
      type: (item.category === 'food' ? 'food' : 'activity') as 'activity' | 'food',
      duration: selectedDuration,
      category: item.category,
      cost: item.cost,
      description: item.description,
    });

    markPlanned(item.id, selectedTripId);

    Alert.alert(
      'Added!',
      `"${item.title}" added to ${selectedTrip?.destination ?? 'trip'}, Day ${selectedDay}.`,
      [{ text: 'OK', onPress: () => router.back() }],
    );
  }

  const canConfirm = selectedTripId && selectedDay;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ThemedText style={[styles.headerBack, { color: theme.primary }]}>{'\u2190'} Back</ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Add to Trip</ThemedText>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Item preview */}
        <View style={[styles.itemPreview, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <ThemedText type="headline">{item.title}</ThemedText>
          {item.description && (
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {item.description}
            </ThemedText>
          )}
        </View>

        {/* Select trip */}
        <ThemedText type="eyebrow" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          Select a trip
        </ThemedText>

        {trips.length === 0 ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.emptyState}>
            <ThemedText style={{ color: theme.textSecondary }}>
              No trips yet. Create a trip first.
            </ThemedText>
            <Pressable
              onPress={() => {
                router.back();
                router.push('/add-trip');
              }}
              style={[styles.createTripBtn, { backgroundColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Create a trip"
            >
              <ThemedText style={[styles.createTripText, { color: theme.primaryText }]}>Create a trip</ThemedText>
            </Pressable>
          </Animated.View>
        ) : (
          <View style={styles.tripList}>
            {trips.map((trip, i) => (
              <Animated.View key={trip.id} entering={FadeInDown.delay(i * 50).springify()}>
                <Pressable
                  onPress={() => {
                    setSelectedTripId(trip.id);
                    setSelectedDay(null);
                    const actType = item?.category === 'food' ? 'food' : 'activity';
                    setSelectedTime(defaultTimeForType(actType as any));
                    setSelectedDuration(defaultDurationForType(actType as any));
                  }}
                  style={({ pressed }) => [
                    styles.tripCard,
                    {
                      backgroundColor: selectedTripId === trip.id ? theme.primaryMuted : theme.backgroundElement,
                      borderColor: selectedTripId === trip.id ? theme.primary : theme.border,
                      opacity: pressed ? 0.92 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Select trip: ${trip.destination}`}
                >
                  <ThemedText style={styles.tripEmoji}>{trip.emoji}</ThemedText>
                  <View style={styles.tripInfo}>
                    <ThemedText style={styles.tripDest}>{trip.destination}</ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      {trip.country}
                    </ThemedText>
                  </View>
                  {selectedTripId === trip.id && (
                    <ThemedText style={[styles.checkMark, { color: theme.primary }]}>{'\u2713'}</ThemedText>
                  )}
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}

        {/* Select day */}
        {selectedTrip && totalDays > 0 && (
          <Animated.View entering={FadeIn.duration(200)}>
            <ThemedText type="eyebrow" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              Select a day
            </ThemedText>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayRow}
            >
              {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => (
                <Pressable
                  key={day}
                  onPress={() => setSelectedDay(day)}
                  style={[
                    styles.dayPill,
                    {
                      backgroundColor: selectedDay === day ? theme.primary : theme.backgroundElement,
                      borderColor: selectedDay === day ? theme.primary : theme.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Day ${day}`}
                >
                  <ThemedText
                    style={[styles.dayText, selectedDay === day && { color: theme.primaryText }]}
                  >
                    Day {day}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Time & duration */}
        {selectedDay && (
          <Animated.View entering={FadeIn.duration(200)}>
            <ThemedText type="eyebrow" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
              Time & duration
            </ThemedText>
            <TimePickerButton
              value={selectedTime}
              onChange={setSelectedTime}
              showDuration
              duration={selectedDuration}
              onDurationChange={setSelectedDuration}
            />
          </Animated.View>
        )}

        {/* Confirm button */}
        <Pressable
          onPress={handleConfirm}
          disabled={!canConfirm}
          style={({ pressed }) => [
            styles.confirmBtn,
            { backgroundColor: theme.primary, opacity: !canConfirm ? 0.4 : pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Confirm add to trip"
        >
          <ThemedText style={[styles.confirmText, { color: theme.primaryText }]}>
            {canConfirm
              ? `Add to ${selectedTrip?.destination}, Day ${selectedDay}`
              : 'Select a trip and day'}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' as const },
  headerBtn: { width: 64 },
  headerBack: { fontSize: 17, fontWeight: '500' as const },
  scrollContent: { padding: Spacing.four },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },

  // Item preview
  itemPreview: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 4,
    marginBottom: Spacing.four,
  },

  // Section
  sectionTitle: {
    marginBottom: 12,
  },

  // Trip list
  tripList: { gap: 8, marginBottom: Spacing.four },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 14,
    gap: 10,
  },
  tripEmoji: { fontSize: 24, lineHeight: 32 },
  tripInfo: { flex: 1 },
  tripDest: { fontSize: 15, fontWeight: '600' },
  checkMark: { fontSize: 18, fontWeight: '700' },

  // Day selector
  dayRow: { gap: 8, marginBottom: Spacing.four },
  dayPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  dayText: { fontSize: 13, fontWeight: '600' },

  // Buttons
  confirmBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  confirmText: { fontSize: 17, fontWeight: '700' },
  backBtn: { paddingVertical: 12 },
  backBtnText: { fontSize: 15, fontWeight: '500' },
  createTripBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  createTripText: { fontSize: 15, fontWeight: '600' },

  // Empty
  emptyState: { alignItems: 'center', gap: 12, paddingVertical: 24 },
});
