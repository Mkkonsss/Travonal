import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TravelStyleCard } from '@/components/travel-style-card';
import { Spacing } from '@/constants/theme';
import { useProfile, TravelProfile } from '@/context/profile';
import { useMemory } from '@/context/memory';
import { useTripPulse } from '@/context/trip-pulse';
import { useTheme } from '@/hooks/use-theme';
import { setOnboardingComplete } from '@/services/storage';

// ---------- phases ----------
type Phase = 'welcome' | 'survey' | 'reveal';

// ---------- survey steps ----------
const STEPS = ['pace', 'flexibility', 'budget', 'interests', 'dietary', 'mobility', 'travelWith', 'accommodation', 'features'] as const;

const STEP_TITLES: Record<(typeof STEPS)[number], string> = {
  pace: 'What pace do you prefer?',
  flexibility: 'How flexible are you?',
  budget: 'What is your comfort level?',
  interests: 'What do you enjoy most?',
  dietary: 'Any dietary needs?',
  mobility: 'Any accessibility needs?',
  travelWith: 'Who do you usually travel with?',
  accommodation: 'Where do you prefer to stay?',
  features: 'Your smart travel assistant',
};

const STEP_SUBTITLES: Record<(typeof STEPS)[number], string> = {
  pace: 'This helps us plan the right number of activities per day.',
  flexibility: 'How much do you want your days planned out?',
  budget: 'We use this to match recommendations to your range.',
  interests: 'Pick at least 2. You can change these anytime.',
  dietary: 'We\'ll flag restaurants and experiences that work for you.',
  mobility: 'Select any that apply so we can plan accessible routes.',
  travelWith: 'This helps us pick the right kinds of activities.',
  accommodation: 'We\'ll match lodging suggestions to your style.',
  features: 'Two features help you get the most from Travonal.',
};

const PACE_OPTIONS: { value: TravelProfile['pace']; label: string; desc: string }[] = [
  { value: 'relaxed', label: 'Relaxed', desc: 'Fewer activities, more downtime' },
  { value: 'moderate', label: 'Moderate', desc: 'A balanced mix of plans and free time' },
  { value: 'active', label: 'Active', desc: 'Packed days, see as much as possible' },
];

type FlexibilityValue = 'planned' | 'some' | 'freeflow';

const FLEXIBILITY_OPTIONS: { value: FlexibilityValue; label: string; desc: string }[] = [
  { value: 'planned', label: 'Stick to the plan', desc: 'I like knowing exactly what comes next' },
  { value: 'some', label: 'Some flexibility', desc: 'A plan with room to wander' },
  { value: 'freeflow', label: 'Go with the flow', desc: 'Loose plans, lots of spontaneity' },
];

const BUDGET_OPTIONS: { value: TravelProfile['budget']; label: string; desc: string }[] = [
  { value: 'budget', label: 'Budget', desc: 'Hostels, street food, free attractions' },
  { value: 'moderate', label: 'Moderate', desc: 'Mid-range hotels, casual dining' },
  { value: 'premium', label: 'Premium', desc: 'Upscale stays, fine dining, VIP experiences' },
];

const INTEREST_OPTIONS = [
  'Food & Dining', 'History', 'Nature', 'Art & Museums', 'Architecture',
  'Shopping', 'Nightlife', 'Beach', 'Adventure', 'Culture',
  'Photography', 'Wellness & Spa', 'Local Markets', 'Music',
];

const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'Kosher',
  'Dairy-free', 'Nut allergy', 'Shellfish allergy',
];

const MOBILITY_OPTIONS = [
  'Wheelchair accessible', 'Limited walking', 'No stairs',
  'Elevator required', 'Service animal',
];

