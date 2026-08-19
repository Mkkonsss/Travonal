import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { DatePickerModal, formatDisplayDate } from '@/components/date-picker-modal';
import { TimePickerButton } from '@/components/time-picker';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useTheme } from '@/hooks/use-theme';
import { generateId } from '@/services/itinerary-engine';
import { resolveCountry } from '@/services/trip-helpers';

const DESTINATION_EMOJIS: Record<string, string> = {
  tokyo: '\u{1F5FC}',
  japan: '\u{1F1EF}\u{1F1F5}',
  kyoto: '\u26E9\uFE0F',
  osaka: '\u{1F3EF}',
  paris: '\u{1F5FC}',
  france: '\u{1F1EB}\u{1F1F7}',
  london: '\u{1F1EC}\u{1F1E7}',
  rome: '\u{1F1EE}\u{1F1F9}',
  italy: '\u{1F1EE}\u{1F1F9}',
  barcelona: '\u{1F1EA}\u{1F1F8}',
  spain: '\u{1F1EA}\u{1F1F8}',
  'new york': '\u{1F5FD}',
  miami: '\u{1F334}',
  hawaii: '\u{1F3D6}\uFE0F',
  bali: '\u{1F30A}',
  thailand: '\u{1F1F9}\u{1F1ED}',
  bangkok: '\u{1F6D5}',
  mexico: '\u{1F1F2}\u{1F1FD}',
  greece: '\u{1F1EC}\u{1F1F7}',
  santorini: '\u{1F3D6}\uFE0F',
  amsterdam: '\u{1F1F3}\u{1F1F1}',
  berlin: '\u{1F1E9}\u{1F1EA}',
  germany: '\u{1F1E9}\u{1F1EA}',
  australia: '\u{1F1E6}\u{1F1FA}',
  sydney: '\u{1F3D6}\uFE0F',
  iceland: '\u{1F9CA}',
  egypt: '\u{1F3DB}\uFE0F',
  morocco: '\u{1F1F2}\u{1F1E6}',
  dubai: '\u{1F3D9}\uFE0F',
  singapore: '\u{1F1F8}\u{1F1EC}',
  seoul: '\u{1F1F0}\u{1F1F7}',
  korea: '\u{1F1F0}\u{1F1F7}',
  india: '\u{1F1EE}\u{1F1F3}',
  portugal: '\u{1F1F5}\u{1F1F9}',
  lisbon: '\u{1F1F5}\u{1F1F9}',
  brazil: '\u{1F1E7}\u{1F1F7}',
  canada: '\u{1F1E8}\u{1F1E6}',
  switzerland: '\u{1F1E8}\u{1F1ED}',
  austria: '\u{1F1E6}\u{1F1F9}',
  prague: '\u{1F3F0}',
  vietnam: '\u{1F1FB}\u{1F1F3}',
};

const DEFAULT_EMOJI_POOL = [
  '\u{1F30D}', '\u{1F30E}', '\u{1F30F}', '\u{1F3D6}\uFE0F', '\u{1F3DD}\uFE0F',
  '\u{1F3DE}\uFE0F', '\u{1F5FA}\uFE0F', '\u{2708}\uFE0F', '\u{1F9F3}', '\u{1F30A}',
  '\u26F0\uFE0F', '\u{1F3D4}\uFE0F', '\u{1F334}', '\u{1F305}', '\u{1F303}',
];

function pickTripEmoji(destination: string): string {
  const lower = destination.toLowerCase().trim();
  // Check direct match
  if (DESTINATION_EMOJIS[lower]) return DESTINATION_EMOJIS[lower];
  // Check partial match
  for (const [key, emoji] of Object.entries(DESTINATION_EMOJIS)) {
    if (lower.includes(key) || key.includes(lower)) return emoji;
  }
  // Hash-based pick from the default pool
  let h = 0;
  for (const ch of lower) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return DEFAULT_EMOJI_POOL[Math.abs(h) % DEFAULT_EMOJI_POOL.length];
}

