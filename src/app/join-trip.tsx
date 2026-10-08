import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTrips, type Trip } from '@/context/trips';
import { findTripByInviteCode, claimInviteCode, getRoleForInviteCode, fetchOwnerIdentityForCode, type UserIdentity } from '@/services/sync';

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function JoinTripScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { joinTrip, trips } = useTrips();
  const { code: initialCode } = useLocalSearchParams<{ code?: string }>();

  const [code, setCode] = useState(initialCode ?? '');
  const [searching, setSearching] = useState(false);
  const [foundTrip, setFoundTrip] = useState<Trip | null>(null);
  const [ownerIdentity, setOwnerIdentity] = useState<UserIdentity | null>(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const normalized = code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const alreadyJoined = foundTrip ? trips.some((t) => t.id === foundTrip.id) : false;
  const fromLink = !!initialCode;

  // Auto-search if a code was passed via deep link / Universal Link
  useEffect(() => {
    if (initialCode && initialCode.length >= 3) {
      handleSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch() {
    const q = normalized;
    if (q.length < 3) return;
    setError('');
    setFoundTrip(null);
    setOwnerIdentity(null);
    setSearching(true);
    try {
      const trip = await findTripByInviteCode(q);
      if (!trip) {
        setError('No trip found with that code. Check the code and try again.');
      } else {
        setFoundTrip(trip);
        fetchOwnerIdentityForCode(q).then(setOwnerIdentity).catch(() => {});
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSearching(false);
    }
  }

  async function handleJoin() {
    if (!foundTrip) return;
    const role = await getRoleForInviteCode(normalized).catch(() => 'member' as const);
    claimInviteCode(normalized).catch(() => {});
    joinTrip(foundTrip, role);
    setJoined(true);
  }

  const totalDays = foundTrip ? (() => {
    const start = new Date(foundTrip.startDate);
    const end = new Date(foundTrip.endDate);
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  })() : 0;

  // ── Link flow (opened via invite link) ───────────────────────────────────────
  if (fromLink) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          hitSlop={12}
        >
          <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
        </Pressable>

        <View style={[styles.linkContent, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}>
          {joined ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.centerState}>
              <SymbolView name="checkmark.circle.fill" size={64} tintColor={theme.primary} />
              <ThemedText style={styles.successTitle}>You're in!</ThemedText>
              <ThemedText style={[styles.successDesc, { color: theme.textSecondary }]}>
                {foundTrip?.title ?? foundTrip?.destination} has been added to your trips.
              </ThemedText>
              <Pressable onPress={() => router.back()} style={[styles.primaryBtn, { backgroundColor: theme.primary }]}>
                <ThemedText style={styles.primaryBtnText}>Go to trips</ThemedText>
              </Pressable>
            </Animated.View>
          ) : searching ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.centerState}>
              <ActivityIndicator size="large" color={theme.primary} />
              <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>Finding trip...</ThemedText>
            </Animated.View>
          ) : error ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.centerState}>
              <SymbolView name="exclamationmark.circle" size={48} tintColor={theme.textSecondary} />
              <ThemedText style={[styles.errorTitle, { color: theme.text }]}>Link not found</ThemedText>
              <ThemedText style={[styles.errorDesc, { color: theme.textSecondary }]}>{error}</ThemedText>
              <Pressable onPress={() => router.back()} style={[styles.outlineBtn, { borderColor: theme.border }]}>
                <ThemedText style={[styles.outlineBtnText, { color: theme.textSecondary }]}>Go back</ThemedText>
              </Pressable>
            </Animated.View>
          ) : foundTrip ? (
            <Animated.View entering={FadeInUp.springify()} style={styles.tripCard}>
              <ThemedText style={styles.tripEmoji}>{foundTrip.emoji || '✈️'}</ThemedText>
              <ThemedText style={[styles.tripCardTitle, { color: theme.text }]}>
                {foundTrip.title ?? foundTrip.destination}
              </ThemedText>
              <ThemedText style={[styles.tripCardDest, { color: theme.textSecondary }]}>
                {foundTrip.destination}
              </ThemedText>
              <ThemedText style={[styles.tripCardMeta, { color: theme.textSecondary }]}>
                {foundTrip.datesKnown
                  ? `${formatDate(foundTrip.startDate)} – ${formatDate(foundTrip.endDate)}`
                  : `${totalDays} day${totalDays !== 1 ? 's' : ''}`}
                {' · '}{foundTrip.activities.length} activities
              </ThemedText>

              <View style={[styles.cardDivider, { backgroundColor: theme.border }]} />

              {ownerIdentity && (
                <View style={styles.ownerRow}>
                  {ownerIdentity.avatarUrl ? (
                    <Image source={{ uri: ownerIdentity.avatarUrl }} style={styles.ownerAvatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.ownerAvatar, { backgroundColor: theme.primaryMuted, alignItems: 'center', justifyContent: 'center' }]}>
                      <ThemedText style={{ fontSize: 11, fontWeight: '700', color: theme.primary }}>
                        {(ownerIdentity.displayName?.[0] ?? '?').toUpperCase()}
                      </ThemedText>
                    </View>
                  )}
                  <ThemedText style={[styles.ownerByline, { color: theme.textSecondary }]}>
                    {ownerIdentity.username
                      ? `Trip by @${ownerIdentity.username}`
                      : ownerIdentity.displayName
                        ? `Trip by ${ownerIdentity.displayName}`
                        : 'Shared trip'}
                  </ThemedText>
                </View>
              )}

              <ThemedText style={[styles.joinPrompt, { color: theme.textSecondary }]}>
                You've been invited to join this trip
              </ThemedText>

              {alreadyJoined ? (
                <ThemedText style={[styles.alreadyJoined, { color: theme.textSecondary }]}>
                  You already have this trip.
                </ThemedText>
              ) : (
                <>
                  <Pressable onPress={handleJoin} style={[styles.primaryBtn, { backgroundColor: theme.primary }]}>
                    <ThemedText style={styles.primaryBtnText}>Join trip</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => router.back()} style={styles.declineLink}>
                    <ThemedText style={[styles.declineLinkText, { color: theme.textSecondary }]}>No thanks</ThemedText>
                  </Pressable>
                </>
              )}
            </Animated.View>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Manual code entry flow ────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <View style={styles.headerSpacer} />
        <ThemedText style={styles.headerTitle}>Join a trip</ThemedText>
        <Pressable onPress={() => router.back()} style={[styles.headerSpacer, { alignItems: 'flex-end' }]} hitSlop={12}>
          <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
        </Pressable>
      </View>

      <View style={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        {joined ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.centerState}>
            <SymbolView name="checkmark.circle.fill" size={56} tintColor={theme.primary} />
            <ThemedText style={styles.successTitle}>You're in!</ThemedText>
            <ThemedText style={[styles.successDesc, { color: theme.textSecondary }]}>
              {foundTrip?.title ?? foundTrip?.destination} has been added to your trips.
            </ThemedText>
            <Pressable onPress={() => router.back()} style={[styles.primaryBtn, { backgroundColor: theme.primary, marginTop: 8 }]}>
              <ThemedText style={styles.primaryBtnText}>Done</ThemedText>
            </Pressable>
          </Animated.View>
        ) : (
          <>
            <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
              Enter the invite code shared by the trip owner to join their trip.
            </ThemedText>

            <View style={[styles.inputRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <TextInput
                ref={inputRef}
                value={normalized}
                onChangeText={(t) => { setCode(t); setFoundTrip(null); setOwnerIdentity(null); setError(''); }}
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
                <ThemedText style={[styles.errorInline, { color: theme.danger ?? '#FF3B30' }]}>{error}</ThemedText>
              </Animated.View>
            ) : null}

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
                    {ownerIdentity && (
                      <View style={[styles.ownerRow, { marginTop: 4 }]}>
                        {ownerIdentity.avatarUrl ? (
                          <Image source={{ uri: ownerIdentity.avatarUrl }} style={styles.ownerAvatar} contentFit="cover" />
                        ) : (
                          <View style={[styles.ownerAvatar, { backgroundColor: theme.primaryMuted, alignItems: 'center', justifyContent: 'center' }]}>
                            <ThemedText style={{ fontSize: 9, fontWeight: '700', color: theme.primary }}>
                              {(ownerIdentity.displayName?.[0] ?? '?').toUpperCase()}
                            </ThemedText>
                          </View>
                        )}
                        <ThemedText style={[styles.ownerByline, { color: theme.textSecondary }]}>
                          {ownerIdentity.username
                            ? `@${ownerIdentity.username}`
                            : ownerIdentity.displayName ?? 'Shared trip'}
                        </ThemedText>
                      </View>
                    )}
                  </View>
                </View>
                {alreadyJoined ? (
                  <ThemedText style={[styles.alreadyJoined, { color: theme.textSecondary }]}>
                    You already have this trip.
                  </ThemedText>
                ) : (
                  <Pressable onPress={handleJoin} style={[styles.joinBtnSmall, { backgroundColor: theme.primary }]}>
                    <SymbolView name="person.badge.plus" size={16} tintColor="#fff" />
                    <ThemedText style={styles.primaryBtnText}>Add to my trips</ThemedText>
                  </Pressable>
                )}
              </Animated.View>
            )}

            {!foundTrip && (
              <Pressable
                onPress={handleSearch}
                disabled={normalized.length < 3 || searching}
                style={[styles.searchBtn, { backgroundColor: normalized.length >= 3 ? theme.primary : theme.border }]}
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

  // Link flow
  closeBtn: {
    position: 'absolute',
    right: Spacing.four,
    zIndex: 10,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  centerState: {
    alignItems: 'center',
    gap: 16,
    width: '100%',
  },
  successTitle: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  successDesc: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  loadingText: { fontSize: 15 },
  errorTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorDesc: { fontSize: 15, textAlign: 'center', lineHeight: 22 },

  tripCard: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
  },
  tripEmoji: { fontSize: 64, lineHeight: 80 },
  tripCardTitle: { fontSize: 26, fontWeight: '700', textAlign: 'center', lineHeight: 32 },
  tripCardDest: { fontSize: 16, textAlign: 'center' },
  tripCardMeta: { fontSize: 14, textAlign: 'center' },
  cardDivider: { width: 40, height: 1, marginVertical: 12 },
  joinPrompt: { fontSize: 14, textAlign: 'center', marginBottom: 4 },

  primaryBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  outlineBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
    borderWidth: 1,
  },
  outlineBtnText: { fontSize: 15, fontWeight: '600' },

  declineLink: { paddingVertical: 12, alignItems: 'center' },
  declineLinkText: { fontSize: 15 },

  alreadyJoined: { fontSize: 14, textAlign: 'center' },

  // Manual flow
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

  errorInline: { fontSize: 14, lineHeight: 20 },

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

  joinBtnSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: Radius.sm,
  },

  searchBtn: {
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  searchBtnText: { fontSize: 16, fontWeight: '600' },

  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ownerAvatar: { width: 22, height: 22, borderRadius: 11 },
  ownerByline: { fontSize: 13 },
});
