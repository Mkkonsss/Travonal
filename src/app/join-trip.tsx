import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTrips, type Trip } from '@/context/trips';
import { findTripByInviteCode } from '@/services/sync';

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function JoinTripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { addTripWithActivities, trips } = useTrips();

  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [foundTrip, setFoundTrip] = useState<Trip | null>(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const normalized = code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const alreadyJoined = foundTrip ? trips.some((t) => t.id === foundTrip.id) : false;

  async function handleSearch() {
    const q = normalized;
    if (q.length < 3) return;
    setError('');
    setFoundTrip(null);
    setSearching(true);
    try {
      const trip = await findTripByInviteCode(q);
      if (!trip) {
        setError('No trip found with that code. Check the code and try again.');
      } else {
        setFoundTrip(trip);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSearching(false);
    }
  }

  function handleJoin() {
    if (!foundTrip) return;
    // Add a local copy of the shared trip
    const { id: _id, members: _members, invitations: _invitations, ...rest } = foundTrip;
    addTripWithActivities(
      { ...rest, title: foundTrip.title ?? foundTrip.destination, status: 'planned' },
      foundTrip.activities.map(({ id: _aid, ...a }) => a),
      (foundTrip.reservations ?? []).filter((r) => !r.cancelled).map(({ id: _rid, tripId: _tid, ...r }) => r),
    );
    setJoined(true);
  }

  const totalDays = foundTrip ? (() => {
    const start = new Date(foundTrip.startDate);
    const end = new Date(foundTrip.endDate);
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  })() : 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <View style={styles.headerSpacer} />
        <ThemedText style={styles.headerTitle}>Join a trip</ThemedText>
        <Pressable onPress={() => router.back()} style={[styles.headerSpacer, { alignItems: 'flex-end' }]} hitSlop={12}>
          <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
        </Pressable>
      </View>

      <View style={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        {joined ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.successState}>
            <SymbolView name="checkmark.circle.fill" size={56} tintColor={theme.primary} />
            <ThemedText type="headline" style={{ textAlign: 'center' }}>You're in!</ThemedText>
            <ThemedText style={[styles.successDesc, { color: theme.textSecondary }]}>
              {foundTrip?.title ?? foundTrip?.destination} has been added to your trips.
            </ThemedText>
            <Pressable
              onPress={() => router.back()}
              style={[styles.doneBtn, { backgroundColor: theme.primary }]}
            >
              <ThemedText style={styles.doneBtnText}>Done</ThemedText>
            </Pressable>
          </Animated.View>
        ) : (
          <>
            <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
              Enter the invite code shared by the trip owner to join their trip.
            </ThemedText>

            {/* Code input */}
            <View style={[styles.inputRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <TextInput
                ref={inputRef}
                value={normalized}
                onChangeText={(t) => { setCode(t); setFoundTrip(null); setError(''); }}
                placeholder="e.g. TRV-A3X7K2"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text }]}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={handleSearch}
                maxLength={12}
              />
              {searching && <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 4 }} />}
            </View>

            {error ? (
              <Animated.View entering={FadeIn.duration(200)}>
                <ThemedText style={[styles.error, { color: theme.danger ?? '#FF3B30' }]}>{error}</ThemedText>
              </Animated.View>
            ) : null}

            {/* Found trip preview */}
            {foundTrip && (
              <Animated.View entering={FadeInDown.springify()} style={[styles.tripPreview, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                <View style={styles.previewHeader}>
                  <ThemedText style={styles.previewEmoji}>{foundTrip.emoji || '✈️'}</ThemedText>
                  <View style={styles.previewInfo}>
                    <ThemedText style={styles.previewTitle} numberOfLines={1}>
                      {foundTrip.title ?? foundTrip.destination}
                    </ThemedText>
                    <ThemedText style={[styles.previewMeta, { color: theme.textSecondary }]}>
                      {foundTrip.destination}
                      {foundTrip.datesKnown
                        ? ` · ${formatDate(foundTrip.startDate)} – ${formatDate(foundTrip.endDate)}`
                        : ` · ${totalDays} day${totalDays !== 1 ? 's' : ''}`}
                    </ThemedText>
                    <ThemedText style={[styles.previewActivities, { color: theme.textSecondary }]}>
                      {foundTrip.activities.length} activities planned
                    </ThemedText>
                  </View>
                </View>
                {alreadyJoined ? (
                  <ThemedText style={[styles.alreadyJoined, { color: theme.textSecondary }]}>
                    You already have this trip.
                  </ThemedText>
                ) : (
                  <Pressable
                    onPress={handleJoin}
                    style={[styles.joinBtn, { backgroundColor: theme.primary }]}
                  >
                    <SymbolView name="person.badge.plus" size={16} tintColor="#fff" />
                    <ThemedText style={styles.joinBtnText}>Add to my trips</ThemedText>
                  </Pressable>
                )}
              </Animated.View>
            )}

            {/* Search button */}
            {!foundTrip && (
              <Pressable
                onPress={handleSearch}
                disabled={normalized.length < 3 || searching}
                style={[
                  styles.searchBtn,
                  { backgroundColor: normalized.length >= 3 ? theme.primary : theme.border },
                ]}
              >
                <ThemedText style={[styles.searchBtnText, { color: normalized.length >= 3 ? '#fff' : theme.textSecondary }]}>
                  Find trip
                </ThemedText>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  headerSpacer: { width: 64 },

  content: { flex: 1, padding: Spacing.four, gap: 16 },
  subtitle: { fontSize: 15, lineHeight: 22 },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  input: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 2,
    paddingVertical: 12,
    fontFamily: 'ui-monospace',
  },

  error: { fontSize: 14, lineHeight: 20 },

  tripPreview: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  previewHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  previewEmoji: { fontSize: 32 },
  previewInfo: { flex: 1, gap: 3 },
  previewTitle: { fontSize: 17, fontWeight: '700' },
  previewMeta: { fontSize: 13 },
  previewActivities: { fontSize: 12 },

  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: Radius.sm,
  },
  joinBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  alreadyJoined: { fontSize: 14, textAlign: 'center' },

  searchBtn: {
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  searchBtnText: { fontSize: 16, fontWeight: '600' },

  // Success state
  successState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  successDesc: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  doneBtn: { paddingHorizontal: 40, paddingVertical: 14, borderRadius: Radius.md, marginTop: 8 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
