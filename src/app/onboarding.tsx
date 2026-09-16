import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image as ExpoImage } from 'expo-image';
import {
  Dimensions,
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

// ---------- phases ----------
type Phase = 'welcome' | 'survey' | 'reveal';

// ---------- survey steps ----------
const STEPS = [
  'interests',
  'pace',
  'planningStyle',
  'decisionPriorities',
  'crowdTolerance',
  'foodImportance',
  'dietary',
  'accessibility',
  'spendingPriorities',
  'recommendationStyle',
  'features',
] as const;

type Step = (typeof STEPS)[number];

const STEP_TITLES: Record<Step, string> = {
  interests: 'What are you into when you travel?',
  pace: 'What does your ideal travel day feel like?',
  planningStyle: 'How do you like your trips planned?',
  decisionPriorities: 'What makes somewhere worth choosing?',
  crowdTolerance: 'How do you feel about busy, touristy places?',
  foodImportance: 'How important is food when you travel?',
  dietary: 'Anything we should keep in mind about food?',
  accessibility: 'Is there anything Travonal should consider when recommending places or planning your day?',
  spendingPriorities: 'Where are you happiest spending a little more?',
  recommendationStyle: 'How do you like recommendations?',
  features: 'Your smart travel assistant',
};

const STEP_SUBTITLES: Record<Step, string> = {
  interests: 'Choose at least 3. Add your own too.',
  pace: 'This becomes your default pace — you can still change it for individual trips.',
  planningStyle: 'This influences how much structure Travonal surfaces throughout the app.',
  decisionPriorities: 'Choose 1 to 3.',
  crowdTolerance: '',
  foodImportance: '',
  dietary: 'Select any that apply.',
  accessibility: 'Select any that apply.',
  spendingPriorities: 'Choose up to 2. This tells us where you tend to see value — not your budget.',
  recommendationStyle: '',
  features: 'Two features help you get the most from Travonal.',
};

// Required steps: Next disabled until valid, no skip button
// Optional steps: Next disabled until selection made, skip button provided
const REQUIRED_STEPS = new Set<Step>([
  'interests', 'pace', 'planningStyle',
  'decisionPriorities', 'recommendationStyle', 'features',
]);
const OPTIONAL_STEPS = new Set<Step>([
  'crowdTolerance', 'foodImportance', 'dietary', 'accessibility', 'spendingPriorities',
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
  '➕  Other',
  '👌  Nothing in particular',
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
  '➕  Other',
  '👌  Nothing in particular',
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
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { profile, updateProfile } = useProfile();
  const { learningEnabled: travelMemoryEnabled, setLearningEnabled: setTravelMemoryEnabled } = useMemory();
  const { enabled: tripPulseEnabled, setEnabled: setTripPulseEnabled } = useTripPulse();

  const [phase, setPhase] = useState<Phase>(edit === '1' ? 'survey' : 'welcome');
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

  // Pre-decode slide images the moment the component mounts so they're ready
  // before the user sees the first slide.
  useEffect(() => {
    ExpoImage.prefetch([
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/assets/images/phone image.png'),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/assets/images/third slide.png'),
    ]);
  }, []);

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
      // Optional: Next active only if user made a selection; otherwise use Skip
      case 'crowdTolerance': return crowdTouched;
      case 'foodImportance': return foodTouched;
      case 'dietary': return dietary.length > 0;
      case 'accessibility': return accessibility.length > 0;
      case 'spendingPriorities': return spendingPriorities.length > 0;
      default: return true;
    }
  }

  function getProfileUpdates(): Partial<TravelProfile> {
    return {
      interests,
      pace,
      flexibility: planningStyle,
      decisionPriorities,
      crowdTolerance: crowdTouched ? crowdTolerance : undefined,
      foodImportance: foodTouched ? foodImportance : undefined,
      dietaryRestrictions: dietary,
      dietaryNote: dietaryNote.trim() || undefined,
      mobilityNeeds: accessibility,
      spendingPriorities,
      recommendationStyle,
    };
  }

  function handleSurveyNext() {
    if (!canAdvance()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < STEPS.length - 1) {
      goToStep(step + 1);
    } else {
      updateProfile(getProfileUpdates());
      setPhase('reveal');
    }
  }

  function handleFinish() {
    if (edit === '1') { router.back(); return; }
    setOnboardingComplete();
    router.push('/sign-up');
  }

  // ========== WELCOME ==========
  if (phase === 'welcome') {
    const slideHeadlines = [
      { small: 'Your trips,', big: 'made\neffortless.' },
      { small: 'Change', big: 'anything\nwith AI.' },
      { small: 'Discover', big: "places you'll\nlove." },
    ];
    const headline = slideHeadlines[activeSlide];

    return (
      <View style={styles.welcomeRoot}>
        <StatusBar barStyle="dark-content" />

        <Animated.View
          entering={FadeIn.delay(200).duration(600)}
          style={[styles.welcomeTopBar, { paddingTop: insets.top + 16 }]}
        >
          <Text style={styles.welcomeWordmark}>✦  TRAVONAL</Text>
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
              <View style={{ width: SCREEN_WIDTH, height: heroHeight, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View style={[wStyles.slideImage, uc1Float]} entering={FadeIn.duration(400)}>
                  <ExpoImage
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    source={require('@/assets/images/phone image.png')}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="contain"
                  />
                </Animated.View>
              </View>

              <View style={{ width: SCREEN_WIDTH, height: heroHeight, paddingHorizontal: 24, justifyContent: 'center', gap: 12 }}>
                <Animated.View style={[wStyles.bubbleUser, uc1Float, { alignSelf: 'flex-end' }]}>
                  <Text style={wStyles.bubbleSenderLabel}>YOU</Text>
                  <Text style={wStyles.bubbleUserText}>"Make day 2 more budget-friendly"</Text>
                </Animated.View>
                <Animated.View style={[wStyles.bubbleAI, uc2Float, { alignSelf: 'flex-start' }]}>
                  <Text style={wStyles.bubbleAILabel}>✦  TRAVONAL</Text>
                  <Text style={wStyles.bubbleAIText}>Done! Swapped the restaurant for a local street food market. Saving you ~€40.</Text>
                  <View style={wStyles.bubbleAITag}><Text style={wStyles.bubbleAITagText}>Day 2 updated ✓</Text></View>
                </Animated.View>
              </View>

              <View style={{ width: SCREEN_WIDTH, height: heroHeight, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View style={[wStyles.slideImage, uc2Float]} entering={FadeIn.delay(100).duration(400)}>
                  <ExpoImage
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    source={require('@/assets/images/third slide.png')}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="contain"
                  />
                </Animated.View>
              </View>
            </ScrollView>
          )}
        </View>

        <Animated.View
          entering={FadeInUp.delay(200).duration(600)}
          style={[styles.welcomeBottom, { paddingBottom: Math.max(insets.bottom, 20) + 16 }]}
        >
          <View style={styles.slideDotRow}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.slideDot, i === activeSlide && styles.slideDotActive]} />
            ))}
          </View>

          <Animated.View key={activeSlide} entering={FadeInDown.duration(300)} style={styles.welcomeHeadlineBlock}>
            <Text style={styles.welcomeHeadlineSmall}>{headline.small}</Text>
            <Text style={styles.welcomeHeadlineBig}>{headline.big}</Text>
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

    const paceEmoji = ({ relaxed: '🌿', moderate: '⚖️', active: '🏃' } as Record<string, string>)[merged.pace] ?? '⚖️';
    const paceLabel = ({ relaxed: 'Relaxed', moderate: 'Balanced', active: 'Full throttle' } as Record<string, string>)[merged.pace] ?? 'Balanced';
    const planEmoji = ({ planned: '📋', some: '🔄', freeflow: '🎲' } as Record<string, string>)[merged.flexibility ?? 'some'] ?? '🔄';
    const planLabel = ({ planned: 'Mapped out', some: 'Flexible', freeflow: 'Spontaneous' } as Record<string, string>)[merged.flexibility ?? 'some'] ?? 'Flexible';

    const foodLabel = ({ big: 'Central to every trip', care: 'Matters a lot', simple: 'Keep it simple' } as Record<string, string>)[merged.foodImportance ?? 'care'] ?? 'Matters a lot';
    const crowdLabel = ({ fine: "Fine with it", moderate: 'In moderation', avoid: 'Rather avoid' } as Record<string, string>)[merged.crowdTolerance ?? 'moderate'] ?? 'In moderation';
    const recLabel = ({ best: 'Just the best one', few: 'A few great picks', explore: 'Let me explore' } as Record<string, string>)[merged.recommendationStyle ?? 'few'] ?? 'A few great picks';

    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={[
            revealStyles.scrollContent,
            { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 16) + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View entering={FadeInDown.duration(350)}>
            <ThemedText style={[revealStyles.revealEyebrow, { color: theme.textSecondary }]}>
              ✦  All done
            </ThemedText>
            <ThemedText style={revealStyles.revealTitle}>{"Here's what\nwe've learned."}</ThemedText>
          </Animated.View>

          {/* How you travel */}
          <Animated.View entering={FadeInDown.delay(120).duration(350)}>
            <ThemedText style={[revealStyles.sectionLabel, { color: theme.textSecondary }]}>
              How you travel
            </ThemedText>
            <View style={revealStyles.statsGrid}>
              <View style={[revealStyles.statBox, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={revealStyles.statEmoji}>{paceEmoji}</ThemedText>
                <ThemedText style={revealStyles.statValue}>{paceLabel}</ThemedText>
                <ThemedText style={[revealStyles.statKey, { color: theme.textSecondary }]}>Pace</ThemedText>
              </View>
              <View style={[revealStyles.statBox, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={revealStyles.statEmoji}>{planEmoji}</ThemedText>
                <ThemedText style={revealStyles.statValue}>{planLabel}</ThemedText>
                <ThemedText style={[revealStyles.statKey, { color: theme.textSecondary }]}>Planning</ThemedText>
              </View>
            </View>
          </Animated.View>

          {/* Interests */}
          {merged.interests.length > 0 && (
            <Animated.View entering={FadeInDown.delay(300).duration(350)}>
              <ThemedText style={[revealStyles.sectionLabel, { color: theme.textSecondary }]}>
                {"You're into"}
              </ThemedText>
              <View style={revealStyles.chipRow}>
                {merged.interests.slice(0, 9).map((item) => (
                  <View key={item} style={[revealStyles.revealChip, { backgroundColor: theme.primaryMuted, borderColor: theme.border }]}>
                    <ThemedText style={[revealStyles.revealChipText, { color: theme.primary }]}>{item}</ThemedText>
                  </View>
                ))}
                {merged.interests.length > 9 && (
                  <View style={[revealStyles.revealChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <ThemedText style={[revealStyles.revealChipText, { color: theme.textSecondary }]}>
                      +{merged.interests.length - 9} more
                    </ThemedText>
                  </View>
                )}
              </View>
            </Animated.View>
          )}

          {/* Decision priorities */}
          {(merged.decisionPriorities ?? []).length > 0 && (
            <Animated.View entering={FadeInDown.delay(360).duration(350)}>
              <ThemedText style={[revealStyles.sectionLabel, { color: theme.textSecondary }]}>
                What matters most
              </ThemedText>
              <View style={revealStyles.chipRow}>
                {(merged.decisionPriorities ?? []).map((item) => (
                  <View key={item} style={[revealStyles.revealChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <ThemedText style={[revealStyles.revealChipText, { color: theme.text }]}>{item}</ThemedText>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* How Travonal will tailor */}
          <Animated.View entering={FadeInDown.delay(420).duration(350)}>
            <ThemedText style={[revealStyles.sectionLabel, { color: theme.textSecondary }]}>
              How Travonal will tailor trips
            </ThemedText>
            <View style={[revealStyles.tailorCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={revealStyles.tailorRow}>
                <ThemedText style={revealStyles.tailorEmoji}>🍽️</ThemedText>
                <View style={{ flex: 1 }}>
                  <ThemedText style={revealStyles.tailorKey}>Food</ThemedText>
                  <ThemedText style={[revealStyles.tailorVal, { color: theme.textSecondary }]}>{foodLabel}</ThemedText>
                </View>
              </View>
              <View style={[revealStyles.tailorDivider, { backgroundColor: theme.border }]} />
              <View style={revealStyles.tailorRow}>
                <ThemedText style={revealStyles.tailorEmoji}>👥</ThemedText>
                <View style={{ flex: 1 }}>
                  <ThemedText style={revealStyles.tailorKey}>Crowds</ThemedText>
                  <ThemedText style={[revealStyles.tailorVal, { color: theme.textSecondary }]}>{crowdLabel}</ThemedText>
                </View>
              </View>
              <View style={[revealStyles.tailorDivider, { backgroundColor: theme.border }]} />
              <View style={revealStyles.tailorRow}>
                <ThemedText style={revealStyles.tailorEmoji}>🎯</ThemedText>
                <View style={{ flex: 1 }}>
                  <ThemedText style={revealStyles.tailorKey}>Recommendations</ThemedText>
                  <ThemedText style={[revealStyles.tailorVal, { color: theme.textSecondary }]}>{recLabel}</ThemedText>
                </View>
              </View>
              {(merged.spendingPriorities ?? []).length > 0 && (
                <>
                  <View style={[revealStyles.tailorDivider, { backgroundColor: theme.border }]} />
                  <View style={revealStyles.tailorRow}>
                    <ThemedText style={revealStyles.tailorEmoji}>💳</ThemedText>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={revealStyles.tailorKey}>Happy to spend more on</ThemedText>
                      <ThemedText style={[revealStyles.tailorVal, { color: theme.textSecondary }]}>
                        {(merged.spendingPriorities ?? []).join(' · ')}
                      </ThemedText>
                    </View>
                  </View>
                </>
              )}
            </View>
          </Animated.View>

          {/* Dietary */}
          {realDietary.length > 0 && (
            <Animated.View entering={FadeInDown.delay(480).duration(350)}>
              <ThemedText style={[revealStyles.sectionLabel, { color: theme.textSecondary }]}>
                Dietary
              </ThemedText>
              <View style={revealStyles.chipRow}>
                {realDietary.map((item) => (
                  <View key={item} style={[revealStyles.revealChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <ThemedText style={[revealStyles.revealChipText, { color: theme.text }]}>{item}</ThemedText>
                  </View>
                ))}
              </View>
              {merged.dietaryNote ? (
                <ThemedText style={[revealStyles.noteText, { color: theme.textSecondary }]}>
                  {merged.dietaryNote}
                </ThemedText>
              ) : null}
            </Animated.View>
          )}

          {/* Accessibility */}
          {realAccessibility.length > 0 && (
            <Animated.View entering={FadeInDown.delay(530).duration(350)}>
              <ThemedText style={[revealStyles.sectionLabel, { color: theme.textSecondary }]}>
                Accessibility
              </ThemedText>
              <View style={revealStyles.chipRow}>
                {realAccessibility.map((item) => (
                  <View key={item} style={[revealStyles.revealChip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                    <ThemedText style={[revealStyles.revealChipText, { color: theme.text }]}>{item}</ThemedText>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* Update hint */}
          <Animated.View entering={FadeInDown.delay(570).duration(350)}>
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
            <ThemedText style={[revealStyles.ctaText, { color: theme.background }]}>
              Start exploring →
            </ThemedText>
          </Pressable>
        </Animated.View>
      </ThemedView>
    );
  }

  // ========== SURVEY ==========
  const isNextDisabled = !canAdvance();
  const isSkippable = OPTIONAL_STEPS.has(currentStep);
  const stepEntering = navDirection === 'forward'
    ? FadeInRight.duration(260).easing(Easing.out(Easing.quad))
    : FadeInLeft.duration(260).easing(Easing.out(Easing.quad));

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + Spacing.five, paddingBottom: insets.bottom + 40 },
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
              {isSkippable && (
                <Pressable onPress={() => goToStep(step + 1)} hitSlop={8}>
                  <ThemedText style={[styles.skipLink, { color: theme.primary }]}>Skip</ThemedText>
                </Pressable>
              )}
            </View>
          ) : isSkippable ? (
            <View style={[styles.subtitleRow, { marginBottom: Spacing.four }]}>
              <Pressable onPress={() => goToStep(step + 1)} hitSlop={8}>
                <ThemedText style={[styles.skipLink, { color: theme.primary }]}>Skip this step</ThemedText>
              </Pressable>
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
                    }}
                    returnKeyType="done"
                    blurOnSubmit={false}
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

            {/* ─── 6. Crowd tolerance ─── */}
            {currentStep === 'crowdTolerance' &&
              CROWD_OPTIONS.map((o) => (
                <OptionButton key={o.value} selected={crowdTolerance === o.value} label={o.label} desc={o.desc} onPress={() => { setCrowdTolerance(o.value); setCrowdTouched(true); }} />
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
                      if (val && !dietary.includes(val)) setDietary([...dietary.filter((i) => i !== '👌  Nothing in particular'), val]);
                      setCustomDietary('');
                    }}
                    returnKeyType="done"
                    blurOnSubmit={false}
                  />
                </View>
                <View style={[styles.noteInputRow, { borderTopColor: theme.border }]}>
                  <ThemedText style={[styles.noteLabel, { color: theme.textSecondary }]}>Anything else?</ThemedText>
                  <TextInput
                    style={[styles.noteInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                    value={dietaryNote}
                    onChangeText={setDietaryNote}
                    placeholder="E.g. severe peanut allergy, prefer pescatarian..."
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    returnKeyType="done"
                  />
                </View>
              </View>
            )}

            {/* ─── 9. Accessibility ─── */}
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
                      if (val && !accessibility.includes(val)) setAccessibility([...accessibility.filter((i) => i !== '👌  Nothing in particular'), val]);
                      setCustomAccessibility('');
                    }}
                    returnKeyType="done"
                    blurOnSubmit={false}
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
                    <ThemedText style={styles.featureTitle}>Trip Pulse</ThemedText>
                    <ThemedText style={[styles.featureDesc, { color: theme.textSecondary }]}>
                      Smart alerts about schedule gaps, conflicts, and personalized suggestions as you plan.
                    </ThemedText>
                  </View>
                  <Switch
                    value={tripPulseEnabled}
                    onValueChange={(val) => { Haptics.selectionAsync(); setTripPulseEnabled(val); }}
                    trackColor={{ false: theme.border, true: theme.primary }}
                    thumbColor="#fff"
                  />
                </View>

                <View style={[styles.featureRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <View style={styles.featureIcon}><ThemedText style={styles.featureEmoji}>{'\u{1F9E0}'}</ThemedText></View>
                  <View style={styles.featureInfo}>
                    <ThemedText style={styles.featureTitle}>Travel Memory</ThemedText>
                    <ThemedText style={[styles.featureDesc, { color: theme.textSecondary }]}>
                      Remembers what you loved and avoided so future trips feel even more tailored.
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Welcome ────────────────────────────────────────────────
  welcomeRoot: { flex: 1, backgroundColor: '#FFFFFF' },
  welcomeTopBar: { paddingHorizontal: 26, paddingBottom: 8 },
  welcomeWordmark: { fontSize: 11, fontWeight: '700', letterSpacing: 3.5, color: 'rgba(0,0,0,0.45)' },
  welcomeHero: { flex: 1 },
  welcomeBottom: {
    paddingHorizontal: 26,
    paddingTop: 20,
  },
  welcomeHeadlineBlock: { marginBottom: 24, marginTop: 4, height: 88, justifyContent: 'flex-start' },
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
  scrollContent: { paddingHorizontal: 24, gap: 28 },

  revealEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 10 },
  revealTitle: { fontSize: 38, fontWeight: '800', letterSpacing: -1.4, lineHeight: 44 },

  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },

  statsGrid: { flexDirection: 'row', gap: 10 },
  statBox: { flex: 1, borderRadius: Radius.md, padding: 14, alignItems: 'center', gap: 4 },
  statEmoji: { fontSize: 22, lineHeight: 30, marginBottom: 2 },
  statValue: { fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  statKey: { fontSize: 11, fontWeight: '500', textAlign: 'center' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  revealChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.lg, borderWidth: 1 },
  revealChipText: { fontSize: 13, fontWeight: '500' },

  tailorCard: { borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  tailorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  tailorEmoji: { fontSize: 20, width: 28, textAlign: 'center' },
  tailorKey: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  tailorVal: { fontSize: 13 },
  tailorDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  noteText: { fontSize: 13, marginTop: 8, fontStyle: 'italic', lineHeight: 19 },

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
