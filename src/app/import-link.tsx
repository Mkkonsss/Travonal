import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { TimePickerButton, defaultTimeForType, defaultDurationForType } from '@/components/time-picker';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useInbox } from '@/context/inbox';
import { useTrips } from '@/context/trips';
import { useTheme } from '@/hooks/use-theme';
import { simulateImportIdentification } from '@/services/mock-generator';
import { sortTripsForPicker } from '@/services/trip-helpers';

type Phase = 'input' | 'analyzing' | 'result';

export default function ImportLinkScreen() {
  const router = useRouter();
  const { tripId, day } = useLocalSearchParams<{ tripId?: string; day?: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { addItem } = useInbox();
  const { trips, addActivity } = useTrips();

  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [result, setResult] = useState<ReturnType<typeof simulateImportIdentification> | null>(null);
  const [addToTripTime, setAddToTripTime] = useState('10:00');
  const [addToTripDuration, setAddToTripDuration] = useState(60);
  const [pendingTripId, setPendingTripId] = useState<string | null>(null);
  const [pendingDay, setPendingDay] = useState<number | null>(null);
  const [sheetState, setSheetState] = useState<{
    title: string;
    subtitle?: string;
    options: SelectionOption[];
    onSelect: (value: string) => void;
  } | null>(null);

  const [urlError, setUrlError] = useState('');
  const [editedTitle, setEditedTitle] = useState('');
  const [editedNotes, setEditedNotes] = useState('');
  const [editedAddress, setEditedAddress] = useState('');

  function isValidUrl(text: string): boolean {
    const trimmed = text.trim();
    // Accept URLs with protocol or common domains
    return /^https?:\/\/.+/.test(trimmed) ||
      /^www\..+/.test(trimmed) ||
      /\.(com|org|net|io|co|app|dev|me)\b/.test(trimmed);
  }

  /** Try to infer a destination from the URL */
  function inferDestination(urlStr: string): string {
    const lower = urlStr.toLowerCase();
    const cityMap: Record<string, string> = {
      'tokyo': 'Tokyo', 'kyoto': 'Kyoto', 'osaka': 'Osaka',
      'barcelona': 'Barcelona', 'paris': 'Paris', 'london': 'London',
      'rome': 'Rome', 'new-york': 'New York', 'newyork': 'New York',
      'miami': 'Miami', 'bali': 'Bali', 'lisbon': 'Lisbon',
    };
    for (const [key, city] of Object.entries(cityMap)) {
      if (lower.includes(key)) return city;
    }
    return 'Unknown';
  }

  function handleAnalyze() {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!isValidUrl(trimmed)) {
      setUrlError('Please enter a valid URL (e.g. https://...)');
      return;
    }
    setUrlError('');
    setPhase('analyzing');

    // Simulate analysis delay
    setTimeout(() => {
      const identified = simulateImportIdentification(trimmed);
      // Try to infer destination from URL
      if (identified.destination === 'Unknown') {
        identified.destination = inferDestination(trimmed);
      }
      setResult(identified);
      setEditedTitle(identified.title);
      setEditedNotes('');
      setEditedAddress('');
      setAddToTripTime(defaultTimeForType(identified.type));
      setAddToTripDuration(defaultDurationForType(identified.type));
      setPhase('result');
    }, 1200);
  }

  function buildDescription(): string {
    const parts: string[] = [];
    if (editedAddress.trim()) parts.push(editedAddress.trim());
    if (editedNotes.trim()) parts.push(editedNotes.trim());
    return parts.length > 0 ? parts.join('\n') : (result?.description ?? '');
  }

  function handleSave() {
    if (!result) return;
    const finalTitle = editedTitle.trim() || result.title;
    Alert.alert('Save to inbox?', `"${finalTitle}" will be added to your inbox.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          addItem({
            type: 'link',
            title: finalTitle,
            destination: result.destination,
            source: url.trim(),
            category: result.category,
            cost: result.cost,
            duration: result.duration,
            description: buildDescription(),
            tags: result.tags,
            status: 'needs_trip',
          });
          Alert.alert('Saved!', `"${finalTitle}" added to your inbox.`, [
            { text: 'OK', onPress: () => router.back() },
          ]);
        },
      },
    ]);
  }

  function handleTryAnother() {
    setUrl('');
    setResult(null);
    setPhase('input');
  }

  function handleAddToTrip() {
    const tid = tripId || pendingTripId;
    const d = day ? Number(day) : pendingDay;
    if (!result || !tid || !d) return;
    const finalTitle = editedTitle.trim() || result.title;
    addActivity(tid, {
      day: d,
      title: finalTitle,
      time: addToTripTime,
      duration: addToTripDuration,
      type: result.type,
      category: result.category,
      cost: result.cost,
      description: buildDescription(),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  function openTripPicker() {
    if (trips.length === 0) {
      Alert.alert('No trips yet', 'Create a trip first, then add activities.');
      return;
    }
    const sorted = sortTripsForPicker(trips, result?.destination);
    if (sorted.length === 1) {
      openDayPicker(sorted[0].id);
      return;
    }
    setSheetState({
      title: 'Add to which trip?',
      options: sorted.map((t) => ({ label: `${t.emoji} ${t.destination}`, value: t.id })),
      onSelect: (id) => { setSheetState(null); openDayPicker(id); },
    });
  }

  function openDayPicker(tid: string) {
    const trip = trips.find((t) => t.id === tid);
    if (!trip) return;
    const [sy, sm, sd] = trip.startDate.split('-').map(Number);
    const [ey, em, ed] = trip.endDate.split('-').map(Number);
    const totalDays = Math.max(1, Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1);
    if (totalDays <= 1) { setPendingTripId(tid); setPendingDay(1); return; }
    setSheetState({
      title: 'Which day?',
      subtitle: `Add to ${trip.emoji} ${trip.destination}`,
      options: Array.from({ length: totalDays }, (_, i) => ({ label: `Day ${i + 1}`, value: String(i + 1) })),
      onSelect: (dayStr) => { setSheetState(null); setPendingTripId(tid); setPendingDay(Number(dayStr)); },
    });
  }

  const costLabels: Record<string, string> = {
    free: 'Free',
    budget: '$',
    moderate: '$$',
    premium: '$$$',
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.closeButton} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <ThemedText style={[styles.closeText, { color: theme.primary }]}>{'\u2715'}</ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Paste a Link</ThemedText>
        <View style={styles.closeButton} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        {phase === 'input' && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.inputSection}>
            <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
              Paste a link to a place, restaurant, or activity
            </ThemedText>

            <TextInput
              style={[styles.urlInput, { color: theme.text, borderColor: theme.border }]}
              value={url}
              onChangeText={setUrl}
              placeholder="https://..."
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={handleAnalyze}
              returnKeyType="go"
            />

            {urlError ? (
              <ThemedText style={styles.urlError}>{urlError}</ThemedText>
            ) : (
              <ThemedText type="small" style={[styles.examples, { color: theme.textSecondary }]}>
                Try: restaurant, museum, hike, tiktok, instagram
              </ThemedText>
            )}

            <Pressable
              onPress={handleAnalyze}
              disabled={!url.trim()}
              style={({ pressed }) => [
                styles.analyzeBtn,
                { backgroundColor: theme.primary, opacity: !url.trim() ? 0.4 : pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Analyze link"
            >
              <ThemedText style={[styles.analyzeBtnText, { color: theme.primaryText }]}>Analyze link</ThemedText>
            </Pressable>
          </Animated.View>
        )}

        {phase === 'analyzing' && (
          <Animated.View entering={FadeIn.duration(200)} style={styles.analyzingSection}>
            <ThemedText style={styles.analyzingIcon}>{'\u{1F50D}'}</ThemedText>
            <ThemedText type="headline">Analyzing...</ThemedText>
            <ThemedText style={[styles.analyzingDesc, { color: theme.textSecondary }]}>
              Reading the link and identifying the place
            </ThemedText>
          </Animated.View>
        )}

        {phase === 'result' && result && (
          <Animated.View entering={FadeInDown.springify()} style={styles.resultSection}>
            <View style={[styles.demoBanner, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.demoBannerText, { color: theme.primary }]}>
                Simulated parsing — review and edit before saving
              </ThemedText>
            </View>

            <View style={[styles.resultCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>Title</ThemedText>
              <TextInput
                style={[styles.editInput, { color: theme.text, borderColor: theme.border }]}
                value={editedTitle}
                onChangeText={setEditedTitle}
                placeholder="Place name"
                placeholderTextColor={theme.textSecondary}
              />
              <ThemedText style={[styles.resultDesc, { color: theme.textSecondary }]}>
                {result.description}
              </ThemedText>
              <View style={styles.resultMeta}>
                <View style={[styles.resultTag, { backgroundColor: theme.primaryMuted }]}>
                  <ThemedText style={[styles.resultTagText, { color: theme.primary }]}>{result.type}</ThemedText>
                </View>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {costLabels[result.cost]} {'\u00B7'} {result.duration}m
                </ThemedText>
              </View>
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginTop: 4 }}>Address (optional)</ThemedText>
              <TextInput
                style={[styles.editInput, { color: theme.text, borderColor: theme.border }]}
                value={editedAddress}
                onChangeText={setEditedAddress}
                placeholder="123 Main St, City"
                placeholderTextColor={theme.textSecondary}
              />
              <ThemedText type="eyebrow" style={{ color: theme.textSecondary, marginTop: 4 }}>Notes (optional)</ThemedText>
              <TextInput
                style={[styles.editInput, { color: theme.text, borderColor: theme.border, minHeight: 56 }]}
                value={editedNotes}
                onChangeText={setEditedNotes}
                placeholder="Add notes..."
                placeholderTextColor={theme.textSecondary}
                multiline
              />
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Link: {url.length > 40 ? url.slice(0, 40) + '…' : url}
              </ThemedText>
            </View>

            {/* Add to trip section — shown when context is pre-set or user selected a trip */}
            {(tripId && day) || (pendingTripId && pendingDay) ? (
              <View style={[styles.addToTripSection, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>
                  Add to trip {'\u2014'} Day {day ?? pendingDay}
                </ThemedText>
                <TimePickerButton
                  value={addToTripTime}
                  onChange={setAddToTripTime}
                  showDuration
                  duration={addToTripDuration}
                  onDurationChange={setAddToTripDuration}
                />
                <Pressable
                  onPress={handleAddToTrip}
                  style={({ pressed }) => [styles.saveBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Add to trip"
                >
                  <ThemedText style={[styles.saveBtnText, { color: theme.primaryText }]}>Add to trip</ThemedText>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={openTripPicker}
                style={({ pressed }) => [styles.saveBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Add to a trip"
              >
                <ThemedText style={[styles.saveBtnText, { color: theme.primaryText }]}>Add to a trip</ThemedText>
              </Pressable>
            )}

            <View style={styles.resultActions}>
              {!(tripId && day) && (
                <Pressable
                  onPress={handleSave}
                  style={({ pressed }) => [
                    styles.saveBtn,
                    { backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Save to inbox"
                >
                  <ThemedText style={[styles.saveBtnText, { color: theme.text }]}>Save to inbox</ThemedText>
                </Pressable>
              )}
              <Pressable onPress={handleTryAnother} style={styles.tryAnotherBtn} accessibilityRole="button" accessibilityLabel="Try another link">
                <ThemedText style={[styles.tryAnotherText, { color: theme.textSecondary }]}>
                  Try another link
                </ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {sheetState && (
        <SelectionSheet
          visible={!!sheetState}
          title={sheetState.title}
          subtitle={sheetState.subtitle}
          options={sheetState.options}
          onSelect={sheetState.onSelect}
          onClose={() => setSheetState(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingBottom: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  closeButton: { width: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 20, fontWeight: '400' },
  content: { padding: Spacing.four },
  demoBanner: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' as const, marginBottom: 4 },
  demoBannerText: { fontSize: 12, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  editInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, marginBottom: 4 },

  // Input
  inputSection: { gap: 16 },
  hint: { fontSize: 15, lineHeight: 22 },
  urlInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  examples: { fontStyle: 'italic' },
  urlError: { color: '#DC2626', fontSize: 13, fontWeight: '500' },
  analyzeBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  analyzeBtnText: { fontSize: 17, fontWeight: '700' },

  // Analyzing
  analyzingSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  analyzingIcon: { fontSize: 48, lineHeight: 60, marginBottom: 8 },
  analyzingDesc: { fontSize: 14 },

  // Result
  resultSection: { gap: 16 },
  resultCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  resultTitle: { fontSize: 18, fontWeight: '700' },
  resultDesc: { fontSize: 14, lineHeight: 20 },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resultTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  resultTagText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  resultTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  addToTripSection: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  resultActions: { gap: 10 },
  saveBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 17, fontWeight: '700' },
  tryAnotherBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  tryAnotherText: { fontSize: 15, fontWeight: '500' },
});
