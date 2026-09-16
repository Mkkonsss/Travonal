import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';

import { Image as ExpoImage } from 'expo-image';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useMemory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { useDestinationPhoto } from '@/hooks/use-destination-photo';
import { GENERATION_STEPS } from '@/services/mock-generator';
import { getTripDayCount, checkConflicts } from '@/services/itinerary-engine';
import { generateTripAI } from '@/services/ai';
import { normalizeActivity, deduplicateFixedActivities, ensureRequestedActivities, validateGeneratedActivities, repairActivities, generateActivityId } from '@/services/ai-utils';
import { useSubscription } from '@/context/subscription';
import type { Activity } from '@/context/trips';

type Phase = 'generating' | 'done' | 'error' | 'usage_limit';

export default function GeneratingTripScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { getTrip, setTripActivities, updateTrip } = useTrips();
  const { profile } = useProfile();
  const { getActiveEntries } = useMemory();

  const trip = getTrip(tripId);
  const photoQuery = trip ? `${trip.destination}, ${trip.country}` : '';
  const photoUrl = useDestinationPhoto(photoQuery);

  const [phase, setPhase] = useState<Phase>(trip ? 'generating' : 'error');
  const [errorDetail, setErrorDetail] = useState('');
  const [hasBlockingConflicts, setHasBlockingConflicts] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [percentage, setPercentage] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const progressWidth = useSharedValue(0);

  // Pulsing pin animation
  const pinScale = useSharedValue(1);
  const ripple1 = useSharedValue(0);
  const ripple2 = useSharedValue(0);

  // Done state animations
  const statsReveal = useSharedValue(0);

  // Start pulsing pin animation on mount
  useEffect(() => {
    if (phase !== 'generating') return;
    pinScale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    ripple1.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 0 }),
        withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }),
      ),
      -1,
    );
    ripple2.value = withDelay(
      1000,
      withRepeat(
        withSequence(
          withTiming(0, { duration: 0 }),
          withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }),
        ),
        -1,
      ),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (!trip) return;

    // Reset animation values on retry
    progressWidth.value = 0;
    statsReveal.value = 0;
    setPercentage(0);

    let stepIndex = 0;
    let cancelled = false;
    let currentPct = 0;

    let aiResolved = false;
    let aiResultRef: any = null;

    // Kick off the real AI call immediately in parallel with the animation
    const aiPromise = generateTripAI({
      trip: trip!,
      profile,
      memory: getActiveEntries(),
    });

    // Steady percentage: ticks at a constant 300ms pace.
    // Holds at 99 if AI hasn't resolved yet; once AI resolves, ticks to 100.
    // Reveal only fires when percentage reaches 100.
    const TICK_MS = 300;
    const pctTimer = setInterval(() => {
      if (cancelled) { clearInterval(pctTimer); return; }

      // Hold at 99 until AI is done — keeps the bar moving until the very end
      if (currentPct >= 99 && !aiResolved) return;

      currentPct++;
      setPercentage(currentPct);
      progressWidth.value = withTiming(currentPct / 100, { duration: TICK_MS });

      if (currentPct >= 100) {
        clearInterval(pctTimer);
        // Brief pause to let the bar visually fill, then show reveal
        setTimeout(() => {
          if (!cancelled) processResult();
        }, 400);
      }
    }, TICK_MS);

    /** Process AI result and transition to done/error */
    function processResult() {
      try {
        const result = aiResultRef!;
        const totalDays = getTripDayCount(trip!.startDate, trip!.endDate);

        const rawActivities = (result.activities ?? [])
          .map((a: Record<string, unknown>) => normalizeActivity(a, totalDays))
          .filter(Boolean) as (Omit<Activity, 'id'> & { id?: string })[];

        const fixedOriginals = (trip!.activities ?? []).filter(
          (a) => a.fixed || a.locked,
        );
        const deduplicated = deduplicateFixedActivities(
          rawActivities,
          fixedOriginals,
        );

        // Ensure all requested (board/inbox) activities are present
        const requestedOriginals = (trip!.activities ?? []).filter(
          (a) => a.requested,
        );
        const withRequested = ensureRequestedActivities(
          deduplicated,
          requestedOriginals,
          totalDays,
        );

        let activities: Activity[] = withRequested.map((a) =>
          'id' in a && (a as Activity).id
            ? (a as Activity)
            : { ...a, id: generateActivityId() } as Activity,
        );

        const effectivePace = trip!.pace ?? profile.pace ?? 'moderate';

        const validationIssues = validateGeneratedActivities(activities, totalDays, effectivePace);
        if (validationIssues.length > 0) {
          console.warn('[AI Generation] Validation issues:', validationIssues.map((i) => i.message));

          const hasCritical = validationIssues.some(
            (i) => i.severity === 'error',
          );
          if (hasCritical) {
            activities = repairActivities(activities, totalDays, effectivePace);
            const postRepairIssues = validateGeneratedActivities(activities, totalDays, effectivePace);
            const criticalRemaining = postRepairIssues.filter(
              (i) => i.severity === 'error',
            );
            if (criticalRemaining.length > 0) {
              activities = repairActivities(activities, totalDays, effectivePace);
              const issues3 = validateGeneratedActivities(activities, totalDays, effectivePace);
              const stillCritical = issues3.filter(
                (i) => i.severity === 'error',
              );
              if (stillCritical.length > 0) {
                throw new Error('Generated itinerary could not be validated');
              }
            }
            if (postRepairIssues.length > 0) {
              console.warn('[AI Generation] Post-repair issues:', postRepairIssues.map((i) => i.message));
            }
          }
        }

        const conflicts = checkConflicts(activities, totalDays);
        const hasOverlap = conflicts.some((c) => c.type === 'overlap' || c.type === 'locked_conflict');
        const hasOutOfRange = activities.some((a) => a.day < 1 || a.day > totalDays);
        const blocking = hasOverlap || hasOutOfRange;

        setHasBlockingConflicts(blocking);
        setTripActivities(trip!.id, activities);
        updateTrip(trip!.id, {
          status: blocking ? 'draft' : 'planned',
          generatedAt: new Date().toISOString(),
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        statsReveal.value = withDelay(400, withSpring(1, { damping: 12 }));
        setPhase('done');
      } catch (e) {
        console.error('[AI Generation] processResult error:', e);
        if (!cancelled) {
          setErrorDetail(e instanceof Error ? e.message : String(e));
          setPhase('error');
        }
      }
    }

    // When AI resolves, just store the result — the timer handles the rest
    aiPromise.then((result) => {
      if (cancelled) return;
      aiResolved = true;
      aiResultRef = result;
    }).catch((err) => {
      console.error('[AI Generation] API error:', err);
      clearInterval(pctTimer);
      if (cancelled) return;
      if ((err as any)?.code === 'USAGE_LIMIT') {
        setPhase('usage_limit');
      } else {
        setErrorDetail(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    });

    // Step labels rotate independently from the percentage
    function advanceStep() {
      if (cancelled) return;
      if (stepIndex >= GENERATION_STEPS.length) return;

      setCurrentStep(stepIndex);
      stepIndex++;
      setTimeout(advanceStep, GENERATION_STEPS[stepIndex - 1].duration);
    }

    const timeout = setTimeout(advanceStep, 400);
    return () => {
      cancelled = true;
      clearInterval(pctTimer);
      clearTimeout(timeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on mount and retry only
  }, [retryCount]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value * 100}%`,
  }));

  const pinAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pinScale.value }],
  }));

  const ripple1Style = useAnimatedStyle(() => ({
    opacity: 1 - ripple1.value,
    transform: [{ scale: 1 + ripple1.value * 2.5 }],
  }));

  const ripple2Style = useAnimatedStyle(() => ({
    opacity: 1 - ripple2.value,
    transform: [{ scale: 1 + ripple2.value * 2.5 }],
  }));

  const statsAnimStyle = useAnimatedStyle(() => ({
    opacity: statsReveal.value,
    transform: [{ translateY: (1 - statsReveal.value) * 20 }],
  }));

  function handleViewTrip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.dismiss();
    router.push(`/trip/${tripId}` as any);
  }

  function handleRetry() {
    setPhase('generating');
    setErrorDetail('');
    setCurrentStep(0);
    setPercentage(0);
    setRetryCount((c) => c + 1);
  }

  // Usage limit state — user exceeded their free/Plus allowance
  if (phase === 'usage_limit') {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centered, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 40 }]}>
          <SymbolView name={"sparkles" as any} size={32} tintColor={theme.primary} />
          <ThemedText type="subtitle">Plan limit reached</ThemedText>
          <ThemedText style={[styles.errorDesc, { color: theme.textSecondary }]}>
            Upgrade to Travonal+ for more AI-generated trip plans every month.
          </ThemedText>
          <Pressable
            onPress={() => router.push('/travonal-plus' as any)}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Upgrade to Travonal Plus"
          >
            <ThemedText style={[styles.primaryButtonText, { color: theme.background }]}>Upgrade to Travonal+</ThemedText>
          </Pressable>
          <Pressable onPress={() => router.back()} style={styles.textButton} accessibilityRole="button" accessibilityLabel="Go back">
            <ThemedText style={[styles.textButtonLabel, { color: theme.textSecondary }]}>Go back</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  // Error state
  if (phase === 'error') {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centered, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 40 }]}>
          <SymbolView name={"exclamationmark.triangle.fill" as any} size={32} tintColor="#D97706" />
          <ThemedText type="subtitle">Something went wrong</ThemedText>
          <ThemedText style={[styles.errorDesc, { color: theme.textSecondary }]}>
            {trip
              ? (errorDetail || "We couldn\u2019t generate your itinerary. Try again.")
              : 'Trip not found.'}
          </ThemedText>
          {trip && (
            <Pressable
              onPress={handleRetry}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <ThemedText style={[styles.primaryButtonText, { color: theme.background }]}>Try again</ThemedText>
            </Pressable>
          )}
          <Pressable onPress={() => router.back()} style={styles.textButton} accessibilityRole="button" accessibilityLabel="Go back">
            <ThemedText style={[styles.textButtonLabel, { color: theme.textSecondary }]}>Go back</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  // Done state — the rewarding reveal
  if (phase === 'done') {
    const updatedTrip = getTrip(tripId);
    const dayCount = updatedTrip ? getTripDayCount(updatedTrip.startDate, updatedTrip.endDate) : 0;
    const activities = updatedTrip?.activities ?? [];
    const foodCount = activities.filter((a) => a.type === 'food').length;
    const activityCount = activities.filter((a) => a.type === 'activity').length;

    // Pick up to 3 highlight activities — prefer variety of categories
    const highlights: Activity[] = [];
    const usedCategories = new Set<string>();
    for (const a of activities.filter((a) => a.type === 'activity')) {
      const cat = a.category ?? 'other';
      if (!usedCategories.has(cat) && highlights.length < 3) {
        highlights.push(a);
        usedCategories.add(cat);
      }
    }
    // Fill remaining slots if fewer than 3 unique categories
    if (highlights.length < 3) {
      for (const a of activities.filter((a) => a.type === 'activity')) {
        if (!highlights.find((h) => h.id === a.id) && highlights.length < 3) {
          highlights.push(a);
        }
      }
    }

    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={[styles.doneScroll, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero destination image */}
          <Animated.View entering={FadeIn.duration(600)} style={styles.heroImageContainer}>
            {photoUrl ? (
              <ExpoImage
                source={{ uri: photoUrl }}
                style={styles.heroImage}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[styles.heroImage, styles.heroFallback, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={[styles.heroFallbackText, { color: theme.textSecondary }]}>
                  {updatedTrip?.destination ?? ''}
                </ThemedText>
              </View>
            )}
          </Animated.View>

          {/* Content card overlapping image */}
          <View style={[styles.doneCard, { backgroundColor: theme.background }]}>
            {/* Destination + subtitle */}
            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.doneTitleArea}>
              <ThemedText type="title" style={styles.doneTitle}>
                {updatedTrip?.destination ?? 'Your trip'}
              </ThemedText>
              <ThemedText style={[styles.doneSubtitle, { color: hasBlockingConflicts ? '#F59E0B' : theme.textSecondary }]}>
                {hasBlockingConflicts ? 'Review before you go' : 'Your trip is ready'}
              </ThemedText>
              {hasBlockingConflicts && (
                <ThemedText style={[styles.conflictNote, { color: theme.textSecondary }]}>
                  Some activities have timing conflicts — tap View my trip to fix them.
                </ThemedText>
              )}
            </Animated.View>

            {/* Trip stats cards */}
            <Animated.View style={[styles.statsRow, statsAnimStyle]}>
              <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.statNumber}>{dayCount}</ThemedText>
                <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Days</ThemedText>
              </View>
              <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.statNumber}>{activityCount}</ThemedText>
                <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Places</ThemedText>
              </View>
              <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={styles.statNumber}>{foodCount}</ThemedText>
                <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Meals</ThemedText>
              </View>
            </Animated.View>

            {/* Trip highlights */}
            {highlights.length > 0 && (
              <Animated.View entering={FadeInDown.delay(600).duration(400)} style={styles.highlightsSection}>
                <ThemedText style={styles.highlightsTitle}>Trip highlights</ThemedText>
                {highlights.map((h, i) => (
                  <Animated.View
                    key={h.id}
                    entering={FadeInDown.delay(700 + i * 120).duration(300)}
                    style={[styles.highlightRow, { borderColor: theme.border }]}
                  >
                    <SymbolView
                      name={(
                        h.category === 'food' ? 'fork.knife' :
                        h.category === 'art' || h.category === 'culture' ? 'building.columns.fill' :
                        h.category === 'nature' ? 'leaf.fill' :
                        h.category === 'nightlife' ? 'moon.stars.fill' :
                        h.category === 'shopping' ? 'bag.fill' :
                        'mappin.and.ellipse'
                      ) as any}
                      size={18}
                      tintColor={theme.textSecondary}
                    />
                    <View style={styles.highlightText}>
                      <ThemedText style={styles.highlightName} numberOfLines={1}>{h.title}</ThemedText>
                      {h.description ? (
                        <ThemedText style={[styles.highlightDesc, { color: theme.textSecondary }]} numberOfLines={1}>
                          {h.description}
                        </ThemedText>
                      ) : null}
                    </View>
                    <ThemedText style={[styles.highlightDay, { color: theme.textSecondary }]}>
                      Day {h.day}
                    </ThemedText>
                  </Animated.View>
                ))}
              </Animated.View>
            )}

            {/* CTA */}
            <Animated.View entering={FadeInDown.delay(1000).duration(400)} style={styles.ctaArea}>
              <Pressable
                onPress={handleViewTrip}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: theme.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="View my trip"
              >
                <ThemedText style={[styles.primaryButtonText, { color: theme.background }]}>View my trip</ThemedText>
              </Pressable>
            </Animated.View>
          </View>
        </ScrollView>
      </ThemedView>
    );
  }

  // Generating state
  const stepLabel = currentStep < GENERATION_STEPS.length
    ? GENERATION_STEPS[currentStep].label
    : `Putting the finishing touches on your ${trip?.destination ?? 'trip'}\u2026`;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.centered, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}>

        {/* Pulsing pin with ripple rings */}
        <View style={styles.pinContainer}>
          <Animated.View style={[styles.ripple, { borderColor: theme.primary }, ripple1Style]} />
          <Animated.View style={[styles.ripple, { borderColor: theme.primary }, ripple2Style]} />
          <Animated.View style={pinAnimStyle}>
            <SymbolView name={"globe.americas.fill" as any} size={48} tintColor={theme.primary} />
          </Animated.View>
        </View>

        {/* Destination name */}
        <Animated.View entering={FadeIn.duration(400)}>
          <ThemedText type="title" style={styles.genDestName}>
            {trip?.destination ?? 'Your trip'}
          </ThemedText>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(200).duration(300)}>
          <ThemedText style={[styles.genSubtitle, { color: theme.textSecondary }]}>
            Building your itinerary
          </ThemedText>
        </Animated.View>

        {/* Progress section */}
        <View style={styles.progressSection}>
          {/* Percentage */}
          <ThemedText style={[styles.percentageText, { color: theme.primary }]}>
            {percentage}%
          </ThemedText>

          {/* Progress bar */}
          <View style={[styles.progressBar, { backgroundColor: theme.backgroundElement }]}>
            <Animated.View style={[styles.progressFill, { backgroundColor: theme.primary }, progressStyle]} />
          </View>

          {/* Current step label */}
          <Animated.View key={currentStep} entering={FadeInDown.duration(250)}>
            <ThemedText style={[styles.stepLabel, { color: theme.textSecondary }]}>
              {stepLabel}
            </ThemedText>
          </Animated.View>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: 12,
  },

  // Generating — pulsing pin
  pinContainer: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  ripple: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
  },
  genDestName: {
    textAlign: 'center',
    fontSize: 28,
  },
  genSubtitle: {
    fontSize: 15,
    fontWeight: '500',
    marginTop: 4,
  },
  progressSection: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 32,
    gap: 10,
  },
  percentageText: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  progressBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 4,
  },

  // Done — rewarding reveal
  doneScroll: {
    flexGrow: 1,
  },
  heroImageContainer: {
    height: 300,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroFallbackText: {
    fontSize: 28,
    fontWeight: '700',
    opacity: 0.3,
  },
  doneCard: {
    marginTop: -24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 28,
    paddingHorizontal: Spacing.four,
    gap: 20,
  },
  doneTitleArea: {
    alignItems: 'center',
    gap: 4,
  },
  doneTitle: { textAlign: 'center', fontSize: 32, fontWeight: '800' },
  doneSubtitle: { fontSize: 16, fontWeight: '600', marginTop: 2 },
  conflictNote: { fontSize: 13, lineHeight: 20, textAlign: 'center', paddingHorizontal: 16, marginTop: 4 },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: Radius.sm,
    gap: 2,
  },
  statNumber: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  highlightsSection: {
    gap: 10,
  },
  highlightsTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  highlightText: {
    flex: 1,
    gap: 2,
  },
  highlightName: {
    fontSize: 15,
    fontWeight: '600',
  },
  highlightDesc: {
    fontSize: 13,
  },
  highlightDay: {
    fontSize: 12,
    fontWeight: '600',
  },
  ctaArea: { marginTop: 8 },

  // Error
  errorDesc: { fontSize: 15, lineHeight: 22, textAlign: 'center' },

  // Buttons
  primaryButton: {
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryButtonText: { fontSize: 18, fontWeight: '700' },
  textButton: { paddingVertical: 12 },
  textButtonLabel: { fontSize: 15, fontWeight: '500' },
});
