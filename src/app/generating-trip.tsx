import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TravelStyleCard } from '@/components/travel-style-card';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trips';
import { useProfile } from '@/context/profile';
import { useMemory } from '@/context/memory';
import { useTheme } from '@/hooks/use-theme';
import { generateItinerary, validateAndRepairItinerary, GENERATION_STEPS } from '@/services/mock-generator';
import { getTripDayCount, checkConflicts } from '@/services/itinerary-engine';

type Phase = 'generating' | 'done' | 'error';

export default function GeneratingTripScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { getTrip, setTripActivities, updateTrip } = useTrips();
  const { profile } = useProfile();
  const { getActiveEntries } = useMemory();

  const trip = getTrip(tripId);

  const [phase, setPhase] = useState<Phase>(trip ? 'generating' : 'error');
  const [hasBlockingConflicts, setHasBlockingConflicts] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const progressWidth = useSharedValue(0);

  // Done state animations
  const emojiScale = useSharedValue(0);
  const confettiOpacity = useSharedValue(0);
  const statsReveal = useSharedValue(0);

  useEffect(() => {
    if (!trip) return;

    // Reset animation values on retry
    progressWidth.value = 0;
    emojiScale.value = 0;
    confettiOpacity.value = 0;
    statsReveal.value = 0;

    let stepIndex = 0;
    const totalDuration = GENERATION_STEPS.reduce((sum, s) => sum + s.duration, 0);
    let elapsed = 0;

    function advanceStep() {
      if (stepIndex >= GENERATION_STEPS.length) {
        try {
          const fixedActivities = trip!.activities.filter((a) => a.fixed);
          const rawActivities = generateItinerary({
            trip: trip!,
            profile,
            memory: getActiveEntries(),
            fixedActivities,
          });
          const { activities, warnings: repairWarnings } = validateAndRepairItinerary(rawActivities, trip!, profile);
          const totalDays = getTripDayCount(trip!.startDate, trip!.endDate);
          const remainingConflicts = checkConflicts(activities, totalDays);

          // Check all blocking conditions
          const hasErrorConflicts = remainingConflicts.some(
            (c) => c.type === 'overlap' || c.type === 'locked_conflict',
          );
          const hasRepairWarnings = repairWarnings.length > 0;
          const hasEmptyDay = remainingConflicts.some((c) => c.type === 'empty_day');
          const hasOverloadedDay = remainingConflicts.some((c) => c.type === 'day_overloaded');
          const hasOutOfRangeDay = activities.some((a) => a.day < 1 || a.day > totalDays);
          const blocking = hasErrorConflicts || hasRepairWarnings || hasEmptyDay || hasOverloadedDay || hasOutOfRangeDay;
          setHasBlockingConflicts(blocking);
          setTripActivities(trip!.id, activities);
          // Only mark as planned if no blocking conflicts remain
          updateTrip(trip!.id, {
            status: blocking ? 'draft' : 'planned',
            generatedAt: new Date().toISOString(),
          });

          // Trigger success haptic
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

          // Animate the reveal
          emojiScale.value = withSpring(1, { damping: 8, stiffness: 120 });
          confettiOpacity.value = withSequence(
            withTiming(1, { duration: 400 }),
            withDelay(2000, withTiming(0, { duration: 600 })),
          );
          statsReveal.value = withDelay(600, withSpring(1, { damping: 12 }));

          setPhase('done');
        } catch {
          setPhase('error');
        }
        return;
      }

      setCurrentStep(stepIndex);
      elapsed += GENERATION_STEPS[stepIndex].duration;
      progressWidth.value = withTiming(elapsed / totalDuration, { duration: GENERATION_STEPS[stepIndex].duration });

      stepIndex++;
      setTimeout(advanceStep, GENERATION_STEPS[stepIndex - 1].duration);
    }

    const timeout = setTimeout(advanceStep, 400);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on mount and retry only
  }, [retryCount]);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value * 100}%`,
  }));

  const emojiAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: emojiScale.value }],
  }));

  const confettiStyle = useAnimatedStyle(() => ({
    opacity: confettiOpacity.value,
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
    setCurrentStep(0);
    setRetryCount((c) => c + 1);
  }

  // Error state
  if (phase === 'error') {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centered, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 40 }]}>
          <ThemedText style={styles.errorIcon}>{'\u26A0\uFE0F'}</ThemedText>
          <ThemedText type="subtitle">Something went wrong</ThemedText>
          <ThemedText style={[styles.errorDesc, { color: theme.textSecondary }]}>
            {trip ? "We couldn\u2019t generate your itinerary. Try again." : 'Trip not found.'}
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
              <ThemedText style={[styles.primaryButtonText, { color: theme.primaryText }]}>Try again</ThemedText>
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
    const activityCount = updatedTrip?.activities.length ?? 0;
    const dayCount = updatedTrip ? getTripDayCount(updatedTrip.startDate, updatedTrip.endDate) : 0;
    const foodCount = updatedTrip?.activities.filter((a) => a.type === 'food').length ?? 0;
    const activityTypeCount = updatedTrip?.activities.filter((a) => a.type === 'activity').length ?? 0;

    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centered, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}>

          {/* Confetti particles */}
          <Animated.View style={[styles.confettiContainer, confettiStyle]} pointerEvents="none">
            {['#E5E5E5', '#AAAAAA', '#F59E0B', '#22C55E', '#3B82F6', '#EC4899'].map((color, i) => (
              <Animated.View
                key={i}
                entering={FadeInUp.delay(i * 80).duration(500).springify()}
                style={[
                  styles.confettiDot,
                  {
                    backgroundColor: color,
                    left: `${15 + i * 14}%`,
                    top: `${10 + (i % 3) * 15}%`,
                    width: 6 + (i % 3) * 2,
                    height: 6 + (i % 3) * 2,
                  },
                ]}
              />
            ))}
          </Animated.View>

          {/* Big emoji reveal */}
          <Animated.View style={emojiAnimStyle}>
            <ThemedText style={styles.doneEmoji}>{updatedTrip?.emoji ?? '\u2728'}</ThemedText>
          </Animated.View>

          {/* Title */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
            <ThemedText type="title" style={styles.doneTitle}>
              {updatedTrip?.destination ?? 'Your trip'}
            </ThemedText>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(350).duration(400)}>
            <ThemedText style={[styles.doneSubtitle, { color: hasBlockingConflicts ? '#F59E0B' : theme.primary }]}>
              {hasBlockingConflicts ? 'Review before you go' : 'Your trip is ready'}
            </ThemedText>
          </Animated.View>

          {hasBlockingConflicts && (
            <Animated.View entering={FadeInDown.delay(450).duration(300)}>
              <ThemedText style={[styles.conflictNote, { color: theme.textSecondary }]}>
                Some activities have timing conflicts — tap View my trip to fix them.
              </ThemedText>
            </Animated.View>
          )}

          {/* Trip stats cards */}
          <Animated.View style={[styles.statsRow, statsAnimStyle]}>
            <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.statNumber}>{dayCount}</ThemedText>
              <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Days</ThemedText>
            </View>
            <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.statNumber}>{activityCount}</ThemedText>
              <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Activities</ThemedText>
            </View>
            <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.statNumber}>{foodCount}</ThemedText>
              <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Meals</ThemedText>
            </View>
            <View style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText style={styles.statNumber}>{activityTypeCount}</ThemedText>
              <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Experiences</ThemedText>
            </View>
          </Animated.View>

          {/* Travel style summary */}
          <Animated.View entering={FadeIn.delay(900).duration(500)} style={{ alignSelf: 'stretch' }}>
            <TravelStyleCard profile={profile} showHeader={false} />
          </Animated.View>

          {/* CTA */}
          <Animated.View entering={FadeInDown.delay(1100).duration(400)} style={styles.ctaArea}>
            <Pressable
              onPress={handleViewTrip}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.primary,
                  opacity: pressed ? 0.85 : 1,
                  shadowColor: theme.primary,
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.35,
                  shadowRadius: 12,
                  elevation: 8,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="View my trip"
            >
              <ThemedText style={styles.primaryButtonText}>View my trip</ThemedText>
            </Pressable>
          </Animated.View>
        </View>
      </ThemedView>
    );
  }

  // Generating state
  const stepLabel = currentStep < GENERATION_STEPS.length
    ? GENERATION_STEPS[currentStep].label
    : 'Finishing...';

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.centered, { paddingTop: insets.top + 100, paddingBottom: insets.bottom + 40 }]}>
        <ThemedText style={styles.genEmoji}>{trip?.emoji ?? '\u2708\uFE0F'}</ThemedText>

        <Animated.View entering={FadeIn.duration(300)}>
          <ThemedText type="subtitle" style={styles.genTitle}>Building your trip</ThemedText>
        </Animated.View>

        <ThemedText style={[styles.genDest, { color: theme.textSecondary }]}>
          {trip?.destination ?? 'your destination'}
        </ThemedText>

        {/* Progress bar */}
        <View style={[styles.progressBar, { backgroundColor: theme.backgroundElement }]}>
          <Animated.View style={[styles.progressFill, { backgroundColor: theme.primary }, progressStyle]} />
        </View>

        {/* Current step label */}
        <Animated.View key={currentStep} entering={FadeInDown.duration(200)}>
          <ThemedText style={[styles.stepLabel, { color: theme.textSecondary }]}>
            {stepLabel}
          </ThemedText>
        </Animated.View>

        {/* Step indicators */}
        <View style={styles.stepDots}>
          {GENERATION_STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.stepDot,
                {
                  backgroundColor: i <= currentStep ? theme.primary : theme.backgroundElement,
                },
              ]}
            />
          ))}
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

  // Generating
  genEmoji: { fontSize: 48, lineHeight: 60, marginBottom: 8 },
  genTitle: { textAlign: 'center' },
  genDest: { fontSize: 15, marginBottom: 24 },
  progressBar: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 12,
  },
  stepDots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 16,
  },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  // Done — rewarding reveal
  confettiContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  confettiDot: {
    position: 'absolute',
    borderRadius: 10,
  },
  doneEmoji: { fontSize: 72, lineHeight: 88, marginBottom: 4 },
  doneTitle: { textAlign: 'center', fontSize: 32 },
  doneSubtitle: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  conflictNote: { fontSize: 13, lineHeight: 20, textAlign: 'center', paddingHorizontal: 16 },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 2,
  },
  statNumber: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  doneDesc: { fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 8, marginTop: 8 },
  ctaArea: { alignSelf: 'stretch', marginTop: 16 },

  // Error
  errorIcon: { fontSize: 48, lineHeight: 60, marginBottom: 8 },
  errorDesc: { fontSize: 15, lineHeight: 22, textAlign: 'center' },

  // Buttons
  primaryButton: {
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 16,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  primaryButtonText: { fontSize: 18, fontWeight: '700' },
  textButton: { paddingVertical: 12 },
  textButtonLabel: { fontSize: 15, fontWeight: '500' },
});