const TRAVEL_WITH_OPTIONS: { value: TravelProfile['travelWith']; label: string; desc: string }[] = [
  { value: 'solo', label: 'Solo', desc: 'Just me, exploring at my own pace' },
  { value: 'partner', label: 'With a partner', desc: 'Romantic getaways and shared adventures' },
  { value: 'family', label: 'Family', desc: 'Kid-friendly activities and group logistics' },
  { value: 'friends', label: 'Friends', desc: 'Group fun with flexible scheduling' },
  { value: 'group', label: 'Organized group', desc: 'Guided tours and group excursions' },
];

const ACCOMMODATION_OPTIONS: { value: TravelProfile['accommodationPreference']; label: string; desc: string }[] = [
  { value: 'hostel', label: 'Hostel', desc: 'Social, budget-friendly stays' },
  { value: 'hotel', label: 'Hotel', desc: 'Reliable comfort and amenities' },
  { value: 'boutique', label: 'Boutique', desc: 'Unique character and local charm' },
  { value: 'resort', label: 'Resort', desc: 'All-inclusive relaxation' },
  { value: 'apartment', label: 'Apartment', desc: 'Home-like space with a kitchen' },
];

// ---------- reusable buttons ----------
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
      onPress={onPress}
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
      <ThemedText style={styles.optionLabel}>{label}</ThemedText>
      {desc ? (
        <ThemedText style={[styles.optionDesc, { color: theme.textSecondary }]}>{desc}</ThemedText>
      ) : null}
    </Pressable>
  );
}

