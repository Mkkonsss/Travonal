import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';

import { TimePickerButton, defaultTimeForType, defaultDurationForType } from '@/components/time-picker';
import { SelectionSheet, SelectionOption } from '@/components/selection-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useInbox } from '@/context/inbox';
import { useTrips } from '@/context/trips';
import { useTheme } from '@/hooks/use-theme';
import { simulateImportIdentification } from '@/services/mock-generator';
import { sortTripsForPicker } from '@/services/trip-helpers';

type Phase = 'select' | 'analyzing' | 'result';

export default function ImportScreenshotScreen() {
  const router = useRouter();
  const { tripId, day } = useLocalSearchParams<{ tripId?: string; day?: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { addItem } = useInbox();
  const { trips, addActivity } = useTrips();

  const [phase, setPhase] = useState<Phase>('select');
  const [result, setResult] = useState<ReturnType<typeof simulateImportIdentification> | null>(null);
  const [selectedMediaUri, setSelectedMediaUri] = useState<string | null>(null);
  const [selectedMediaType, setSelectedMediaType] = useState<'image' | 'video'>('image');
  const [addToTripTime, setAddToTripTime] = useState('10:00');
  const [addToTripDuration, setAddToTripDuration] = useState(60);
  const [pendingTripId, setPendingTripId] = useState<string | null>(null);
  const [pendingDay, setPendingDay] = useState<number | null>(null);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedNotes, setEditedNotes] = useState('');
  const [editedAddress, setEditedAddress] = useState('');
  const [sheetState, setSheetState] = useState<{
    title: string;
    subtitle?: string;
    options: SelectionOption[];
    onSelect: (value: string) => void;
  } | null>(null);

  async function handlePickMedia(mediaType: 'image' | 'video') {
    const permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permResult.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photos to import media.');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaType === 'video' ? ['videos'] : ['images'],
      quality: 0.8,
    });

    if (pickerResult.canceled || !pickerResult.assets?.[0]) return;

    const asset = pickerResult.assets[0];
    setSelectedMediaType(mediaType);

    // Store the original temp URI — permanent copy happens only on inbox save
    setMediaLoadError(false);
    setSelectedMediaUri(asset.uri);
    setPhase('analyzing');

    // Simulate identification from the image filename/uri
    const uriLower = asset.uri.toLowerCase();
    const source = uriLower.includes('food') || uriLower.includes('restaurant')
      ? 'restaurant-post'
      : uriLower.includes('museum') || uriLower.includes('art')
      ? 'museum-gallery'
      : uriLower.includes('hike') || uriLower.includes('trail') || uriLower.includes('nature')
      ? 'hike-nature-trail'
      : 'instagram-food';

    setTimeout(() => {
      const identified = simulateImportIdentification(source);
      setResult(identified);
      setEditedTitle(identified.title);
      setEditedNotes('');
      setEditedAddress('');
      setAddToTripTime(defaultTimeForType(identified.type));
      setAddToTripDuration(defaultDurationForType(identified.type));
      setPhase('result');
    }, 1500);
  }

  function buildDescription(): string {
    const parts: string[] = [];
    if (editedAddress.trim()) parts.push(editedAddress.trim());
    if (editedNotes.trim()) parts.push(editedNotes.trim());
    return parts.length > 0 ? parts.join('\n') : (result?.description ?? '');
  }

  async function handleSave() {
    if (!result) return;
    const finalTitle = editedTitle.trim() || result.title;

    Alert.alert('Save to inbox?', `"${finalTitle}" will be added to your inbox.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: async () => {
          let permanentUri: string | undefined;
          if (selectedMediaUri) {
            try {
              const ext = selectedMediaUri.split('.').pop()?.split('?')[0] ?? 'jpg';
              const filename = `inbox_${Date.now()}.${ext}`;
              const destDir = new Directory(Paths.document, 'inbox');
              if (!destDir.exists) destDir.create();
              const destFile = new File(destDir, filename);
              const srcFile = new File(selectedMediaUri);
              await srcFile.copy(destFile);
              permanentUri = destFile.uri;
            } catch {
              Alert.alert('Save failed', 'Could not copy the media file. Please try again.');
              return;
            }
          }

          const itemType = selectedMediaType === 'video' ? 'video' as const : 'photo' as const;
          addItem({
            type: itemType,
            title: finalTitle,
            destination: result.destination,
            source: 'Camera Roll',
            category: result.category,
            cost: result.cost,
            duration: result.duration,
            description: buildDescription(),
            tags: result.tags,
            status: 'needs_trip',
            mediaUri: permanentUri,
            mediaType: selectedMediaType,
          });
          Alert.alert('Saved!', `"${finalTitle}" added to your inbox.`, [
            { text: 'OK', onPress: () => router.back() },
          ]);
        },
      },
    ]);
  }

  function handleTryAnother() {
    setResult(null);
    setSelectedMediaUri(null);
    setPhase('select');
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
        <ThemedText style={styles.headerTitle}>Import Media</ThemedText>
        <View style={styles.closeButton} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        {phase === 'select' && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.selectSection}>
            <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
              Choose a photo or video from your device. Travonal will simulate identifying the place and add it to your inbox.
            </ThemedText>

            <Pressable
              onPress={() => handlePickMedia('image')}
              style={({ pressed }) => [
                styles.pickMediaBtn,
                {
                  backgroundColor: theme.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Choose photo"
            >
              <ThemedText style={styles.pickMediaIcon}>{'\u{1F4F7}'}</ThemedText>
              <ThemedText style={[styles.pickMediaText, { color: theme.primaryText }]}>Choose photo</ThemedText>
            </Pressable>

            <Pressable
              onPress={() => handlePickMedia('video')}
              style={({ pressed }) => [
                styles.pickMediaBtn,
                {
                  backgroundColor: theme.backgroundElement,
                  borderWidth: 1,
                  borderColor: theme.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Choose video"
            >
              <ThemedText style={styles.pickMediaIcon}>{'\u{1F3AC}'}</ThemedText>
              <ThemedText style={[styles.pickMediaText, { color: theme.text }]}>Choose video</ThemedText>
            </Pressable>

            <ThemedText style={[styles.pickMediaHint, { color: theme.textSecondary }]}>
              Supports screenshots, photos of menus, social media posts, and video clips
            </ThemedText>
          </Animated.View>
        )}

        {phase === 'analyzing' && (
          <Animated.View entering={FadeIn.duration(200)} style={styles.analyzingSection}>
            <ThemedText style={styles.analyzingIcon}>
              {selectedMediaType === 'video' ? '\u{1F3AC}' : '\u{1F4F7}'}
            </ThemedText>
            <ThemedText type="headline">Simulating identification...</ThemedText>
            <ThemedText style={[styles.analyzingDesc, { color: theme.textSecondary }]}>
              Demo mode — actual recognition will be added later
            </ThemedText>
          </Animated.View>
        )}

        {phase === 'result' && result && (
          <Animated.View entering={FadeInDown.springify()} style={styles.resultSection}>
            <View style={[styles.demoBanner, { backgroundColor: theme.primaryMuted }]}>
              <ThemedText style={[styles.demoBannerText, { color: theme.primary }]}>
                Simulated identification — demo result
              </ThemedText>
            </View>

            {selectedMediaUri && selectedMediaType === 'image' && (
              <Pressable onPress={() => !mediaLoadError && setViewerVisible(true)} accessibilityRole="button" accessibilityLabel="View full image">
                {mediaLoadError ? (
                  <View style={[styles.previewImage, styles.mediaErrorBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>Image unavailable</ThemedText>
                  </View>
                ) : (
                  <Image
                    source={{ uri: selectedMediaUri }}
                    style={styles.previewImage}
                    resizeMode="cover"
                    onError={() => setMediaLoadError(true)}
                  />
                )}
              </Pressable>
            )}

            {selectedMediaUri && selectedMediaType === 'video' && (
              <View style={[styles.videoPreview, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <ThemedText style={styles.videoIcon}>{'\u{1F3AC}'}</ThemedText>
                <ThemedText style={[styles.videoLabel, { color: theme.textSecondary }]}>Video selected</ThemedText>
              </View>
            )}

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
              <Pressable onPress={handleTryAnother} style={styles.tryAnotherBtn} accessibilityRole="button" accessibilityLabel="Try another file">
                <ThemedText style={[styles.tryAnotherText, { color: theme.textSecondary }]}>
                  Try another file
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

      <Modal visible={viewerVisible} transparent animationType="fade" onRequestClose={() => setViewerVisible(false)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerVisible(false)} accessibilityRole="button" accessibilityLabel="Close image viewer">
          <Image
            source={{ uri: selectedMediaUri ?? '' }}
            style={styles.viewerImage}
            resizeMode="contain"
          />
          <View style={styles.viewerCloseBtn}>
            <ThemedText style={styles.viewerCloseText}>{'\u2715'}</ThemedText>
          </View>
          <ThemedText style={styles.viewerCloseHint}>Tap anywhere to close</ThemedText>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingBottom: 12, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  closeButton: { width: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 20, fontWeight: '400' },
  content: { padding: Spacing.four, flexGrow: 1 },
  editInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, marginBottom: 4 },

  // Select
  selectSection: { gap: 16, alignItems: 'center', paddingTop: 40 },
  hint: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  pickMediaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: '100%',
  },
  pickMediaIcon: { fontSize: 20, lineHeight: 26 },
  pickMediaText: { fontSize: 17, fontWeight: '700' },
  pickMediaHint: { fontSize: 13, textAlign: 'center', lineHeight: 20 },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
  },
  mediaErrorBox: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed' as const,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: '100%',
    height: '80%',
  },
  viewerCloseBtn: {
    position: 'absolute',
    top: 56,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  viewerCloseText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  viewerCloseHint: {
    position: 'absolute',
    bottom: 60,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
  },

  // Video preview
  videoPreview: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  videoIcon: { fontSize: 36, lineHeight: 46 },
  videoLabel: { fontSize: 14, fontWeight: '500' },

  // Analyzing
  analyzingSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  analyzingIcon: { fontSize: 48, lineHeight: 60, marginBottom: 8 },
  analyzingDesc: { fontSize: 14 },

  // Demo banner
  demoBanner: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  demoBannerText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

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
