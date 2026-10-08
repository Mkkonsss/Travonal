import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Radius } from '@/constants/theme';
import { useProfile, TravelProfile } from '@/context/profile';
import { useAuth } from '@/context/auth';
import { useTheme } from '@/hooks/use-theme';
import { clearOnboardingComplete } from '@/services/storage';

const CROWD_OPTIONS: { value: NonNullable<TravelProfile['crowdTolerance']>; label: string }[] = [
  { value: 'fine', label: "Don't mind" },
  { value: 'moderate', label: 'In moderation' },
  { value: 'avoid', label: 'Rather avoid' },
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

const MOBILITY_OPTIONS = [
  '♿  Step-free / wheelchair access',
  '🚶  Minimal walking',
  '🪑  Frequent places to sit or rest',
  '🚌  Accessible transportation',
  '🚻  Accessible restrooms',
  '👂  Hearing accessibility',
  '👁️  Vision accessibility',
  '🌿  Sensory-friendly environments',
];

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
function validateUsername(v: string): string {
  if (!v) return '';
  return USERNAME_RE.test(v) ? '' : 'Lowercase letters, numbers, underscores · 3–20 chars';
}

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
  const { user } = useAuth();

  // Social profile fields — auto-fill from auth if not yet set
  const authName = (user?.user_metadata?.full_name as string | undefined)
    ?? user?.email?.split('@')[0]?.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()
    ?? '';
  const derivedUsername = authName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 20);

  const [displayName, setDisplayName] = useState(profile.displayName ?? authName);
  const [username, setUsername] = useState(profile.username ?? derivedUsername);

  const [avatarUri, setAvatarUri] = useState(profile.avatarUri ?? '');
  const [usernameError, setUsernameError] = useState('');

  // Travel preferences
  const [interests, setInterests] = useState([...profile.interests]);
  const [decisionPriorities, setDecisionPriorities] = useState([...(profile.decisionPriorities ?? [])]);
  const [crowdTolerance, setCrowdTolerance] = useState(profile.crowdTolerance ?? 'moderate');
  const [dietary, setDietary] = useState([...profile.dietaryRestrictions]);
  const [mobility, setMobility] = useState([...profile.mobilityNeeds]);
  const [customInterest, setCustomInterest] = useState('');
  const [customDietary, setCustomDietary] = useState('');
  const [customMobility, setCustomMobility] = useState('');

  function toggleItem(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
  }

  async function handlePickAvatar() {
    let { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await ImagePicker.requestMediaLibraryPermissionsAsync());
    }
    if (status !== 'granted') {
      Alert.alert('Photo Access Required', 'Allow Tripseek to access your photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    setAvatarUri(result.assets[0].uri);
  }

  function handleSave() {
    const usernameVal = username.trim().toLowerCase();
    const err = validateUsername(usernameVal);
    if (err) { setUsernameError(err); return; }

    updateProfile({
      displayName: displayName.trim() || undefined,
      username: usernameVal || undefined,

      avatarUri: avatarUri || undefined,
      interests,
      decisionPriorities,
      crowdTolerance,
      dietaryRestrictions: dietary,
      mobilityNeeds: mobility,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  function handleReset() {
    Alert.alert(
      'Reset Preferences',
      'This will reset all your travel preferences. Your trips and account will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            resetProfile();
            await clearOnboardingComplete();
            router.replace({ pathname: '/onboarding', params: { survey: '1' } } as any);
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
        <Pressable onPress={handleSave} style={[styles.headerBtn, { alignItems: 'flex-end' }]} hitSlop={12} accessibilityRole="button" accessibilityLabel="Save">
          <ThemedText style={{ color: theme.primary, fontSize: 16, fontWeight: '600' }}>Save</ThemedText>
        </Pressable>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Social profile ── */}
          <Pressable onPress={handlePickAvatar} style={styles.editAvatarWrap} accessibilityRole="button" accessibilityLabel="Change profile photo">
            {avatarUri ? (
              <ExpoImage source={{ uri: avatarUri }} style={styles.editAvatar} contentFit="cover" />
            ) : (
              <View style={[styles.editAvatar, { backgroundColor: theme.primaryMuted, alignItems: 'center', justifyContent: 'center' }]}>
                <ThemedText style={{ fontSize: 32, fontWeight: '700', color: theme.primary, lineHeight: 38, includeFontPadding: false }}>
                  {(displayName[0] || (user?.user_metadata?.full_name as string | undefined)?.[0] || user?.email?.[0] || 'T').toUpperCase()}
                </ThemedText>
              </View>
            )}
            <View style={[styles.editCameraBadge, { backgroundColor: theme.backgroundElement, borderColor: theme.background }]}>
              <SymbolView name="camera.fill" size={13} tintColor={theme.textSecondary} />
            </View>
          </Pressable>

          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Name</ThemedText>
          <TextInput
            style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="next"
            autoCorrect={false}
          />

          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Username</ThemedText>
          <View style={[styles.usernameRow, { borderWidth: 1, borderRadius: Radius.lg, borderColor: usernameError ? theme.danger : theme.border, backgroundColor: theme.backgroundElement, marginTop: 4 }]}>
            <ThemedText style={{ fontSize: 14, color: theme.textSecondary, paddingLeft: 14 }}>@</ThemedText>
            <TextInput
              style={{ flex: 1, color: theme.text, fontSize: 14, paddingHorizontal: 4, paddingVertical: 9 }}
              value={username}
              onChangeText={(v) => { const l = v.toLowerCase(); setUsername(l); setUsernameError(validateUsername(l)); }}
              placeholder="username"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="next"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {usernameError ? (
            <ThemedText style={{ fontSize: 12, color: theme.danger, marginTop: 4 }}>{usernameError}</ThemedText>
          ) : null}

          <View style={{ height: StyleSheet.hairlineWidth, marginVertical: 20, backgroundColor: theme.border }} />

          {/* ── Travel preferences ── */}

          {/* Interests */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>What are you into?</ThemedText>
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

          {/* Decision priorities */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>What makes somewhere worth choosing?</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: 8 }}>Choose 1 to 3.</ThemedText>
          <View style={styles.chipGrid}>
            {DECISION_PRIORITY_OPTIONS.map((item) => {
              const selected = decisionPriorities.includes(item);
              const atMax = decisionPriorities.length >= 3;
              return (
                <ChipButton key={item} selected={selected} label={item} onPress={() => { if (selected || !atMax) setDecisionPriorities(toggleItem(decisionPriorities, item)); }} theme={theme} />
              );
            })}
          </View>

          {/* Crowd tolerance */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Busy, touristy places</ThemedText>
          <SegmentPicker options={CROWD_OPTIONS} value={crowdTolerance} onChange={setCrowdTolerance} theme={theme} />

          {/* Dietary */}
          <ThemedText type="eyebrow" style={[styles.sectionLabel, { color: theme.textSecondary }]}>Food & dietary</ThemedText>
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
          {/* Accessibility */}
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

          {/* Reset */}
          <View style={styles.resetSection}>
            <Pressable onPress={handleReset} accessibilityRole="button" accessibilityLabel="Reset travel profile">
              <ThemedText style={[styles.resetText, { color: theme.danger }]}>Reset preferences</ThemedText>
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
  resetSection: { marginTop: 48, alignItems: 'center', gap: 8, paddingBottom: 24 },
  resetText: { fontSize: 15, fontWeight: '600' },
  // Social profile
  editAvatarWrap: { position: 'relative', alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  editAvatar: { width: 90, height: 90, borderRadius: 45 },
  editCameraBadge: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
