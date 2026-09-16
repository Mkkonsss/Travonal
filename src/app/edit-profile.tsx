import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Radius } from '@/constants/theme';
import { useProfile, TravelProfile } from '@/context/profile';
import { useTheme } from '@/hooks/use-theme';
import { clearOnboardingComplete } from '@/services/storage';

const PACE_OPTIONS: { value: TravelProfile['pace']; label: string }[] = [
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'active', label: 'Active' },
];

const FLEXIBILITY_OPTIONS: { value: TravelProfile['flexibility']; label: string }[] = [
  { value: 'planned', label: 'Stick to the plan' },
  { value: 'some', label: 'Some flexibility' },
  { value: 'freeflow', label: 'Go with the flow' },
];

const ACCOMMODATION_OPTIONS: { value: TravelProfile['accommodationPreference']; label: string }[] = [
  { value: 'hostel', label: 'Hostel' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'boutique', label: 'Boutique' },
  { value: 'resort', label: 'Resort' },
  { value: 'apartment', label: 'Apartment' },
];

const CROWD_OPTIONS: { value: NonNullable<TravelProfile['crowdTolerance']>; label: string }[] = [
  { value: 'fine', label: "Don't mind" },
  { value: 'moderate', label: 'In moderation' },
  { value: 'avoid', label: 'Rather avoid' },
];

const FOOD_OPTIONS: { value: NonNullable<TravelProfile['foodImportance']>; label: string }[] = [
  { value: 'big', label: 'Big part of the trip' },
  { value: 'care', label: 'Care about eating well' },
  { value: 'simple', label: 'Keep it simple' },
];

const RECOMMENDATION_OPTIONS: { value: NonNullable<TravelProfile['recommendationStyle']>; label: string }[] = [
  { value: 'best', label: 'Just the best' },
  { value: 'few', label: 'A few choices' },
  { value: 'explore', label: 'Let me explore' },
];

const DECISION_PRIORITY_OPTIONS = [
  'It feels memorable', 'It\'s highly rated', 'It feels local & authentic',
  'It\'s beautiful', 'It\'s unique', 'It\'s good value',
  'It\'s convenient', 'It\'s popular for a reason',
];

const SPENDING_OPTIONS = [
  'Food', 'Stays', 'Experiences', 'Convenience', 'Shopping', 'Nightlife',
];

const INTEREST_OPTIONS = [
  'Culture & History', 'Food & Dining', 'Nature & Outdoors', 'Adventure & Sports',
  'Nightlife & Entertainment', 'Shopping & Markets', 'Art & Museums',
  'Wellness & Relaxation', 'Photography', 'Local Experiences',
  'Architecture', 'Music & Festivals', 'Beach & Water', 'Wildlife',
];

const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'Kosher',
  'Dairy-free', 'Nut allergy', 'Shellfish allergy',
];

const MOBILITY_OPTIONS = [
  'Wheelchair accessible', 'Limited walking', 'No stairs',
  'Elevator required', 'Service animal',
];