const PACE_OPTIONS = [
  { value: 'relaxed' as const, label: 'Relaxed' },
  { value: 'moderate' as const, label: 'Moderate' },
  { value: 'active' as const, label: 'Active' },
];

const BUDGET_OPTIONS = [
  { value: 'budget' as const, label: 'Budget' },
  { value: 'moderate' as const, label: 'Moderate' },
  { value: 'premium' as const, label: 'Premium' },
];

const TRAVEL_WITH_OPTIONS = [
  { value: 'solo' as const, label: 'Solo' },
  { value: 'partner' as const, label: 'Partner' },
  { value: 'family' as const, label: 'Family' },
  { value: 'friends' as const, label: 'Friends' },
  { value: 'group' as const, label: 'Group' },
];

const RESERVATION_TYPES = [
  { value: 'activity' as const, label: 'Activity' },
  { value: 'food' as const, label: 'Food' },
  { value: 'hotel' as const, label: 'Hotel' },
];

interface Reservation {
  id: string;
  title: string;
  dayOrDate: string;
  time: string;
  type: 'activity' | 'food' | 'hotel';
}

export default function AddTripScreen() {
  const { addTrip, addActivity } = useTrips();
  const { profile } = useProfile();
  const { initialDest } = useLocalSearchParams<{ initialDest?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const titleRef = useRef<TextInput>(null);
  const destRef = useRef<TextInput>(null);

  // Mode: 'choose' (landing), 'quick' (Plan it for me), 'detailed' (Plan with Travonal)
  const [mode, setMode] = useState<'choose' | 'quick' | 'detailed'>('choose');

  // Required fields
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState(initialDest ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Date picker modals
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Optional fields
  const [showMore, setShowMore] = useState(false);
  // country field removed from UI; derived from destination
  const [travelers, setTravelers] = useState('');
  const [departureFrom, setDepartureFrom] = useState('');
  const [budget, setBudget] = useState<'budget' | 'moderate' | 'premium'>(profile.budget);
  const [pace, setPace] = useState<'relaxed' | 'moderate' | 'active'>(profile.pace);
  const [travelWith, setTravelWith] = useState<'solo' | 'partner' | 'family' | 'friends' | 'group'>(profile.travelWith);
  const [tripPurpose] = useState('');
  const [restrictions] = useState('');
  const [notes, setNotes] = useState('');

  // Fixed reservations
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [showAddReservation, setShowAddReservation] = useState(false);
  const [newResTitle, setNewResTitle] = useState('');
  const [newResDayOrDate, setNewResDayOrDate] = useState('');
  const [newResTime, setNewResTime] = useState('');
  const [newResType, setNewResType] = useState<'activity' | 'food' | 'hotel'>('activity');

  const today = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; })();
  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }];

  function addReservation() {
    if (!newResTitle.trim()) return;
    const time = newResTime || '19:00';
    // Validate day number
    const dayNum = parseInt(newResDayOrDate.trim() || '1', 10);
    if (isNaN(dayNum) || dayNum < 1) return;
    setReservations((prev) => [
      ...prev,
      {
        id: generateId(),
        title: newResTitle.trim(),
        dayOrDate: String(dayNum),
        time,
        type: newResType,
      },
    ]);
    setNewResTitle('');
    setNewResDayOrDate('');
    setNewResTime('');
    setNewResType('activity');
    setShowAddReservation(false);
  }

  function removeReservation(id: string) {
    setReservations((prev) => prev.filter((r) => r.id !== id));
  }

  function handleSetStartDate(date: string) {
    setStartDate(date);
    // Auto-clear end date if it's now before the new start
    if (date && endDate && endDate < date) {
      setEndDate('');
    }
  }

  // Validate end date is not before start date
  const dateWarning = startDate && endDate && endDate < startDate
    ? 'End date is before start date'
    : '';

  function handleBuild() {
    if (!title.trim() || !destination.trim()) return;
    if (!startDate || !endDate) {
      Alert.alert('Dates required', 'Please select your travel dates.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (endDate < startDate) {
      Alert.alert('Invalid dates', 'End date must be on or after the start date.');
      return;
    }

    const tripId = addTrip({
      title: title.trim(),
      destination: destination.trim(),
      country: resolveCountry(destination.trim()) ?? destination.trim(),
      emoji: pickTripEmoji(destination.trim()),
      startDate,
      endDate,
      notes: notes.trim(),
      budget,
      pace,
      travelWith,
      departurePoint: departureFrom.trim() || undefined,
      tripPurpose: tripPurpose.trim() || undefined,
      restrictions: restrictions.trim() || undefined,
      travelers: travelers ? parseInt(travelers, 10) : undefined,
      status: 'draft',
    });

    // Add fixed reservations as locked activities
    for (const r of reservations) {
      addActivity(tripId, {
        title: r.title,
        day: parseInt(r.dayOrDate, 10) || 1,
        time: r.time,
        type: r.type,
        fixed: true,
        locked: true,
      });
    }

    // "Build my own trip" goes directly to the trip workspace (no AI generation)
    router.push(`/trip/${tripId}` as any);
  }

  function handleQuickBuild() {
    if (!destination.trim()) return;
    if (!startDate || !endDate) {
      Alert.alert('Dates required', 'Please select your travel dates.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const dest = destination.trim();
    const tripTitle = title.trim() || `${dest} Trip`;

    if (endDate < startDate) {
      Alert.alert('Invalid dates', 'End date must be on or after the start date.');
      return;
    }

    const tripId = addTrip({
      title: tripTitle,
      destination: dest,
      country: resolveCountry(dest) ?? dest,
      emoji: pickTripEmoji(dest),
      startDate,
      endDate,
      notes: notes.trim() || '',
      budget: budget || profile.budget,
      pace: pace || profile.pace,
      travelWith: travelWith || profile.travelWith,
      travelers: travelers ? parseInt(travelers, 10) || undefined : undefined,
      departurePoint: departureFrom.trim() || undefined,
      status: 'draft',
    });

    // Add fixed reservations as locked activities so generateItinerary respects them
    for (const r of reservations) {
      addActivity(tripId, {
        title: r.title,
        day: parseInt(r.dayOrDate, 10) || 1,
        time: r.time,
        type: r.type,
        fixed: true,
        locked: true,
      });
    }

    router.push(`/generating-trip?tripId=${tripId}` as any);
  }

  // Compute days/nights from dates
  const daysNightsLabel = startDate && endDate && endDate >= startDate
    ? (() => {
        const [sy, sm, sd] = startDate.split('-').map(Number);
        const [ey, em, ed] = endDate.split('-').map(Number);
        const nights = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
        const days = nights + 1;
        return `${days} day${days !== 1 ? 's' : ''} / ${nights} night${nights !== 1 ? 's' : ''}`;
      })()
    : '';

  // Only title and destination are required now
  const canBuild = title.trim() && destination.trim();

  // ========== Mode chooser ==========
  if (mode === 'choose') {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.navHeader, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
          <View style={styles.navHeaderSpacer} />
          <ThemedText style={styles.navHeaderTitle}>New Trip</ThemedText>
          <Pressable onPress={() => router.back()} style={styles.navHeaderBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <ThemedText style={[styles.navHeaderClose, { color: theme.primary }]}>{'\u2715'}</ThemedText>
          </Pressable>
        </View>
        <View style={[styles.chooseContent, { paddingBottom: insets.bottom + 40 }]}>
          <ThemedText type="subtitle" style={styles.chooseTitle}>How would you like to start?</ThemedText>

          <Pressable
            onPress={() => setMode('quick')}
            style={({ pressed }) => [
              styles.chooseCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.primary, opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Start with a full plan"
          >
            <View style={styles.chooseCardHeader}>
              <ThemedText style={styles.chooseCardTitle}>Start with a full plan</ThemedText>
              <View style={[styles.recommendedBadge, { backgroundColor: theme.primaryMuted }]}>
                <ThemedText style={[styles.recommendedText, { color: theme.primary }]}>Recommended</ThemedText>
              </View>
            </View>
            <ThemedText style={[styles.chooseCardDesc, { color: theme.textSecondary }]}>
              Get a complete itinerary personalized to you. Swap, move, or change anything in seconds.
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => setMode('detailed')}
            style={({ pressed }) => [
              styles.chooseCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.9 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Build my own trip"
          >
            <ThemedText style={styles.chooseCardTitle}>Build my own trip</ThemedText>
            <ThemedText style={[styles.chooseCardDesc, { color: theme.textSecondary }]}>
              Start with an empty trip and add what you want, with Travonal ready to help at every step.
            </ThemedText>
          </Pressable>

          <ThemedText style={[styles.chooseFooter, { color: theme.textSecondary }]}>
            Whichever you choose, your trip stays flexible and effortless to update.
          </ThemedText>
        </View>
      </View>
    );
  }

  // ========== Quick mode ==========
  if (mode === 'quick') {
    return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: theme.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.navHeader, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
          <Pressable onPress={() => setMode('choose')} style={styles.navHeaderBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ThemedText style={[styles.navHeaderBack, { color: theme.primary }]}>{'\u2039'} Back</ThemedText>
          </Pressable>
          <ThemedText style={styles.navHeaderTitle}>Start with a full plan</ThemedText>
          <View style={styles.navHeaderSpacer} />
        </View>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="interactive"
        >
          <ThemedText style={[styles.quickHint, { color: theme.textSecondary }]}>
            {"Just tell us where you're going. We'll build a complete itinerary based on your travel profile."}
          </ThemedText>

          <ThemedText style={styles.label}>Where are you going? *</ThemedText>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
            value={destination}
            onChangeText={setDestination}
            placeholder="e.g. Tokyo, Barcelona, Bali..."
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            autoFocus
          />

          <ThemedText style={styles.label}>Trip name (optional)</ThemedText>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
            value={title}
            onChangeText={setTitle}
            placeholder={destination.trim() ? `${destination.trim()} Trip` : 'e.g. Summer Getaway'}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
          />

          <View style={styles.row}>
            <View style={styles.halfField}>
              <ThemedText style={styles.label}>Start date *</ThemedText>
              <Pressable
                onPress={() => setShowStartPicker(true)}
                style={[styles.dateInput, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel="Select start date"
              >
                <ThemedText style={[styles.dateInputText, { color: startDate ? theme.text : theme.textSecondary }]}>
                  {startDate ? formatDisplayDate(startDate) : 'Tap to set'}
                </ThemedText>
              </Pressable>
            </View>
            <View style={styles.halfField}>
              <ThemedText style={styles.label}>End date *</ThemedText>
              <Pressable
                onPress={() => setShowEndPicker(true)}
                style={[styles.dateInput, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                accessibilityRole="button"
                accessibilityLabel="Select end date"
              >
                <ThemedText style={[styles.dateInputText, { color: endDate ? theme.text : theme.textSecondary }]}>
                  {endDate ? formatDisplayDate(endDate) : 'Tap to set'}
                </ThemedText>
              </Pressable>
            </View>
          </View>

          {dateWarning ? (
            <ThemedText style={styles.dateWarning}>{dateWarning}</ThemedText>
          ) : null}
          {daysNightsLabel ? (
            <ThemedText style={[styles.daysNightsLabel, { color: theme.primary }]}>{daysNightsLabel}</ThemedText>
          ) : null}

          <DatePickerModal
            visible={showStartPicker}
            label="Start date"
            value={startDate}
            onSelect={handleSetStartDate}
            onClose={() => setShowStartPicker(false)}
            minDate={today}
          />
          <DatePickerModal
            visible={showEndPicker}
            label="End date"
            value={endDate || startDate}
            onSelect={setEndDate}
            onClose={() => setShowEndPicker(false)}
            minDate={startDate || today}
          />

          {/* Optional details */}
          <Pressable onPress={() => setShowMore(!showMore)} style={styles.showMoreBtn} accessibilityRole="button" accessibilityLabel="Toggle more details">
            <ThemedText style={[styles.showMoreText, { color: theme.primary }]}>
              {showMore ? '\uFF0D Fewer details' : '\uFF0B Add more details (optional)'}
            </ThemedText>
          </Pressable>

          {showMore && (
            <>
              <ThemedText style={styles.label}>Number of travelers</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={travelers}
                onChangeText={setTravelers}
                placeholder="e.g. 2"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                returnKeyType="done"
                accessibilityLabel="Number of travelers"
              />

              <ThemedText style={styles.label}>Departing from</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={departureFrom}
                onChangeText={setDepartureFrom}
                placeholder="e.g. New York"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="next"
              />

              <ThemedText style={styles.label}>Notes</ThemedText>
              <TextInput
                style={[styles.input, styles.multilineInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Anything else we should know..."
                placeholderTextColor={theme.textSecondary}
                multiline
                textAlignVertical="top"
              />
            </>
          )}

          {/* Fixed reservations */}
          <ThemedText type="eyebrow" style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing.four }]}>
            Fixed reservations (optional)
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.two }}>
            Pre-booked things that cannot be moved
          </ThemedText>

          {reservations.map((res) => (
            <View
              key={res.id}
              style={[styles.reservationCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            >
              <View style={styles.reservationInfo}>
                <ThemedText type="smallBold">{res.title}</ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Day {res.dayOrDate} at {res.time} · {res.type}
                </ThemedText>
              </View>
              <Pressable onPress={() => removeReservation(res.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove reservation">
                <ThemedText style={{ color: theme.danger, fontSize: 14, fontWeight: '600' }}>Remove</ThemedText>
              </Pressable>
            </View>
          ))}

          {showAddReservation ? (
            <View style={[styles.addResForm, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={newResTitle}
                onChangeText={setNewResTitle}
                placeholder="e.g. Dinner at La Maison"
                placeholderTextColor={theme.textSecondary}
              />
              <View style={styles.row}>
                <View style={styles.halfField}>
                  <ThemedText type="small" style={{ marginBottom: 4 }}>Day number</ThemedText>
                  <TextInput
                    style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                    value={newResDayOrDate}
                    onChangeText={setNewResDayOrDate}
                    placeholder="1"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.halfField}>
                  <ThemedText type="small" style={{ marginBottom: 4 }}>Time</ThemedText>
                  <TimePickerButton
                    value={newResTime || '19:00'}
                    onChange={setNewResTime}
                  />
                </View>
              </View>
              <View style={styles.chipRow}>
                {RESERVATION_TYPES.map((t) => (
                  <Pressable
                    key={t.value}
                    onPress={() => setNewResType(t.value)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: newResType === t.value ? theme.primary : theme.backgroundElement,
                        borderColor: newResType === t.value ? theme.primary : theme.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Type: ${t.label}`}
                  >
                    <ThemedText style={[styles.chipText, newResType === t.value && { color: theme.primaryText }]}>
                      {t.label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <View style={styles.row}>
                <Pressable
                  onPress={addReservation}
                  style={[styles.smallButton, { backgroundColor: theme.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel="Add reservation"
                >
                  <ThemedText style={[styles.smallButtonText, { color: theme.primaryText }]}>Add</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setShowAddReservation(false)}
                  style={[styles.smallButton, { backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel reservation"
                >
                  <ThemedText style={[styles.smallButtonText, { color: theme.text }]}>Cancel</ThemedText>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => setShowAddReservation(true)}
              style={[styles.addButton, { borderColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Add reservation"
            >
              <ThemedText style={[styles.addButtonText, { color: theme.primary }]}>
                + Add reservation
              </ThemedText>
            </Pressable>
          )}

          <Pressable
            onPress={handleQuickBuild}
            style={({ pressed }) => [
              styles.buildButton,
              { backgroundColor: theme.primary, opacity: !destination.trim() ? 0.4 : pressed ? 0.85 : 1 },
            ]}
            disabled={!destination.trim()}
            accessibilityRole="button"
            accessibilityLabel="Build my trip"
          >
            <ThemedText style={[styles.buildButtonText, { color: theme.primaryText }]}>Build my trip</ThemedText>
          </Pressable>

          <Pressable onPress={() => setMode('detailed')} style={styles.switchModeBtn} accessibilityRole="button" accessibilityLabel="Build my own trip">
            <ThemedText style={[styles.switchModeText, { color: theme.textSecondary }]}>
              Want more control? Build my own trip
            </ThemedText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ========== Detailed mode ==========
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.navHeader, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => setMode('choose')} style={styles.navHeaderBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ThemedText style={[styles.navHeaderBack, { color: theme.primary }]}>{'\u2039'} Back</ThemedText>
        </Pressable>
        <ThemedText style={styles.navHeaderTitle}>Build my own trip</ThemedText>
        <View style={styles.navHeaderSpacer} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="interactive"
      >

        {/* Required fields */}
        <ThemedText type="eyebrow" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          Trip details
        </ThemedText>

        <ThemedText style={styles.label}>Title *</ThemedText>
        <TextInput
          ref={titleRef}
          style={inputStyle}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Miami 2026"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => destRef.current?.focus()}
        />

        <ThemedText style={styles.label}>Destination *</ThemedText>
        <TextInput
          ref={destRef}
          style={inputStyle}
          value={destination}
          onChangeText={setDestination}
          placeholder="e.g. Miami"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          returnKeyType="done"
        />

        <View style={styles.row}>
          <View style={styles.halfField}>
            <ThemedText style={styles.label}>Start date *</ThemedText>
            <Pressable
              onPress={() => setShowStartPicker(true)}
              style={[styles.dateInput, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel="Select start date"
            >
              <ThemedText style={[styles.dateInputText, { color: startDate ? theme.text : theme.textSecondary }]}>
                {startDate ? formatDisplayDate(startDate) : 'Tap to set'}
              </ThemedText>
            </Pressable>
          </View>
          <View style={styles.halfField}>
            <ThemedText style={styles.label}>End date *</ThemedText>
            <Pressable
              onPress={() => setShowEndPicker(true)}
              style={[styles.dateInput, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel="Select end date"
            >
              <ThemedText style={[styles.dateInputText, { color: endDate ? theme.text : theme.textSecondary }]}>
                {endDate ? formatDisplayDate(endDate) : 'Tap to set'}
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {dateWarning ? (
          <ThemedText style={styles.dateWarning}>{dateWarning}</ThemedText>
        ) : null}
        {daysNightsLabel ? (
          <ThemedText style={[styles.daysNightsLabel, { color: theme.primary }]}>{daysNightsLabel}</ThemedText>
        ) : null}

        {/* Date picker modals */}
        <DatePickerModal
          visible={showStartPicker}
          label="Start date"
          value={startDate}
          onSelect={handleSetStartDate}
          onClose={() => setShowStartPicker(false)}
          minDate={today}
        />
        <DatePickerModal
          visible={showEndPicker}
          label="End date"
          value={endDate || startDate}
          onSelect={setEndDate}
          onClose={() => setShowEndPicker(false)}
          minDate={startDate || today}
        />

        {/* More options toggle */}
        <Pressable onPress={() => setShowMore(!showMore)} style={styles.showMoreBtn} accessibilityRole="button" accessibilityLabel="Toggle more details">
          <ThemedText style={[styles.showMoreText, { color: theme.primary }]}>
            {showMore ? '\uFF0D Fewer details' : '\uFF0B Add more details (optional)'}
          </ThemedText>
        </Pressable>

        {showMore && (
          <>
            <ThemedText style={styles.label}>Travelers</ThemedText>
            <TextInput
              style={inputStyle}
              value={travelers}
              onChangeText={(text) => {
                const num = text.replace(/[^0-9]/g, '');
                const val = parseInt(num, 10);
                if (num === '' || (val >= 1 && val <= 20)) setTravelers(num);
              }}
              placeholder="1-20"
              placeholderTextColor={theme.textSecondary}
              keyboardType="number-pad"
            />

            <ThemedText style={styles.label}>Departing from</ThemedText>
            <TextInput
              style={inputStyle}
              value={departureFrom}
              onChangeText={setDepartureFrom}
              placeholder="e.g. New York"
              placeholderTextColor={theme.textSecondary}
            />

            <ThemedText style={styles.label}>Budget</ThemedText>
            <View style={styles.chipRow}>
              {BUDGET_OPTIONS.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => setBudget(o.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: budget === o.value ? theme.primary : theme.backgroundElement,
                      borderColor: budget === o.value ? theme.primary : theme.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Budget: ${o.label}`}
                >
                  <ThemedText style={[styles.chipText, budget === o.value && { color: theme.primaryText }]}>
                    {o.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <ThemedText style={styles.label}>Pace</ThemedText>
            <View style={styles.chipRow}>
              {PACE_OPTIONS.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => setPace(o.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: pace === o.value ? theme.primary : theme.backgroundElement,
                      borderColor: pace === o.value ? theme.primary : theme.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Pace: ${o.label}`}
                >
                  <ThemedText style={[styles.chipText, pace === o.value && { color: theme.primaryText }]}>
                    {o.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <ThemedText style={styles.label}>Traveling with</ThemedText>
            <View style={styles.chipRow}>
              {TRAVEL_WITH_OPTIONS.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => setTravelWith(o.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: travelWith === o.value ? theme.primary : theme.backgroundElement,
                      borderColor: travelWith === o.value ? theme.primary : theme.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Travel with: ${o.label}`}
                >
                  <ThemedText style={[styles.chipText, travelWith === o.value && { color: theme.primaryText }]}>
                    {o.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>

            <ThemedText style={styles.label}>Notes</ThemedText>
            <TextInput
              style={[...inputStyle, styles.multilineInput]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Dietary needs, mobility, anything else\u2026"
              placeholderTextColor={theme.textSecondary}
              multiline
              textAlignVertical="top"
            />
          </>
        )}

        {/* Fixed reservations */}
        <ThemedText type="eyebrow" style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing.four }]}>
          Fixed reservations
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.two }}>
          Pre-booked things that cannot be moved
        </ThemedText>

        {reservations.map((res) => (
          <View
            key={res.id}
            style={[styles.reservationCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          >
            <View style={styles.reservationInfo}>
              <ThemedText type="smallBold">{res.title}</ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Day {res.dayOrDate} at {res.time} · {res.type}
              </ThemedText>
            </View>
            <Pressable onPress={() => removeReservation(res.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove reservation">
              <ThemedText style={{ color: theme.danger, fontSize: 14, fontWeight: '600' }}>Remove</ThemedText>
            </Pressable>
          </View>
        ))}

        {showAddReservation ? (
          <View style={[styles.addResForm, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <TextInput
              style={inputStyle}
              value={newResTitle}
              onChangeText={setNewResTitle}
              placeholder="e.g. Dinner at La Maison"
              placeholderTextColor={theme.textSecondary}
            />
            <View style={styles.row}>
              <View style={styles.halfField}>
                <ThemedText type="small" style={{ marginBottom: 4 }}>Day number</ThemedText>
                <TextInput
                  style={inputStyle}
                  value={newResDayOrDate}
                  onChangeText={setNewResDayOrDate}
                  placeholder="1"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.halfField}>
                <ThemedText type="small" style={{ marginBottom: 4 }}>Time</ThemedText>
                <TimePickerButton
                  value={newResTime || '19:00'}
                  onChange={setNewResTime}
                />
              </View>
            </View>
            <View style={styles.chipRow}>
              {RESERVATION_TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  onPress={() => setNewResType(t.value)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: newResType === t.value ? theme.primary : theme.backgroundElement,
                      borderColor: newResType === t.value ? theme.primary : theme.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Type: ${t.label}`}
                >
                  <ThemedText style={[styles.chipText, newResType === t.value && { color: theme.primaryText }]}>
                    {t.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <Pressable
                onPress={addReservation}
                style={[styles.smallButton, { backgroundColor: theme.primary }]}
                accessibilityRole="button"
                accessibilityLabel="Add reservation"
              >
                <ThemedText style={[styles.smallButtonText, { color: theme.primaryText }]}>Add</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setShowAddReservation(false)}
                style={[styles.smallButton, { backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.border }]}
                accessibilityRole="button"
                accessibilityLabel="Cancel reservation"
              >
                <ThemedText style={[styles.smallButtonText, { color: theme.text }]}>Cancel</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setShowAddReservation(true)}
            style={[styles.addButton, { borderColor: theme.primary }]}
            accessibilityRole="button"
            accessibilityLabel="Add reservation"
          >
            <ThemedText style={[styles.addButtonText, { color: theme.primary }]}>
              + Add reservation
            </ThemedText>
          </Pressable>
        )}

        {/* Build button */}
        <Pressable
          onPress={handleBuild}
          style={({ pressed }) => [
            styles.buildButton,
            { backgroundColor: theme.primary, opacity: !canBuild ? 0.4 : pressed ? 0.85 : 1 },
          ]}
          disabled={!canBuild}
          accessibilityRole="button"
          accessibilityLabel="Build my trip"
        >
          <ThemedText style={[styles.buildButtonText, { color: theme.primaryText }]}>Build my trip</ThemedText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navHeaderTitle: { fontSize: 17, fontWeight: '600' as const, textAlign: 'center' as const },
  navHeaderBtn: { width: 64 },
  navHeaderSpacer: { width: 64 },
  navHeaderBack: { fontSize: 17, fontWeight: '500' as const },
  navHeaderClose: { fontSize: 22, fontWeight: '300' as const, textAlign: 'right' as const },
  scrollContent: { padding: Spacing.four, gap: 4 },
  sectionTitle: {
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  label: { fontSize: 14, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    minHeight: 48,
  },
  row: { flexDirection: 'row', gap: 12 },
  halfField: { flex: 1 },
  multilineInput: { minHeight: 80, paddingTop: 12 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginBottom: Spacing.two,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: '500' },
  showMoreBtn: { paddingVertical: 12, alignItems: 'center' },
  showMoreText: { fontSize: 14, fontWeight: '600' },

  // Date input (tappable)
  dateInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  dateInputText: { fontSize: 16 },
  dateWarning: { color: '#DC2626', fontSize: 13, fontWeight: '500', marginTop: 4 },
  daysNightsLabel: { fontSize: 13, fontWeight: '600', marginTop: 4, textAlign: 'center' as const },

  // Reservations
  reservationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  reservationInfo: { flex: 1, gap: 2 },
  addResForm: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
    marginBottom: 8,
  },
  addButton: {
    borderWidth: 1.5,
    borderRadius: 10,
    borderStyle: 'dashed',
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonText: { fontSize: 14, fontWeight: '600' },
  smallButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  smallButtonText: { fontSize: 14, fontWeight: '600' },
  buildButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: Spacing.four,
  },
  buildButtonText: { fontSize: 17, fontWeight: '700' },

  // Choose mode
  chooseContent: {
    flex: 1,
    padding: Spacing.four,
    justifyContent: 'center',
    gap: 16,
  },
  chooseTitle: { textAlign: 'center', marginBottom: 8 },
  chooseCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 20,
    gap: 8,
  },
  chooseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  chooseCardTitle: { fontSize: 17, fontWeight: '700' },
  chooseCardDesc: { fontSize: 14, lineHeight: 21 },
  recommendedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recommendedText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  chooseFooter: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 8 },

  // Quick mode
  quickHint: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  backLink: { paddingVertical: 8, marginBottom: 8 },
  backLinkText: { fontSize: 16, fontWeight: '600' },
  switchModeBtn: { paddingVertical: 16, alignItems: 'center' },
  switchModeText: { fontSize: 14, fontWeight: '500' },
});
