import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Radius } from '@/constants/theme';
import { useProfile, TravelProfile } from '@/context/profile';
import { useMemory } from '@/context/memory';
import { useTripPulse } from '@/context/trip-pulse';
import { useTheme } from '@/hooks/use-theme';
import { setOnboardingComplete } from '@/services/storage';
import { requestNotificationPermission } from '@/services/notifications';

// ---------- phases ----------
type Phase = 'welcome' | 'survey' | 'reveal';

// ---------- survey steps ----------
const STEPS = [
  'interests',
  'decisionPriorities',
  'crowdTolerance',
  'dietary',
  'accessibility',
  'features',
] as const;

type Step = (typeof STEPS)[number];

const STEP_TITLES: Record<Step, string> = {
  interests: 'What are you into when you travel?',
  decisionPriorities: 'What makes somewhere worth choosing?',
  crowdTolerance: 'How do you feel about busy, touristy places?',
  dietary: 'Anything we should keep in mind about food?',
  accessibility: 'Any accessibility needs we should know about?',
  features: 'Your smart travel assistant',
};

const STEP_SUBTITLES: Record<Step, string> = {
  interests: 'Choose at least 3. Add your own too.',
  decisionPriorities: 'Choose 1 to 3.',
  crowdTolerance: '',
  dietary: 'Select any that apply.',
  accessibility: 'Select any that apply.',
  features: 'Two features help you get the most from Tripseek.',
};

// Required steps: Next disabled until valid, no skip button
// Optional steps: Next disabled until selection made, skip button provided
const REQUIRED_STEPS = new Set<Step>([
  'interests', 'decisionPriorities', 'features',
]);
const OPTIONAL_STEPS = new Set<Step>([
  'crowdTolerance', 'dietary', 'accessibility',
]);

// ---------- option data ----------

const INTEREST_OPTIONS = [
  '🍽️ Food & restaurants',
  '🌿 Nature & scenery',
  '🏖️ Beaches',
  '🏛️ Museums & history',
  '🎨 Art & culture',
  '🏗️ Architecture',
  '🛍️ Shopping',
  '🌃 Nightlife',
  '🧗 Adventure & outdoors',
  '🧘 Wellness & relaxation',
  '🌍 Local experiences',
  '📍 Famous landmarks',
  '💎 Hidden gems',
  '☕ Cafés',
  '🎵 Live music & entertainment',
  '🏟️ Sports & events',
];

const PACE_OPTIONS: { value: TravelProfile['pace']; label: string; desc: string }[] = [
  { value: 'relaxed', label: '🌿  Relaxed', desc: 'A few great things with plenty of breathing room.' },
  { value: 'moderate', label: '⚖️  Balanced', desc: 'Enough to experience the place without feeling rushed.' },
  { value: 'active', label: '🏃  Full', desc: 'I like making the most of every day.' },
];

const PLANNING_OPTIONS: { value: TravelProfile['flexibility']; label: string; desc: string }[] = [
  { value: 'planned', label: '📋  Mapped out', desc: "I like knowing what I'm doing ahead of time." },
  { value: 'some', label: '🔄  Flexible', desc: 'Give me a plan, but leave room to change it.' },
  { value: 'freeflow', label: '🎲  Spontaneous', desc: 'I like figuring things out as I go.' },
];

const DECISION_PRIORITY_OPTIONS = [
  '✨  It feels memorable',
  '⭐  It\'s highly rated',
  '🌍  It feels local & authentic',
  '🌸  It\'s beautiful',
  '💫  It\'s unique',
  '💰  It\'s good value',
  '📍  It\'s convenient',
  '🔥  It\'s popular for a reason',
];

const CROWD_OPTIONS: { value: NonNullable<TravelProfile['crowdTolerance']>; label: string; desc: string }[] = [
  { value: 'fine', label: "😊  I don't mind them", desc: 'If something is worth seeing, I want to see it.' },
  { value: 'moderate', label: '🤔  In moderation', desc: "I'll visit the big sights, but I like quieter places too." },
  { value: 'avoid', label: "🙈  I'd rather avoid them", desc: 'I usually prefer places that feel less crowded and touristy.' },
];

const FOOD_IMPORTANCE_OPTIONS: { value: NonNullable<TravelProfile['foodImportance']>; label: string; desc: string }[] = [
  { value: 'big', label: '🍽️  A big part of the trip', desc: 'Finding amazing food is part of why I travel.' },
  { value: 'care', label: '👌  I care about eating well', desc: "I want good recommendations, but food isn't the main focus." },
  { value: 'simple', label: '🥪  Keep it simple', desc: "I'm usually more focused on everything else." },
];

const DIETARY_OPTIONS = [
  '🥦  Vegetarian',
  '🌱  Vegan',
  '☪️  Halal',
  '✡️  Kosher',
  '🌾  Gluten-free',
  '🥛  Dairy-free',
  '🥜  Nut-free',
  '🦐  Shellfish-free',
  '🚫  No pork',
];

const ACCESSIBILITY_OPTIONS = [
  '♿  Step-free / wheelchair access',
  '🚶  Minimal walking',
  '🪑  Frequent places to sit or rest',
  '🚌  Accessible transportation',
  '🚻  Accessible restrooms',
  '👂  Hearing accessibility',
  '👁️  Vision accessibility',
  '🌿  Sensory-friendly environments',
];