function ChipButton({ selected, label, onPress, theme }: { selected: boolean; label: string; onPress: () => void; theme: any }) {
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={[styles.chip, { backgroundColor: selected ? theme.primaryMuted : theme.backgroundElement, borderColor: selected ? theme.primary : theme.border }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <ThemedText style={[styles.chipText, selected && { color: theme.primary }]}>{label}</ThemedText>
    </Pressable>
  );
}

function SegmentPicker<T extends string>({ options, value, onChange, theme }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; theme: any }) {
  return (
    <View style={styles.segmentRow}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => { Haptics.selectionAsync(); onChange(o.value); }}
          style={[styles.segmentItem, { backgroundColor: value === o.value ? theme.primary : theme.backgroundElement, borderColor: value === o.value ? theme.primary : theme.border }]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === o.value }}
        >
          <ThemedText style={[styles.segmentText, value === o.value && { color: theme.primaryText }]}>{o.label}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { profile, updateProfile, resetProfile } = useProfile();

  const [pace, setPace] = useState(profile.pace);
  const [flexibility, setFlexibility] = useState(profile.flexibility);
  const [interests, setInterests] = useState([...profile.interests]);
  const [dietary, setDietary] = useState([...profile.dietaryRestrictions]);
  const [mobility, setMobility] = useState([...profile.mobilityNeeds]);
  const [accommodation, setAccommodation] = useState(profile.accommodationPreference);
  const [dislikes, setDislikes] = useState([...profile.dislikes]);
  const [rules, setRules] = useState([...profile.absoluteRules]);
  const [crowdTolerance, setCrowdTolerance] = useState(profile.crowdTolerance ?? 'moderate');
  const [foodImportance, setFoodImportance] = useState(profile.foodImportance ?? 'care');
  const [recommendationStyle, setRecommendationStyle] = useState(profile.recommendationStyle ?? 'few');
  const [decisionPriorities, setDecisionPriorities] = useState([...(profile.decisionPriorities ?? [])]);
  const [spendingPriorities, setSpendingPriorities] = useState([...(profile.spendingPriorities ?? [])]);
  const [dietaryNote, setDietaryNote] = useState(profile.dietaryNote ?? '');
  const [customInterest, setCustomInterest] = useState('');
  const [customDietary, setCustomDietary] = useState('');
  const [customMobility, setCustomMobility] = useState('');
  const [newRule, setNewRule] = useState('');
  const [newDislike, setNewDislike] = useState('');

  function toggleItem(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
  }

  function handleSave() {
    updateProfile({
      pace,
      flexibility,
      interests,
      dietaryRestrictions: dietary,
      dietaryNote: dietaryNote.trim() || undefined,
      mobilityNeeds: mobility,
      accommodationPreference: accommodation,
      dislikes,
      absoluteRules: rules,
      crowdTolerance,
      foodImportance,
      recommendationStyle,
      decisionPriorities,
      spendingPriorities,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  function handleReset() {
    Alert.alert(
      'Reset Travel Profile',
      'This will reset all your travel preferences. Your trips and account will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            resetProfile();
            await clearOnboardingComplete();
            router.back();
          },
        },
      ],
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cancel">
          <ThemedText style={{ color: theme.textSecondary, fontSize: 16 }}>Cancel</ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Edit Profile</ThemedText>
        <Pressable onPress={handleSave} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Save">
          <ThemedText style={{ color: theme.primary, fontSize: 16, fontWeight: '600' }}>Save</ThemedText>
        </Pressable>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Pace */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Travel pace</ThemedText>
          <SegmentPicker options={PACE_OPTIONS} value={pace} onChange={setPace} theme={theme} />

          {/* Flexibility */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Flexibility</ThemedText>
          <SegmentPicker options={FLEXIBILITY_OPTIONS} value={flexibility} onChange={setFlexibility} theme={theme} />

          {/* Accommodation */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Accommodation</ThemedText>
          <SegmentPicker options={ACCOMMODATION_OPTIONS} value={accommodation} onChange={setAccommodation} theme={theme} />

          {/* Crowd tolerance */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Crowds & touristy places</ThemedText>
          <SegmentPicker options={CROWD_OPTIONS} value={crowdTolerance} onChange={setCrowdTolerance} theme={theme} />

          {/* Food importance */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Food importance</ThemedText>
          <SegmentPicker options={FOOD_OPTIONS} value={foodImportance} onChange={setFoodImportance} theme={theme} />

          {/* Recommendation style */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Recommendation style</ThemedText>
          <SegmentPicker options={RECOMMENDATION_OPTIONS} value={recommendationStyle} onChange={setRecommendationStyle} theme={theme} />

          {/* Interests */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Interests</ThemedText>
          <View style={styles.chipGrid}>
            {INTEREST_OPTIONS.map((item) => (
              <ChipButton key={item} selected={interests.includes(item)} label={item} onPress={() => setInterests(toggleItem(interests, item))} theme={theme} />
            ))}
            {interests.filter((item) => !INTEREST_OPTIONS.includes(item)).map((item) => (
              <ChipButton key={item} selected={true} label={item} onPress={() => setInterests(toggleItem(interests, item))} theme={theme} />
            ))}
            <TextInput
              style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={customInterest}
              onChangeText={setCustomInterest}
              placeholder="Add interest..."
              placeholderTextColor={theme.textSecondary}
              onSubmitEditing={() => { const v = customInterest.trim(); if (v && !interests.includes(v)) setInterests([...interests, v]); setCustomInterest(''); }}
              returnKeyType="done"
            />
          </View>

          {/* Dietary */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Dietary needs</ThemedText>
          <View style={styles.chipGrid}>
            {DIETARY_OPTIONS.map((item) => (
              <ChipButton key={item} selected={dietary.includes(item)} label={item} onPress={() => setDietary(toggleItem(dietary, item))} theme={theme} />
            ))}
            {dietary.filter((item) => !DIETARY_OPTIONS.includes(item)).map((item) => (
              <ChipButton key={item} selected={true} label={item} onPress={() => setDietary(toggleItem(dietary, item))} theme={theme} />
            ))}
            <TextInput
              style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={customDietary}
              onChangeText={setCustomDietary}
              placeholder="Add dietary need..."
              placeholderTextColor={theme.textSecondary}
              onSubmitEditing={() => { const v = customDietary.trim(); if (v && !dietary.includes(v)) setDietary([...dietary, v]); setCustomDietary(''); }}
              returnKeyType="done"
            />
          </View>
          <TextInput
            style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement, marginTop: 8 }]}
            value={dietaryNote}
            onChangeText={setDietaryNote}
            placeholder="Notes (e.g. severe peanut allergy)..."
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
          />

          {/* Decision priorities */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>What matters most</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>
            {'Choose 1 to 3 factors that help you pick a place.'}
          </ThemedText>
          <View style={styles.chipGrid}>
            {DECISION_PRIORITY_OPTIONS.map((item) => {
              const selected = decisionPriorities.includes(item);
              const atMax = decisionPriorities.length >= 3;
              return (
                <ChipButton key={item} selected={selected} label={item} onPress={() => { if (selected || !atMax) setDecisionPriorities(toggleItem(decisionPriorities, item)); }} theme={theme} />
              );
            })}
          </View>

          {/* Spending priorities */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Happy to spend more on</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>
            {'Choose up to 2.'}
          </ThemedText>
          <View style={styles.chipGrid}>
            {SPENDING_OPTIONS.map((item) => {
              const selected = spendingPriorities.includes(item);
              const atMax = spendingPriorities.length >= 2;
              return (
                <ChipButton key={item} selected={selected} label={item} onPress={() => { if (selected || !atMax) setSpendingPriorities(toggleItem(spendingPriorities, item)); }} theme={theme} />
              );
            })}
          </View>

          {/* Mobility */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Accessibility needs</ThemedText>
          <View style={styles.chipGrid}>
            {MOBILITY_OPTIONS.map((item) => (
              <ChipButton key={item} selected={mobility.includes(item)} label={item} onPress={() => setMobility(toggleItem(mobility, item))} theme={theme} />
            ))}
            {mobility.filter((item) => !MOBILITY_OPTIONS.includes(item)).map((item) => (
              <ChipButton key={item} selected={true} label={item} onPress={() => setMobility(toggleItem(mobility, item))} theme={theme} />
            ))}
            <TextInput
              style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={customMobility}
              onChangeText={setCustomMobility}
              placeholder="Add accessibility need..."
              placeholderTextColor={theme.textSecondary}
              onSubmitEditing={() => { const v = customMobility.trim(); if (v && !mobility.includes(v)) setMobility([...mobility, v]); setCustomMobility(''); }}
              returnKeyType="done"
            />
          </View>

          {/* Travel rules */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Travel rules</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>
            {'Rules Travonal will always follow when planning your trips.'}
          </ThemedText>
          {rules.map((rule, i) => (
            <View key={i} style={[styles.ruleRow, { borderBottomColor: theme.border }]}>
              <ThemedText style={styles.ruleText}>{rule}</ThemedText>
              <Pressable onPress={() => setRules(rules.filter((_, j) => j !== i))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove rule">
                <SymbolView name="xmark" size={14} tintColor={theme.textSecondary} />
              </Pressable>
            </View>
          ))}
          <View style={styles.addRow}>
            <TextInput
              style={[styles.customInput, { flex: 1, color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={newRule}
              onChangeText={setNewRule}
              placeholder="e.g., Never schedule before 9 AM"
              placeholderTextColor={theme.textSecondary}
              onSubmitEditing={() => { const v = newRule.trim(); if (v) setRules([...rules, v]); setNewRule(''); }}
              returnKeyType="done"
            />
            <Pressable
              onPress={() => { const v = newRule.trim(); if (v) setRules([...rules, v]); setNewRule(''); }}
              style={[styles.addBtn, { backgroundColor: theme.primary, opacity: newRule.trim() ? 1 : 0.4 }]}
              disabled={!newRule.trim()}
              accessibilityRole="button"
            >
              <ThemedText style={{ color: theme.primaryText, fontSize: 14, fontWeight: '600' }}>Add</ThemedText>
            </Pressable>
          </View>

          {/* Dislikes */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Dislikes</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>
            {'Things Travonal should avoid recommending.'}
          </ThemedText>
          <View style={styles.chipGrid}>
            {dislikes.map((item) => (
              <ChipButton key={item} selected={true} label={item} onPress={() => setDislikes(dislikes.filter((d) => d !== item))} theme={theme} />
            ))}
            <TextInput
              style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
              value={newDislike}
              onChangeText={setNewDislike}
              placeholder="Add dislike..."
              placeholderTextColor={theme.textSecondary}
              onSubmitEditing={() => { const v = newDislike.trim(); if (v && !dislikes.includes(v)) setDislikes([...dislikes, v]); setNewDislike(''); }}
              returnKeyType="done"
            />
          </View>

          {/* Reset */}
          <View style={styles.resetSection}>
            <Pressable onPress={handleReset} accessibilityRole="button" accessibilityLabel="Reset travel profile">
              <ThemedText style={[styles.resetText, { color: theme.danger }]}>Reset travel profile</ThemedText>
            </Pressable>
            <ThemedText type="small" style={{ color: theme.textSecondary, textAlign: 'center' }}>
              {'Resets preferences and personalization. Trips and account are not affected.'}
            </ThemedText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  headerBtn: { minWidth: 60 },
  scrollContent: { padding: Spacing.four },
  sectionLabel: { marginTop: 24, marginBottom: 10 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: Radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segmentItem: { flexGrow: 1, flexBasis: '28%', paddingVertical: 10, paddingHorizontal: 10, borderRadius: Radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  customInput: { borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14, width: '100%', marginTop: 4 },
  ruleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  ruleText: { fontSize: 14, fontWeight: '500', flex: 1 },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  addBtn: { paddingHorizontal: 16, borderRadius: Radius.sm, justifyContent: 'center' },
  resetSection: { marginTop: 48, alignItems: 'center', gap: 8, paddingBottom: 24 },
  resetText: { fontSize: 15, fontWeight: '600' },
});