function ChipButton({
  selected,
  label,
  onPress,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  function handlePress() {
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
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
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

  // Floating 3D animation values
  const emojiY = useSharedValue(0);
  const headlineY = useSharedValue(0);
  const ctaScale = useSharedValue(1);
  const ctaGlow = useSharedValue(0.1);

  const emojiFloatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: emojiY.value }] }));
  const headlineFloatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: headlineY.value }] }));
  const ctaFloatStyle = useAnimatedStyle(() => ({ transform: [{ scale: ctaScale.value }] }));
  const ctaGlowStyle = useAnimatedStyle(() => ({
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: ctaGlow.value,
    shadowRadius: 32,
    elevation: 10,
  }));

  useEffect(() => {
    if (phase !== 'welcome') return;
    const float = (val: typeof emojiY, amplitude: number, duration: number) =>
      val.value = withRepeat(
        withSequence(
          withTiming(-amplitude, { duration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration, easing: Easing.inOut(Easing.sin) }),
        ), -1, false,
      );
    const t1 = setTimeout(() => float(emojiY, 14, 2400), 900);
    const t2 = setTimeout(() => float(headlineY, 9, 2700), 1100);
    const t3 = setTimeout(() => {
      // Scale + glow breathe together
      ctaScale.value = withRepeat(withSequence(
        withTiming(1.025, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.0, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ), -1, false);
      ctaGlow.value = withRepeat(withSequence(
        withTiming(0.35, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.08, { duration: 2200, easing: Easing.inOut(Easing.sin) }),
      ), -1, false);
    }, 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [phase]);
  const [step, setStep] = useState(0);
  const [pace, setPace] = useState<TravelProfile['pace']>(profile.pace);
  const [flexibility, setFlexibility] = useState<FlexibilityValue>(profile.flexibility ?? 'some');
  const [budget, setBudget] = useState<TravelProfile['budget']>(profile.budget);
  const [interests, setInterests] = useState<string[]>(profile.interests);
  const [dietary, setDietary] = useState<string[]>(profile.dietaryRestrictions);
  const [mobility, setMobility] = useState<string[]>(profile.mobilityNeeds);
  const [travelWith, setTravelWith] = useState<TravelProfile['travelWith']>(profile.travelWith);
  const [accommodation, setAccommodation] = useState<TravelProfile['accommodationPreference']>(profile.accommodationPreference);

  const currentStep = STEPS[step];

  function toggleItem(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
  }

  function canAdvance(): boolean {
    if (currentStep === 'interests') return interests.length >= 2;
    return true;
  }

  function getProfileUpdates(): Partial<TravelProfile> {
    return {
      pace,
      flexibility,
      budget,
      interests,
      dietaryRestrictions: dietary,
      mobilityNeeds: mobility,
      travelWith,
      accommodationPreference: accommodation,
    };
  }

  function handleSurveyNext() {
    if (!canAdvance()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      updateProfile(getProfileUpdates());
      setPhase('reveal');
    }
  }

  function handleSkipSurvey() {
    updateProfile(getProfileUpdates());
    setPhase('reveal');
  }

  function handleFinish() {
    // Mark complete only after the reveal is shown — prevents stale state if app crashes mid-survey
    setOnboardingComplete();
    router.replace('/');
  }

  // ========== WELCOME ==========
  if (phase === 'welcome') {
    return (
      <View style={[styles.container, { backgroundColor: '#0A0A0A' }]}>
        <StatusBar barStyle="light-content" />

        <View style={[styles.welcomeContent, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 48 }]}>

          {/* Brand */}
          <Animated.View entering={FadeIn.delay(100).duration(700)}>
            <Text style={styles.welcomeBrandText}>Travonal</Text>
          </Animated.View>

          {/* Center: all connected — greeting, emoji, headline */}
          <View style={styles.welcomeCenter}>

            <Animated.View entering={FadeInDown.delay(200).duration(700)}>
              <Text style={styles.welcomeGreeting}>Welcome</Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(350).duration(700)}>
              <Animated.View style={emojiFloatStyle}>
                <Text style={styles.welcomeEmoji}>👋</Text>
              </Animated.View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(500).duration(700)}>
              <Animated.View style={headlineFloatStyle}>
                <Text style={styles.welcomeHeadlineLight}>Let's make travel</Text>
                <Text style={styles.welcomeHeadlineBold}>simple.</Text>
              </Animated.View>
            </Animated.View>

          </View>

          {/* CTA alone at bottom */}
          <Animated.View entering={FadeInUp.delay(650).duration(700)} style={[styles.welcomeCTAWrap, ctaFloatStyle]}>
              <Animated.View
                style={[styles.welcomeButtonWrapper, ctaGlowStyle]}
              >
                <Pressable
                  onPress={() => setPhase('survey')}
                  style={({ pressed }) => [styles.welcomeButton, { opacity: pressed ? 0.88 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Get started"
                >
                  <Text style={styles.welcomeButtonText}>Get started</Text>
                  <SymbolView name="arrow.right" size={15} tintColor="#1C1C1E" />
                </Pressable>
              </Animated.View>
              <Pressable
                onPress={() => { setOnboardingComplete(); router.replace('/'); }}
                style={styles.skipButton}
                accessibilityRole="button"
                accessibilityLabel="Skip"
              >
                <Text style={styles.welcomeSkipText}>Skip</Text>
              </Pressable>
            </Animated.View>

        </View>
      </View>
    );
  }

  // ========== REVEAL ==========
  if (phase === 'reveal') {
    const revealProfile: TravelProfile = {
      ...profile,
      pace,
      budget,
      interests,
      dietaryRestrictions: dietary,
      mobilityNeeds: mobility,
      travelWith,
      accommodationPreference: accommodation,
    };

    return (
      <ThemedView style={styles.container}>
        <Animated.View
          entering={FadeIn.duration(400)}
          style={[
            styles.revealContent,
            { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 },
          ]}
        >
          <View style={styles.revealTop}>
            <ThemedText type="title">{"You're all set"}</ThemedText>
            <ThemedText style={[styles.revealSubtitle, { color: theme.textSecondary }]}>
              Travonal will use your preferences to build trips that fit you.
            </ThemedText>

            <Animated.View entering={FadeInDown.delay(200).springify()}>
              <TravelStyleCard profile={revealProfile} showHeader={false} />
            </Animated.View>

            <ThemedText type="small" style={[styles.revealHint, { color: theme.textSecondary }]}>
              You can update these anytime in your Profile.
            </ThemedText>
          </View>

          <Pressable
            onPress={handleFinish}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Start exploring"
          >
            <ThemedText style={[styles.primaryButtonText, { color: theme.primaryText }]}>Start exploring</ThemedText>
          </Pressable>
        </Animated.View>
      </ThemedView>
    );
  }

  // ========== SURVEY ==========
  const progressFraction = (step + 1) / STEPS.length;
  const isNextDisabled = !canAdvance();

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + Spacing.five, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Progress bar */}
        <View style={[styles.progressBar, { backgroundColor: theme.backgroundElement }]}>
          <View
            style={[
              styles.progressFill,
              { width: `${progressFraction * 100}%`, backgroundColor: theme.primary },
            ]}
          />
        </View>

        <ThemedText type="eyebrow" style={[styles.stepLabel, { color: theme.textSecondary }]}>
          Step {step + 1} of {STEPS.length}
        </ThemedText>
        <ThemedText type="subtitle" style={styles.surveyTitle}>
          {STEP_TITLES[currentStep]}
        </ThemedText>
        <ThemedText style={[styles.surveySubtitle, { color: theme.textSecondary }]}>
          {STEP_SUBTITLES[currentStep]}
        </ThemedText>

        <Animated.View key={step} entering={FadeIn.duration(300)} style={styles.optionsContainer}>
          {currentStep === 'pace' &&
            PACE_OPTIONS.map((o) => (
              <OptionButton
                key={o.value}
                selected={pace === o.value}
                label={o.label}
                desc={o.desc}
                onPress={() => setPace(o.value)}
              />
            ))}

          {currentStep === 'flexibility' &&
            FLEXIBILITY_OPTIONS.map((o) => (
              <OptionButton
                key={o.value}
                selected={flexibility === o.value}
                label={o.label}
                desc={o.desc}
                onPress={() => setFlexibility(o.value)}
              />
            ))}

          {currentStep === 'budget' &&
            BUDGET_OPTIONS.map((o) => (
              <OptionButton
                key={o.value}
                selected={budget === o.value}
                label={o.label}
                desc={o.desc}
                onPress={() => setBudget(o.value)}
              />
            ))}

          {currentStep === 'interests' && (
            <View style={styles.chipGrid}>
              {INTEREST_OPTIONS.map((item) => (
                <ChipButton
                  key={item}
                  selected={interests.includes(item)}
                  label={item}
                  onPress={() => setInterests(toggleItem(interests, item))}
                />
              ))}
            </View>
          )}

          {currentStep === 'dietary' && (
            <View style={styles.chipGrid}>
              {DIETARY_OPTIONS.map((item) => (
                <ChipButton
                  key={item}
                  selected={dietary.includes(item)}
                  label={item}
                  onPress={() => setDietary(toggleItem(dietary, item))}
                />
              ))}
            </View>
          )}

          {currentStep === 'mobility' && (
            <View style={styles.chipGrid}>
              {MOBILITY_OPTIONS.map((item) => (
                <ChipButton
                  key={item}
                  selected={mobility.includes(item)}
                  label={item}
                  onPress={() => setMobility(toggleItem(mobility, item))}
                />
              ))}
            </View>
          )}

          {currentStep === 'travelWith' &&
            TRAVEL_WITH_OPTIONS.map((o) => (
              <OptionButton
                key={o.value}
                selected={travelWith === o.value}
                label={o.label}
                desc={o.desc}
                onPress={() => setTravelWith(o.value)}
              />
            ))}

          {currentStep === 'accommodation' &&
            ACCOMMODATION_OPTIONS.map((o) => (
              <OptionButton
                key={o.value}
                selected={accommodation === o.value}
                label={o.label}
                desc={o.desc}
                onPress={() => setAccommodation(o.value)}
              />
            ))}

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
        </Animated.View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.three }]}>
        {step > 0 ? (
          <Pressable onPress={() => setStep(step - 1)} style={styles.textButton} accessibilityRole="button" accessibilityLabel="Back">
            <ThemedText style={[styles.textButtonText, { color: theme.textSecondary }]}>
              Back
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable onPress={handleSkipSurvey} style={styles.textButton} accessibilityRole="button" accessibilityLabel="Skip survey">
            <ThemedText style={[styles.textButtonText, { color: theme.textSecondary }]}>
              Skip
            </ThemedText>
          </Pressable>
        )}
        <Pressable
          onPress={handleSurveyNext}
          disabled={isNextDisabled}
          style={({ pressed }) => [
            styles.nextButton,
            {
              backgroundColor: theme.primary,
              opacity: isNextDisabled ? 0.4 : pressed ? 0.85 : 1,
            },
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

  // Welcome
  welcomeContent: {
    flex: 1,
    paddingHorizontal: 28,
  },
  welcomeBrandText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  welcomeCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  welcomeGreeting: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 22,
    fontWeight: '500',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  welcomeEmoji: {
    fontSize: 72,
    textAlign: 'center',
  },
  welcomeHeadlineLight: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 34,
    fontWeight: '300',
    letterSpacing: -0.5,
    lineHeight: 40,
    textAlign: 'center',
  },
  welcomeHeadlineBold: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1.5,
    lineHeight: 54,
    textAlign: 'center',
  },
  welcomeCTAWrap: { gap: 12 },
  welcomeButtonWrapper: {
    alignSelf: 'stretch',
    borderRadius: 50,
  },
  welcomeButton: {
    borderRadius: 50,
    backgroundColor: '#EFEFEF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    paddingHorizontal: 20,
  },
  welcomeButtonText: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, color: '#1C1C1E' },
  welcomeSkipText: { color: 'rgba(255,255,255,0.22)', fontSize: 14, fontWeight: '500', textAlign: 'center' },
  skipButton: { paddingVertical: 8, alignItems: 'center' },

  // Reveal
  revealContent: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  revealTop: { gap: 12, flex: 1, justifyContent: 'center' },
  revealSubtitle: { fontSize: 15, lineHeight: 22 },
  revealList: { gap: 14, marginTop: 16 },
  revealRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  revealLabel: { fontSize: 14, fontWeight: '500' },
  revealValue: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
    marginLeft: 16,
  },
  revealHint: { marginTop: 8 },

  // Shared buttons
  primaryButton: {
    paddingVertical: 16,
    borderRadius: 14,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryButtonText: { fontSize: 17, fontWeight: '700' },
  textButton: { paddingVertical: 14, paddingHorizontal: 20 },
  textButtonText: { fontSize: 16, fontWeight: '500' },

  // Survey
  scrollContent: { paddingHorizontal: Spacing.four, flexGrow: 1 },
  progressBar: { height: 3, borderRadius: 1.5, marginBottom: Spacing.four },
  progressFill: { height: 3, borderRadius: 1.5 },
  stepLabel: { marginBottom: Spacing.two },
  surveyTitle: { marginBottom: 8 },
  surveySubtitle: { fontSize: 15, lineHeight: 22, marginBottom: Spacing.four },
  optionsContainer: { gap: 12 },
  optionButton: { padding: Spacing.three, borderRadius: 14, borderWidth: 1.5 },
  optionLabel: { fontSize: 17, fontWeight: '600' },
  optionDesc: { fontSize: 13, marginTop: 2 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  chipText: { fontSize: 14, fontWeight: '500' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  nextButton: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  nextText: { fontSize: 16, fontWeight: '700' },

  // Features step
  featuresContainer: { gap: 12 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  featureIcon: { width: 36, alignItems: 'center' },
  featureEmoji: { fontSize: 22, lineHeight: 28 },
  featureInfo: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  featureDesc: { fontSize: 13, lineHeight: 18 },
});