const SPENDING_OPTIONS = [
  '🍽️  Food',
  '🏨  Stays',
  '🎭  Experiences',
  '🚗  Convenience',
  '🛍️  Shopping',
  '🌃  Nightlife',
  '💸  I usually prefer saving where I can',
];

const RECOMMENDATION_OPTIONS: { value: NonNullable<TravelProfile['recommendationStyle']>; label: string; desc: string }[] = [
  { value: 'best', label: '🎯  Just give me the best one', desc: "I'd rather have a confident recommendation than compare options." },
  { value: 'few', label: '🔍  Give me a few great choices', desc: 'I like choosing between a small number of strong options.' },
  { value: 'explore', label: '🗺️  Let me explore', desc: 'I like seeing plenty of options and deciding for myself.' },
];

// ---------- reusable components ----------

function OptionButton({
  selected,
  label,
  desc,
  onPress,
}: {
  selected: boolean;
  label: string;
  desc?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={[
        styles.optionButton,
        {
          backgroundColor: selected ? theme.primaryMuted : theme.backgroundElement,
          borderColor: selected ? theme.primary : theme.border,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <ThemedText style={[styles.optionLabel, selected && { color: theme.primary }]}>{label}</ThemedText>
      {desc ? (
        <ThemedText style={[styles.optionDesc, { color: theme.textSecondary }]}>{desc}</ThemedText>
      ) : null}
    </Pressable>
  );
}

function ChipButton({
  selected,
  label,
  disabled,
  onPress,
}: {
  selected: boolean;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  function handlePress() {
    if (disabled) return;
    Haptics.selectionAsync();
    onPress();
  }

  return (
    <Pressable
      onPress={handlePress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.primaryMuted : theme.backgroundElement,
          borderColor: selected ? theme.primary : theme.border,
          borderWidth: 1,
          opacity: disabled && !selected ? 0.4 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
    >
      <ThemedText style={[styles.chipText, selected && { color: theme.primary }]}>{label}</ThemedText>
    </Pressable>
  );
}

// ---------- main component ----------
export default function OnboardingScreen() {
  const router = useRouter();
  const { edit, survey } = useLocalSearchParams<{ edit?: string; survey?: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { profile, updateProfile } = useProfile();
  const { learningEnabled: travelMemoryEnabled, setLearningEnabled: setTravelMemoryEnabled } = useMemory();
  const { enabled: tripPulseEnabled, setEnabled: setTripPulseEnabled } = useTripPulse();

  const [phase, setPhase] = useState<Phase>(edit === '1' || survey === '1' ? 'survey' : 'welcome');
  const [activeSlide, setActiveSlide] = useState(0);
  const [heroHeight, setHeroHeight] = useState(0);
  const { width: SCREEN_WIDTH } = Dimensions.get('window');

  // Welcome screen animations
  const ctaScale = useSharedValue(1);
  const uc1Y = useSharedValue(0);
  const uc2Y = useSharedValue(0);
  const ctaFloatStyle = useAnimatedStyle(() => ({ transform: [{ scale: ctaScale.value }] }));
  const uc1Float = useAnimatedStyle(() => ({ transform: [{ translateY: uc1Y.value }] }));
  const uc2Float = useAnimatedStyle(() => ({ transform: [{ translateY: uc2Y.value }] }));


  useEffect(() => {
    if (phase !== 'welcome') return;
    const float = (val: typeof uc1Y, amplitude: number, duration: number) => {
      val.value = withRepeat(
        withSequence(
          withTiming(-amplitude, { duration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration, easing: Easing.inOut(Easing.sin) }),
        ), -1, false,
      );
    };
    const tCta = setTimeout(() => {
      ctaScale.value = withRepeat(withSequence(
        withTiming(1.02, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ), -1, false);
    }, 1200);
    const t1 = setTimeout(() => float(uc1Y, 10, 3000), 300);
    const t2 = setTimeout(() => float(uc2Y, 12, 2800), 700);
    return () => { clearTimeout(tCta); clearTimeout(t1); clearTimeout(t2); };
  }, [phase]);

  // ---------- survey state ----------
  const [step, setStep] = useState(0);
  const [navDirection, setNavDirection] = useState<'forward' | 'back'>('forward');
  const progressAnim = useSharedValue(1 / STEPS.length);
  const scrollRef = useRef<ScrollView>(null);

  const [interests, setInterests] = useState<string[]>(profile.interests);
  const [customInterest, setCustomInterest] = useState('');
  const [pace, setPace] = useState<TravelProfile['pace']>(profile.pace);
  const [planningStyle, setPlanningStyle] = useState<TravelProfile['flexibility']>(profile.flexibility ?? 'some');
  const [decisionPriorities, setDecisionPriorities] = useState<string[]>(profile.decisionPriorities ?? []);
  const [crowdTolerance, setCrowdTolerance] = useState<NonNullable<TravelProfile['crowdTolerance']>>(profile.crowdTolerance ?? 'moderate');
  const [crowdTouched, setCrowdTouched] = useState(profile.crowdTolerance != null);
  const [foodImportance, setFoodImportance] = useState<NonNullable<TravelProfile['foodImportance']>>(profile.foodImportance ?? 'care');
  const [foodTouched, setFoodTouched] = useState(profile.foodImportance != null);
  const [dietary, setDietary] = useState<string[]>(profile.dietaryRestrictions);
  const [dietaryNote, setDietaryNote] = useState<string>(profile.dietaryNote ?? '');
  const [customDietary, setCustomDietary] = useState('');
  const [accessibility, setAccessibility] = useState<string[]>(profile.mobilityNeeds);
  const [customAccessibility, setCustomAccessibility] = useState('');
  const [spendingPriorities, setSpendingPriorities] = useState<string[]>(profile.spendingPriorities ?? []);
  const [recommendationStyle, setRecommendationStyle] = useState<NonNullable<TravelProfile['recommendationStyle']>>(profile.recommendationStyle ?? 'few');

  const currentStep = STEPS[step];

  // Animated progress bar
  const progressBarStyle = useAnimatedStyle(() => ({ width: `${progressAnim.value * 100}%` as `${number}%` }));

  function goToStep(newStep: number) {
    setNavDirection(newStep > step ? 'forward' : 'back');
    setStep(newStep);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    progressAnim.value = withTiming((newStep + 1) / STEPS.length, { duration: 350, easing: Easing.out(Easing.quad) });
  }

  function toggleItem(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
  }

  function toggleDietary(item: string) {
    if (item === '👌  Nothing in particular') {
      setDietary(dietary.includes(item) ? [] : [item]);
      return;
    }
    const withoutNothing = dietary.filter((i) => i !== '👌  Nothing in particular');
    setDietary(toggleItem(withoutNothing, item));
  }

  function toggleAccessibility(item: string) {
    if (item === '👌  Nothing in particular') {
      setAccessibility(accessibility.includes(item) ? [] : [item]);
      return;
    }
    const withoutNothing = accessibility.filter((i) => i !== '👌  Nothing in particular');
    setAccessibility(toggleItem(withoutNothing, item));
  }

  function canAdvance(): boolean {
    switch (currentStep) {
      case 'interests': return interests.length >= 3;
      case 'decisionPriorities': return decisionPriorities.length >= 1;
      // Optional steps are always advanceable
      default: return true;
    }
  }

  function getProfileUpdates(): Partial<TravelProfile> {
    return {
      interests,
      decisionPriorities,
      crowdTolerance,
      dietaryRestrictions: dietary,
      dietaryNote: dietaryNote.trim() || undefined,
      mobilityNeeds: accessibility,
    };
  }

  function handleSurveyNext() {
    if (!canAdvance()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < STEPS.length - 1) {
      goToStep(step + 1);
    } else {
      updateProfile(getProfileUpdates());
      // Request notification permission if user enabled Trip Alerts
      if (tripPulseEnabled) {
        requestNotificationPermission();
      }
      handleFinish();
    }
  }

  function handleFinish() {
    if (edit === '1') { router.back(); return; }
    setOnboardingComplete();
    if (survey === '1') {
      router.replace('/(tabs)' as any);
    } else {
      router.push('/sign-up');
    }
  }

  // ========== WELCOME ==========
  if (phase === 'welcome') {
    const slideHeadlines = [
      'Your entire trip\nlives here.',
      'All your bookings\nautomatically organized.',
      'Explore and save\nreal places nearby.',
      'Catch problems before\nthey ruin your trip.',
      'Share your trip and\nplan it together.',
    ];
    const headline = slideHeadlines[activeSlide];

    return (
      <View style={styles.welcomeRoot}>
        <StatusBar barStyle="dark-content" />

        <Animated.View
          entering={FadeIn.delay(200).duration(600)}
          style={[styles.welcomeLogoBar, { paddingTop: insets.top + 16 }]}
        >
          <ExpoImage
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require('@/assets/images/logo-dark.png')}
            style={{ width: 160, height: 44 }}
            contentFit="contain"
          />
        </Animated.View>


        <View
          style={styles.welcomeHero}
          onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}
        >
          {heroHeight > 0 && (
            <ScrollView
              horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onMomentumScrollEnd={(e) => {
                setActiveSlide(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));
              }}
              style={{ flex: 1 }}
            >
              {/* Slide 1 */}
              <View style={{ width: SCREEN_WIDTH, height: heroHeight, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <ExpoImage
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require('@/assets/images/onboarding-slide-1.png')}
                  style={{ width: '95%', height: '95%' }}
                  contentFit="contain"
                />
              </View>
              {/* Slide 2 */}
              <View style={{ width: SCREEN_WIDTH, height: heroHeight, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <ExpoImage
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require('@/assets/images/onboarding-slide-2.png')}
                  style={{ width: '95%', height: '95%', transform: [{ rotate: '10deg' }] }}
                  contentFit="contain"
                />
              </View>
              {/* Slide 3 */}
              <View style={{ width: SCREEN_WIDTH, height: heroHeight, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <ExpoImage
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require('@/assets/images/onboarding-slide-3.png')}
                  style={{ width: '75%', height: '75%' }}
                  contentFit="contain"
                />
              </View>
              {/* Slide 4 */}
              <View style={{ width: SCREEN_WIDTH, height: heroHeight, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <ExpoImage
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require('@/assets/images/onboarding-slide-4.png')}
                  style={{ width: '95%', height: '95%' }}
                  contentFit="contain"
                />
              </View>
              {/* Slide 5 */}
              <View style={{ width: SCREEN_WIDTH, height: heroHeight, alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
                <ExpoImage
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require('@/assets/images/onboarding-slide-5.png')}
                  style={{ width: '95%', height: '95%' }}
                  contentFit="contain"
                />
              </View>
            </ScrollView>
          )}
        </View>

        <Animated.View
          entering={FadeInUp.delay(200).duration(600)}
          style={[styles.welcomeBottom, { paddingBottom: Math.max(insets.bottom, 20) + 16 }]}
        >
          <View style={styles.slideDotRow}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={[styles.slideDot, i === activeSlide && styles.slideDotActive]} />
            ))}
          </View>

          <Animated.View key={activeSlide} entering={FadeInDown.duration(300)} style={styles.welcomeHeadlineBlock}>
            <Text style={styles.welcomeHeadlineBig}>{headline}</Text>
          </Animated.View>

          <View style={styles.welcomeButtons}>
            <Animated.View style={ctaFloatStyle}>
              <Pressable
                onPress={() => setPhase('survey')}
                style={({ pressed }) => [styles.welcomeSignUpBtn, { opacity: pressed ? 0.88 : 1 }]}
                accessibilityRole="button" accessibilityLabel="Get started"
              >
                <Text style={styles.welcomeSignUpText}>Get Started</Text>
              </Pressable>
            </Animated.View>

            <Pressable
              onPress={() => { setOnboardingComplete(); router.push('/sign-in'); }}
              style={({ pressed }) => [styles.welcomeLogInBtn, { opacity: pressed ? 0.88 : 1 }]}
              accessibilityRole="button" accessibilityLabel="Log in"
            >
              <Text style={styles.welcomeLogInText}>Already have an account? Log in</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    );
  }

  // ========== REVEAL ==========
  if (phase === 'reveal') {
    const updates = getProfileUpdates();
    const merged = { ...profile, ...updates } as TravelProfile;

    const realDietary = (merged.dietaryRestrictions ?? []).filter((d) => !d.includes('Nothing'));
    const realAccessibility = (merged.mobilityNeeds ?? []).filter((a) => !a.includes('Nothing'));

    const crowdDisplayLabel = crowdTouched
      ? ({ fine: 'Fine with crowds', moderate: 'Crowds in moderation', avoid: 'Prefers quieter spots' } as Record<string, string>)[crowdTolerance] ?? null
      : null;

    const INTEREST_LIMIT = 8;
    const visibleInterests = merged.interests.slice(0, INTEREST_LIMIT);
    const overflowCount = merged.interests.length - INTEREST_LIMIT;

    const featuresOn: string[] = [];
    if (tripPulseEnabled) featuresOn.push('✈️  Trip Alerts');
    if (travelMemoryEnabled) featuresOn.push('🧠  Travel Memory');
    const featuresOff: string[] = [];
    if (!tripPulseEnabled) featuresOff.push('Trip Alerts');
    if (!travelMemoryEnabled) featuresOff.push('Travel Memory');

    const hasSummaryContent = (merged.decisionPriorities ?? []).length > 0;

    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            revealStyles.scrollContent,
            { paddingTop: insets.top + 32, paddingBottom: Math.max(insets.bottom, 16) + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. Header ── */}
          <Animated.View entering={FadeInDown.duration(350)}>
            <ThemedText style={[revealStyles.revealEyebrow, { color: theme.textSecondary }]}>
              ✦  All done
            </ThemedText>
            <ThemedText style={revealStyles.revealTitle}>{"Your profile\nis ready."}</ThemedText>
          </Animated.View>

          {/* ── 2. Interests ── */}
          {visibleInterests.length > 0 && (
            <Animated.View entering={FadeInDown.delay(100).duration(350)}>
              <ThemedText style={[revealStyles.sectionLabel, { color: theme.textSecondary }]}>
                You're into
              </ThemedText>
              <View style={revealStyles.chipRow}>
                {visibleInterests.map((item) => (
                  <View key={item} style={[revealStyles.revealChip, { backgroundColor: theme.primaryMuted, borderColor: theme.border }]}>
                    <ThemedText style={[revealStyles.revealChipText, { color: theme.primary }]}>{item}</ThemedText>
                  </View>
                ))}
                {overflowCount > 0 && (
                  <View style={[revealStyles.revealChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <ThemedText style={[revealStyles.revealChipText, { color: theme.textSecondary }]}>
                      +{overflowCount} more
                    </ThemedText>
                  </View>
                )}
              </View>
            </Animated.View>
          )}

          {/* ── 3. Summary card ── */}
          {hasSummaryContent && (
            <Animated.View entering={FadeInDown.delay(200).duration(350)}>
              <View style={[revealStyles.summaryCard, { borderColor: theme.border }]}>

                {/* Decision priorities */}
                {(merged.decisionPriorities ?? []).length > 0 && (
                  <View style={revealStyles.summaryRow}>
                    <ThemedText style={[revealStyles.summaryKey, { color: theme.textSecondary }]}>What matters</ThemedText>
                    <View style={revealStyles.summaryChips}>
                      {(merged.decisionPriorities ?? []).map((item) => (
                        <View key={item} style={[revealStyles.summaryChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                          <ThemedText style={[revealStyles.revealChipText, { color: theme.text }]}>{item}</ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Crowd tolerance */}
                {crowdDisplayLabel != null && (
                  <>
                    <View style={[revealStyles.summaryDivider, { backgroundColor: theme.border }]} />
                    <View style={revealStyles.summaryRow}>
                      <ThemedText style={[revealStyles.summaryKey, { color: theme.textSecondary }]}>Crowds</ThemedText>
                      <ThemedText style={[revealStyles.revealChipText, { color: theme.text }]}>{crowdDisplayLabel}</ThemedText>
                    </View>
                  </>
                )}

                {/* Dietary */}
                {realDietary.length > 0 && (
                  <>
                    <View style={[revealStyles.summaryDivider, { backgroundColor: theme.border }]} />
                    <View style={revealStyles.summaryRow}>
                      <ThemedText style={[revealStyles.summaryKey, { color: theme.textSecondary }]}>Dietary</ThemedText>
                      <View style={revealStyles.summaryChips}>
                        {realDietary.map((item) => (
                          <View key={item} style={[revealStyles.summaryChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                            <ThemedText style={[revealStyles.revealChipText, { color: theme.text }]}>{item}</ThemedText>
                          </View>
                        ))}
                      </View>
                    </View>
                  </>
                )}

                {/* Accessibility */}
                {realAccessibility.length > 0 && (
                  <>
                    <View style={[revealStyles.summaryDivider, { backgroundColor: theme.border }]} />
                    <View style={revealStyles.summaryRow}>
                      <ThemedText style={[revealStyles.summaryKey, { color: theme.textSecondary }]}>Accessibility</ThemedText>
                      <View style={revealStyles.summaryChips}>
                        {realAccessibility.map((item) => (
                          <View key={item} style={[revealStyles.summaryChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                            <ThemedText style={[revealStyles.revealChipText, { color: theme.text }]}>{item}</ThemedText>
                          </View>
                        ))}
                      </View>
                    </View>
                  </>
                )}

              </View>
            </Animated.View>
          )}

          {/* ── 4. Features ── */}
          <Animated.View entering={FadeInDown.delay(300).duration(350)}>
            <ThemedText style={[revealStyles.sectionLabel, { color: theme.textSecondary }]}>
              Features
            </ThemedText>
            <View style={revealStyles.featurePills}>
              {featuresOn.map((label) => (
                <View key={label} style={[revealStyles.featurePill, { backgroundColor: theme.primaryMuted, borderColor: theme.primary }]}>
                  <ThemedText style={[revealStyles.featurePillText, { color: theme.primary }]}>{label}</ThemedText>
                </View>
              ))}
              {featuresOff.map((label) => (
                <View key={label} style={[revealStyles.featurePill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <ThemedText style={[revealStyles.featurePillText, { color: theme.textSecondary }]}>{label} off</ThemedText>
                </View>
              ))}
            </View>
          </Animated.View>

          {/* ── 5. Hint ── */}
          <Animated.View entering={FadeInDown.delay(380).duration(350)}>
            <ThemedText style={[revealStyles.updateHint, { color: theme.textSecondary }]}>
              You can update these anytime from your Profile.
            </ThemedText>
          </Animated.View>
        </ScrollView>

        {/* Sticky CTA */}
        <Animated.View
          entering={FadeInUp.delay(400).duration(400)}
          style={[revealStyles.ctaBar, { paddingBottom: Math.max(insets.bottom, 16) + 8, backgroundColor: theme.background }]}
        >
          <Pressable
            onPress={handleFinish}
            style={({ pressed }) => [revealStyles.ctaButton, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Start exploring"
          >
            <ThemedText style={[revealStyles.ctaText, { color: theme.primaryText }]}>
              Start exploring →
            </ThemedText>
          </Pressable>
        </Animated.View>
      </ThemedView>
    );
  }

  // ========== SURVEY ==========
  const isNextDisabled = !canAdvance();
  const stepEntering = navDirection === 'forward'
    ? FadeInRight.duration(260).easing(Easing.out(Easing.quad))
    : FadeInLeft.duration(260).easing(Easing.out(Easing.quad));

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="height"
        keyboardVerticalOffset={0}
      >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + Spacing.five, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled
      >
        {/* Animated progress bar */}
        <View style={[styles.progressBar, { backgroundColor: theme.backgroundElement }]}>
          <Animated.View style={[styles.progressFill, { backgroundColor: theme.primary }, progressBarStyle]} />
        </View>

        <ThemedText type="eyebrow" style={[styles.stepLabel, { color: theme.textSecondary }]}>
          Step {step + 1} of {STEPS.length}
        </ThemedText>

        {/* Step content — all animates together on navigation */}
        <Animated.View key={step} entering={stepEntering} style={styles.stepContent}>
          <ThemedText type="subtitle" style={styles.surveyTitle}>
            {STEP_TITLES[currentStep]}
          </ThemedText>

          {STEP_SUBTITLES[currentStep] ? (
            <View style={styles.subtitleRow}>
              <ThemedText style={[styles.surveySubtitle, { color: theme.textSecondary }]}>
                {STEP_SUBTITLES[currentStep]}
              </ThemedText>
            </View>
          ) : null}

          <View style={styles.optionsContainer}>

            {/* ─── 1. Interests ─── */}
            {currentStep === 'interests' && (
              <View style={styles.chipGrid}>
                {/* Text input first */}
                <View style={styles.customInputRow}>
                  <TextInput
                    style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                    value={customInterest}
                    onChangeText={setCustomInterest}
                    placeholder="Add your own preferences..."
                    placeholderTextColor={theme.textSecondary}
                    onSubmitEditing={() => {
                      const vals = customInterest.split(',').map((v) => v.trim()).filter((v) => v && !interests.includes(v));
                      if (vals.length) setInterests([...interests, ...vals]);
                      setCustomInterest('');
                      Keyboard.dismiss();
                    }}
                    returnKeyType="done"
                    blurOnSubmit={true}
                  />
                </View>
                {/* Predefined chips */}
                {INTEREST_OPTIONS.map((item) => (
                  <ChipButton
                    key={item}
                    selected={interests.includes(item)}
                    label={item}
                    onPress={() => setInterests(toggleItem(interests, item))}
                  />
                ))}
                {/* Custom chips */}
                {interests
                  .filter((item) => !INTEREST_OPTIONS.includes(item))
                  .map((item) => (
                    <ChipButton
                      key={item}
                      selected={true}
                      label={`✕  ${item}`}
                      onPress={() => setInterests(interests.filter((i) => i !== item))}
                    />
                  ))}
              </View>
            )}

            {/* ─── 2. Pace ─── */}
            {currentStep === 'pace' &&
              PACE_OPTIONS.map((o) => (
                <OptionButton key={o.value} selected={pace === o.value} label={o.label} desc={o.desc} onPress={() => setPace(o.value)} />
              ))}

            {/* ─── 3. Planning style ─── */}
            {currentStep === 'planningStyle' &&
              PLANNING_OPTIONS.map((o) => (
                <OptionButton key={o.value} selected={planningStyle === o.value} label={o.label} desc={o.desc} onPress={() => setPlanningStyle(o.value)} />
              ))}

            {/* ─── 5. Decision priorities ─── */}
            {currentStep === 'decisionPriorities' && (
              <View style={styles.chipGrid}>
                {DECISION_PRIORITY_OPTIONS.map((item) => {
                  const selected = decisionPriorities.includes(item);
                  const atMax = decisionPriorities.length >= 3;
                  return (
                    <ChipButton
                      key={item}
                      selected={selected}
                      label={item}
                      disabled={atMax && !selected}
                      onPress={() => setDecisionPriorities(toggleItem(decisionPriorities, item))}
                    />
                  );
                })}
              </View>
            )}

            {/* ─── 3. Crowd tolerance ─── */}
            {currentStep === 'crowdTolerance' &&
              CROWD_OPTIONS.map((o) => (
                <OptionButton key={o.value} selected={crowdTouched && crowdTolerance === o.value} label={o.label} desc={o.desc} onPress={() => { setCrowdTolerance(o.value); setCrowdTouched(true); }} />
              ))}

            {/* ─── 7. Food importance ─── */}
            {currentStep === 'foodImportance' &&
              FOOD_IMPORTANCE_OPTIONS.map((o) => (
                <OptionButton key={o.value} selected={foodImportance === o.value} label={o.label} desc={o.desc} onPress={() => { setFoodImportance(o.value); setFoodTouched(true); }} />
              ))}

            {/* ─── 8. Dietary ─── */}
            {currentStep === 'dietary' && (
              <View style={styles.chipGrid}>
                {DIETARY_OPTIONS.map((item) => (
                  <ChipButton key={item} selected={dietary.includes(item)} label={item} onPress={() => toggleDietary(item)} />
                ))}
                {dietary
                  .filter((item) => !DIETARY_OPTIONS.includes(item))
                  .map((item) => (
                    <ChipButton key={item} selected={true} label={`✕  ${item}`} onPress={() => setDietary(dietary.filter((i) => i !== item))} />
                  ))}
                <View style={styles.customInputRow}>
                  <TextInput
                    style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                    value={customDietary}
                    onChangeText={setCustomDietary}
                    placeholder="Other dietary need..."
                    placeholderTextColor={theme.textSecondary}
                    onSubmitEditing={() => {
                      const val = customDietary.trim();
                      if (val && !dietary.includes(val)) setDietary([...dietary, val]);
                      setCustomDietary('');
                      Keyboard.dismiss();
                    }}
                    returnKeyType="done"
                    blurOnSubmit={true}
                  />
                </View>
              </View>
            )}

            {/* ─── 5. Accessibility ─── */}
            {currentStep === 'accessibility' && (
              <View style={styles.chipGrid}>
                {ACCESSIBILITY_OPTIONS.map((item) => (
                  <ChipButton key={item} selected={accessibility.includes(item)} label={item} onPress={() => toggleAccessibility(item)} />
                ))}
                {accessibility
                  .filter((item) => !ACCESSIBILITY_OPTIONS.includes(item))
                  .map((item) => (
                    <ChipButton key={item} selected={true} label={`✕  ${item}`} onPress={() => setAccessibility(accessibility.filter((i) => i !== item))} />
                  ))}
                <View style={styles.customInputRow}>
                  <TextInput
                    style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                    value={customAccessibility}
                    onChangeText={setCustomAccessibility}
                    placeholder="Other accessibility need..."
                    placeholderTextColor={theme.textSecondary}
                    onSubmitEditing={() => {
                      const val = customAccessibility.trim();
                      if (val && !accessibility.includes(val)) setAccessibility([...accessibility, val]);
                      setCustomAccessibility('');
                      Keyboard.dismiss();
                    }}
                    returnKeyType="done"
                    blurOnSubmit={true}
                  />
                </View>
              </View>
            )}

            {/* ─── 10. Spending priorities ─── */}
            {currentStep === 'spendingPriorities' && (
              <View style={styles.chipGrid}>
                {SPENDING_OPTIONS.map((item) => {
                  const selected = spendingPriorities.includes(item);
                  const atMax = spendingPriorities.length >= 2;
                  return (
                    <ChipButton
                      key={item}
                      selected={selected}
                      label={item}
                      disabled={atMax && !selected}
                      onPress={() => setSpendingPriorities(toggleItem(spendingPriorities, item))}
                    />
                  );
                })}
              </View>
            )}

            {/* ─── 11. Recommendation style ─── */}
            {currentStep === 'recommendationStyle' &&
              RECOMMENDATION_OPTIONS.map((o) => (
                <OptionButton key={o.value} selected={recommendationStyle === o.value} label={o.label} desc={o.desc} onPress={() => setRecommendationStyle(o.value)} />
              ))}

            {/* ─── 12. Features ─── */}
            {currentStep === 'features' && (
              <View style={styles.featuresContainer}>
                <View style={[styles.featureRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <View style={styles.featureIcon}><ThemedText style={styles.featureEmoji}>{'\u2708\uFE0F'}</ThemedText></View>
                  <View style={styles.featureInfo}>
                    <ThemedText style={styles.featureTitle}>Trip Alerts</ThemedText>
                    <ThemedText style={[styles.featureDesc, { color: theme.textSecondary }]}>
                      Catches things like closed venues, schedule conflicts, and weather issues before they become problems.
                    </ThemedText>
                  </View>
                  <Switch
                    value={tripPulseEnabled}
                    onValueChange={(val) => { Haptics.selectionAsync(); setTripPulseEnabled(val); if (val) requestNotificationPermission(); }}
                    trackColor={{ false: theme.border, true: theme.primary }}
                    thumbColor="#fff"
                  />
                </View>

                <View style={[styles.featureRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <View style={styles.featureIcon}><ThemedText style={styles.featureEmoji}>{'\u{1F9E0}'}</ThemedText></View>
                  <View style={styles.featureInfo}>
                    <ThemedText style={styles.featureTitle}>Travel Memory</ThemedText>
                    <ThemedText style={[styles.featureDesc, { color: theme.textSecondary }]}>
                      Learns your preferences over time so every recommendation feels more like you.
                    </ThemedText>
                  </View>
                  <Switch
                    value={travelMemoryEnabled}
                    onValueChange={(val) => { Haptics.selectionAsync(); setTravelMemoryEnabled(val); }}
                    trackColor={{ false: theme.border, true: theme.primary }}
                    thumbColor="#fff"
                  />
                </View>
              </View>
            )}

          </View>
        </Animated.View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.three }]}>
        {step > 0 ? (
          <Pressable onPress={() => goToStep(step - 1)} style={styles.textButton} accessibilityRole="button" accessibilityLabel="Back">
            <ThemedText style={[styles.textButtonText, { color: theme.textSecondary }]}>Back</ThemedText>
          </Pressable>
        ) : (
          <View style={styles.textButton} />
        )}
        <Pressable
          onPress={handleSurveyNext}
          disabled={isNextDisabled}
          style={({ pressed }) => [
            styles.nextButton,
            { backgroundColor: theme.primary, opacity: isNextDisabled ? 0.4 : pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={step === STEPS.length - 1 ? 'Finish survey' : 'Next step'}
        >
          <ThemedText style={[styles.nextText, { color: theme.primaryText }]}>
            {step === STEPS.length - 1 ? 'Finish' : 'Next'}
          </ThemedText>
        </Pressable>
      </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Welcome ────────────────────────────────────────────────
  welcomeRoot: { flex: 1, backgroundColor: '#FFFFFF' },
  welcomeTopBar: { paddingHorizontal: 26, paddingBottom: 8 },
  welcomeLogoBar: { alignItems: 'center', paddingBottom: 8 },
  welcomeWordmark: { fontSize: 11, fontWeight: '700', letterSpacing: 3.5, color: 'rgba(0,0,0,0.45)' },
  welcomeHero: { flex: 1 },
  welcomeBottom: {
    paddingHorizontal: 26,
    paddingTop: 20,
  },
  welcomeHeadlineBlock: { marginBottom: 24, marginTop: 4, minHeight: 88, justifyContent: 'flex-start' },
  welcomeHeadlineSmall: { fontSize: 15, fontWeight: '400', color: 'rgba(0,0,0,0.50)', letterSpacing: 0.2, marginBottom: 2 },
  welcomeHeadlineBig: { fontSize: 30, fontWeight: '800', color: '#000000', letterSpacing: -1, lineHeight: 36 },
  welcomeButtons: { gap: 12 },
  welcomeSignUpBtn: {
    backgroundColor: '#000000',
    borderRadius: Radius.md,
    paddingVertical: 17,
    alignItems: 'center',
  },
  welcomeSignUpText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  welcomeLogInBtn: { alignItems: 'center', paddingVertical: 10 },
  welcomeLogInText: { color: 'rgba(0,0,0,0.50)', fontSize: 14, fontWeight: '500' },

  // ── Slide dots ─────────────────────────────────────────────
  slideDotRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 14 },
  slideDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.15)' },
  slideDotActive: { width: 20, backgroundColor: '#000000', borderRadius: 3 },

  // ── Shared buttons ─────────────────────────────────────────
  primaryButton: { paddingVertical: 16, borderRadius: Radius.md, alignSelf: 'stretch', alignItems: 'center' },
  primaryButtonText: { fontSize: 17, fontWeight: '700' },
  textButton: { paddingVertical: 14, paddingHorizontal: 20 },
  textButtonText: { fontSize: 16, fontWeight: '500' },

  // ── Survey ─────────────────────────────────────────────────
  scrollContent: { paddingHorizontal: Spacing.four, flexGrow: 1 },
  progressBar: { height: 3, borderRadius: 1.5, marginBottom: Spacing.four },
  progressFill: { height: 3, borderRadius: 1.5 },
  stepLabel: { marginBottom: Spacing.two },
  stepContent: { gap: 0 },
  surveyTitle: { marginBottom: 10 },
  subtitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.five,
    gap: 12,
  },
  surveySubtitle: { fontSize: 15, lineHeight: 22, flex: 1 },
  skipLink: { fontSize: 14, fontWeight: '600' },
  optionsContainer: { gap: 12 },
  optionButton: { padding: Spacing.three, borderRadius: Radius.md, borderWidth: 1.5 },
  optionLabel: { fontSize: 17, fontWeight: '600' },
  optionDesc: { fontSize: 13, marginTop: 4 },

  // Chips
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radius.lg },
  chipText: { fontSize: 14, fontWeight: '500' },

  // Custom text inputs
  customInputRow: { width: '100%', marginBottom: 4 },
  customInput: { borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14 },
  noteInputRow: { width: '100%', marginTop: 8, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  noteLabel: { fontSize: 14, fontWeight: '500' },
  noteInput: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 72, textAlignVertical: 'top' },

  // Features
  featuresContainer: { gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.md, borderWidth: 1 },
  featureIcon: { width: 36, alignItems: 'center' },
  featureEmoji: { fontSize: 22, lineHeight: 28 },
  featureInfo: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  featureDesc: { fontSize: 13, lineHeight: 18 },

  // Footer
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingTop: Spacing.three },
  nextButton: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: Radius.md },
  nextText: { fontSize: 16, fontWeight: '700' },
});

// Reveal screen styles
const revealStyles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 24, gap: 32 },

  revealEyebrow: { marginBottom: 10 },
  revealTitle: { fontSize: 40, fontWeight: '800', letterSpacing: -1.5, lineHeight: 46 },

  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  revealChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.lg, borderWidth: 1 },
  revealChipText: { fontSize: 13, fontWeight: '500' },

  summaryCard: { borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  summaryRow: { paddingVertical: 14, paddingHorizontal: 16, gap: 6 },
  summaryKey: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 4 },
  summaryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  summaryChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.lg, borderWidth: 1 },
  summaryDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  featurePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  featurePill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.xl, borderWidth: 1 },
  featurePillText: { fontSize: 13, fontWeight: '600' },

  updateHint: { fontSize: 13, textAlign: 'center', paddingBottom: 4 },

  ctaBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 10,
  },
  ctaButton: { borderRadius: Radius.md, paddingVertical: 17, alignItems: 'center' },
  ctaText: { fontSize: 17, fontWeight: '700' },
});

// Slide overlay styles for the dark photo hero
const wStyles = StyleSheet.create({
  slideImage: { width: Dimensions.get('window').width, height: '90%' },
  bubbleUser: {
    maxWidth: 230,
    backgroundColor: '#111827',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    padding: 14,
  },
  bubbleSenderLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1.8, color: 'rgba(255,255,255,0.45)', marginBottom: 5 },
  bubbleUserText: { fontSize: 14, fontWeight: '500', color: '#FFFFFF', lineHeight: 20 },
  bubbleAI: {
    maxWidth: 240,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 20,
    elevation: 12,
  },
  bubbleAILabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: '#94A3B8', marginBottom: 6 },
  bubbleAIText: { fontSize: 13, color: '#374151', lineHeight: 19, marginBottom: 10 },
  bubbleAITag: { alignSelf: 'flex-start', backgroundColor: '#F1F5F9', borderRadius: Radius.xs, paddingHorizontal: 9, paddingVertical: 4 },
  bubbleAITagText: { color: '#475569', fontSize: 11, fontWeight: '700' },
});
