import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/constants/legal';
import { useProfile } from '@/context/profile';
import { useTrips } from '@/context/trips';
import { useMemory } from '@/context/memory';
import { useInbox } from '@/context/inbox';
import { useSavedPlaces } from '@/context/saved-places';
import { useTripPulse } from '@/context/trip-pulse';
import { usePulseHistory } from '@/context/pulse-history';
import { useTheme } from '@/hooks/use-theme';
import { TravelStyleCard } from '@/components/travel-style-card';
import { isExploreFeedbackEntry } from '@/services/explore-filters';
import { clearOnboardingComplete, resetAllData, loadChatMessages, loadRecentSearches, loadDismissedPulse, loadSeenPulse, loadNotifDismissed, loadTripPulseEnabled, loadLearningEnabled } from '@/services/storage';
import { hasPermission, openNotificationSettings } from '@/services/notifications';
import { resolveCountry } from '@/services/trip-helpers';

const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Gluten-free',
  'Dairy-free', 'Nut allergy', 'Seafood allergy',
];

const MOBILITY_OPTIONS = [
  'Wheelchair accessible', 'Limited walking', 'No stairs',
  'Elevator required', 'Close parking needed',
];

function SettingRow({
  label,
  sublabel,
  value,
  onToggle,
  theme,
}: {
  label: string;
  sublabel: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  theme: any;
}) {
  function handleToggle(v: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle(v);
  }

  return (
    <View style={[styles.listRow, { borderBottomColor: theme.border }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.listRowTitle}>{label}</ThemedText>
        <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>{sublabel}</ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={handleToggle}
        trackColor={{ false: 'rgba(128,128,128,0.2)', true: theme.primary }}
        thumbColor="#fff"
        ios_backgroundColor="rgba(128,128,128,0.2)"
        accessibilityLabel={label}
        accessibilityRole="switch"
      />
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const { profile, updateProfile, resetProfile } = useProfile();
  const { trips } = useTrips();
  const { entries, removeEntry, clearAll, learningEnabled, setLearningEnabled, resetAll: resetMemory } = useMemory();
  const { items: inboxItems, resetAll: resetInbox } = useInbox();
  const { savedPlaces, resetAll: resetSavedPlaces } = useSavedPlaces();
  const { enabled: tripPulseEnabled, loaded: tripPulseLoaded, setEnabled: setTripPulseEnabled, resetAll: resetTripPulse } = useTripPulse();
  const { resetAll: resetPulseHistory } = usePulseHistory();
  const { resetAll: resetTrips } = useTrips();

  const [showMemoryEntries, setShowMemoryEntries] = useState(false);
  const [showDietary, setShowDietary] = useState(false);
  const [showMobility, setShowMobility] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [newRule, setNewRule] = useState('');
  const [customDietary, setCustomDietary] = useState('');
  const [customMobility, setCustomMobility] = useState('');

  const totalTrips = trips.length;
  const uniqueCountries = new Set(
    trips.map((t) => resolveCountry(t.country || t.destination) ?? t.destination)
  ).size;
  const totalActivities = trips.reduce((sum, t) => sum + t.activities.length, 0);

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcomingTrips = trips.filter((t) => new Date(t.startDate + 'T00:00:00') >= now).length;

  function toggleArrayItem(key: 'dietaryRestrictions' | 'mobilityNeeds', item: string) {
    const current = profile[key];
    const updated = current.includes(item)
      ? current.filter((i) => i !== item)
      : [...current, item];
    updateProfile({ [key]: updated });
  }

  function addRule() {
    const rule = newRule.trim();
    if (!rule) return;
    updateProfile({ absoluteRules: [...profile.absoluteRules, rule] });
    setNewRule('');
  }

  function removeRule(index: number) {
    updateProfile({
      absoluteRules: profile.absoluteRules.filter((_, i) => i !== index),
    });
  }

  function handleReset() {
    Alert.alert(
      'Reset Profile',
      'This will reset your travel preferences and clear all learned memories. Your trips will not be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            resetProfile();
            clearAll();
            await clearOnboardingComplete();
            router.replace('/onboarding' as any);
          },
        },
      ]
    );
  }

  function handleResetEverything() {
    Alert.alert(
      'Reset Everything',
      'This will permanently delete all your trips, activities, saved places, inbox, travel memory, profile answers, chat history, and settings. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            await resetAllData();
            resetProfile();
            resetMemory();
            resetTrips();
            resetInbox();
            resetSavedPlaces();
            resetTripPulse();
            resetPulseHistory();
            router.replace('/onboarding' as any);
          },
        },
      ]
    );
  }

  function handleClearMemory() {
    Alert.alert(
      'Clear Travel Memory',
      'This will remove all learned preferences. Travonal will start learning from scratch.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearAll },
      ]
    );
  }

  function handleResetExploreFeedback() {
    const feedbackCount = entries.filter(isExploreFeedbackEntry).length;
    if (feedbackCount === 0) {
      Alert.alert('No feedback', 'You have no Explore recommendation feedback to reset.');
      return;
    }
    Alert.alert(
      'Reset recommendation feedback',
      `This will remove ${feedbackCount} Explore feedback ${feedbackCount === 1 ? 'entry' : 'entries'} (likes, dislikes, visited). Your other travel memories will be preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            for (const entry of entries) {
              if (isExploreFeedbackEntry(entry)) {
                removeEntry(entry.id);
              }
            }
          },
        },
      ]
    );
  }

  function handleDeleteMemoryEntry(id: string) {
    Alert.alert(
      'Remove Memory',
      'Remove this learned preference?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeEntry(id) },
      ]
    );
  }

  async function handleExport() {
    const [chatMessages, recentSearches, dismissedPulse, seenPulse, notifDismissed, pulseEnabled, memoryLearning] = await Promise.all([
      loadChatMessages([]),
      loadRecentSearches(),
      loadDismissedPulse(),
      loadSeenPulse(),
      loadNotifDismissed(),
      loadTripPulseEnabled(),
      loadLearningEnabled(),
    ]);

    const data = {
      exportVersion: 2,
      exportedAt: new Date().toISOString(),
      profile,
      trips: trips.map((t) => ({
        ...t,
        activities: t.activities,
        reservations: t.reservations,
        prepItems: t.prepItems,
        expenses: t.expenses,
        invitations: t.invitations,
      })),
      inbox: inboxItems,
      savedPlaces,
      memoryEntries: entries,
      chatMessages,
      recentSearches,
      pulseState: { dismissedPulse, seenPulse },
      settings: { notifDismissed, pulseEnabled, memoryLearning },
    };
    try {
      await Share.share({
        message: JSON.stringify(data, null, 2),
        title: 'Travonal Data Export',
      });
    } catch {}
  }

  function handleActionRowPress(action: () => void) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    action();
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText type="title" style={styles.titleSpacing}>Profile</ThemedText>

        {/* Travel Style Card */}
        <TravelStyleCard
          profile={profile}
          onPress={() => router.push('/onboarding')}
        />

        {/* Trip stats */}
        <View style={[styles.statsRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.statItem}>
            <ThemedText style={styles.statNumber}>{totalTrips}</ThemedText>
            <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>trips</ThemedText>
          </View>
          <View style={styles.statItem}>
            <ThemedText style={styles.statNumber}>{uniqueCountries}</ThemedText>
            <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>countries</ThemedText>
          </View>
          <View style={styles.statItem}>
            <ThemedText style={styles.statNumber}>{totalActivities}</ThemedText>
            <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>activities</ThemedText>
          </View>
        </View>

        {upcomingTrips > 0 && (
          <ThemedText style={[styles.upcomingNote, { color: theme.textSecondary }]}>
            {upcomingTrips} upcoming {upcomingTrips === 1 ? 'trip' : 'trips'}
          </ThemedText>
        )}

        {/* Preferences section */}
        <ThemedText type="eyebrow" style={[styles.sectionEyebrow, { color: theme.textSecondary }]}>
          Preferences
        </ThemedText>

        {/* Flexibility */}
        <View style={[styles.listRow, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.listRowTitle}>Flexibility</ThemedText>
            <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>
              {profile.flexibility === 'planned' ? 'Planned — I like a set schedule' : profile.flexibility === 'some' ? 'Some flexibility' : 'Free-flow — go with the moment'}
            </ThemedText>
          </View>
          <Pressable onPress={() => router.push('/onboarding?edit=1' as any)} accessibilityRole="button" accessibilityLabel="Edit travel preferences">
            <ThemedText style={[styles.chevron, { color: theme.primary, fontSize: 13, fontWeight: '600' }]}>Edit</ThemedText>
          </Pressable>
        </View>

        {/* Accommodation preference */}
        <View style={[styles.listRow, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.listRowTitle}>Accommodation</ThemedText>
            <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>
              {profile.accommodationPreference.charAt(0).toUpperCase() + profile.accommodationPreference.slice(1)}
            </ThemedText>
          </View>
          <Pressable onPress={() => router.push('/onboarding?edit=1' as any)} accessibilityRole="button" accessibilityLabel="Edit travel preferences">
            <ThemedText style={[styles.chevron, { color: theme.primary, fontSize: 13, fontWeight: '600' }]}>Edit</ThemedText>
          </Pressable>
        </View>

        {/* Travel with */}
        <View style={[styles.listRow, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.listRowTitle}>Traveling with</ThemedText>
            <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>
              {profile.travelWith.charAt(0).toUpperCase() + profile.travelWith.slice(1)}
            </ThemedText>
          </View>
          <Pressable onPress={() => router.push('/onboarding?edit=1' as any)} accessibilityRole="button" accessibilityLabel="Edit travel preferences">
            <ThemedText style={[styles.chevron, { color: theme.primary, fontSize: 13, fontWeight: '600' }]}>Edit</ThemedText>
          </Pressable>
        </View>

        {/* Dietary Restrictions */}
        <Pressable
          onPress={() => setShowDietary(!showDietary)}
          style={[styles.listRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Dietary restrictions"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.listRowTitle}>Dietary restrictions</ThemedText>
            <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>
              {profile.dietaryRestrictions.length === 0
                ? 'None'
                : profile.dietaryRestrictions.join(', ')}
            </ThemedText>
          </View>
          <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>{showDietary ? '\u2212' : '+'}</ThemedText>
        </Pressable>
        {showDietary && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.chipGrid}>
            {DIETARY_OPTIONS.map((item) => (
              <Pressable
                key={item}
                onPress={() => toggleArrayItem('dietaryRestrictions', item)}
                style={[
                  styles.chip,
                  { backgroundColor: profile.dietaryRestrictions.includes(item) ? theme.primary : theme.backgroundElement },
                ]}
                accessibilityRole="button"
                accessibilityLabel={item}
                accessibilityState={{ selected: profile.dietaryRestrictions.includes(item) }}
              >
                <ThemedText style={[styles.chipText, profile.dietaryRestrictions.includes(item) && { color: theme.primaryText }]}>
                  {item}
                </ThemedText>
              </Pressable>
            ))}
            {/* Custom items already added */}
            {profile.dietaryRestrictions
              .filter((item) => !DIETARY_OPTIONS.includes(item))
              .map((item) => (
                <Pressable
                  key={item}
                  onPress={() => toggleArrayItem('dietaryRestrictions', item)}
                  style={[styles.chip, { backgroundColor: theme.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item}`}
                >
                  <ThemedText style={[styles.chipText, { color: theme.primaryText }]}>{item}</ThemedText>
                </Pressable>
              ))}
            {/* Add custom */}
            <View style={styles.customInputRow}>
              <TextInput
                style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={customDietary}
                onChangeText={setCustomDietary}
                placeholder="Other..."
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Add custom dietary restriction"
                onSubmitEditing={() => {
                  const val = customDietary.trim();
                  if (val && !profile.dietaryRestrictions.includes(val)) {
                    updateProfile({ dietaryRestrictions: [...profile.dietaryRestrictions, val] });
                  }
                  setCustomDietary('');
                }}
                returnKeyType="done"
              />
              <Pressable
                onPress={() => {
                  const val = customDietary.trim();
                  if (val && !profile.dietaryRestrictions.includes(val)) {
                    updateProfile({ dietaryRestrictions: [...profile.dietaryRestrictions, val] });
                  }
                  setCustomDietary('');
                }}
                style={[styles.customAddBtn, { backgroundColor: theme.primary, opacity: customDietary.trim() ? 1 : 0.4 }]}
                disabled={!customDietary.trim()}
                accessibilityRole="button"
                accessibilityLabel="Add custom dietary restriction"
              >
                <ThemedText style={[styles.customAddText, { color: theme.primaryText }]}>Add</ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* Mobility / Accessibility */}
        <Pressable
          onPress={() => setShowMobility(!showMobility)}
          style={[styles.listRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Accessibility needs"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.listRowTitle}>Accessibility needs</ThemedText>
            <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>
              {profile.mobilityNeeds.length === 0
                ? 'None'
                : profile.mobilityNeeds.join(', ')}
            </ThemedText>
          </View>
          <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>{showMobility ? '\u2212' : '+'}</ThemedText>
        </Pressable>
        {showMobility && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.chipGrid}>
            {MOBILITY_OPTIONS.map((item) => (
              <Pressable
                key={item}
                onPress={() => toggleArrayItem('mobilityNeeds', item)}
                style={[
                  styles.chip,
                  { backgroundColor: profile.mobilityNeeds.includes(item) ? theme.primary : theme.backgroundElement },
                ]}
                accessibilityRole="button"
                accessibilityLabel={item}
                accessibilityState={{ selected: profile.mobilityNeeds.includes(item) }}
              >
                <ThemedText style={[styles.chipText, profile.mobilityNeeds.includes(item) && { color: theme.primaryText }]}>
                  {item}
                </ThemedText>
              </Pressable>
            ))}
            {/* Custom items already added */}
            {profile.mobilityNeeds
              .filter((item) => !MOBILITY_OPTIONS.includes(item))
              .map((item) => (
                <Pressable
                  key={item}
                  onPress={() => toggleArrayItem('mobilityNeeds', item)}
                  style={[styles.chip, { backgroundColor: theme.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item}`}
                >
                  <ThemedText style={[styles.chipText, { color: theme.primaryText }]}>{item}</ThemedText>
                </Pressable>
              ))}
            {/* Add custom */}
            <View style={styles.customInputRow}>
              <TextInput
                style={[styles.customInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={customMobility}
                onChangeText={setCustomMobility}
                placeholder="Other..."
                placeholderTextColor={theme.textSecondary}
                accessibilityLabel="Add custom accessibility need"
                onSubmitEditing={() => {
                  const val = customMobility.trim();
                  if (val && !profile.mobilityNeeds.includes(val)) {
                    updateProfile({ mobilityNeeds: [...profile.mobilityNeeds, val] });
                  }
                  setCustomMobility('');
                }}
                returnKeyType="done"
              />
              <Pressable
                onPress={() => {
                  const val = customMobility.trim();
                  if (val && !profile.mobilityNeeds.includes(val)) {
                    updateProfile({ mobilityNeeds: [...profile.mobilityNeeds, val] });
                  }
                  setCustomMobility('');
                }}
                style={[styles.customAddBtn, { backgroundColor: theme.primary, opacity: customMobility.trim() ? 1 : 0.4 }]}
                disabled={!customMobility.trim()}
                accessibilityRole="button"
                accessibilityLabel="Add custom accessibility need"
              >
                <ThemedText style={[styles.customAddText, { color: theme.primaryText }]}>Add</ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* Absolute Rules / Saved Preferences */}
        <Pressable
          onPress={() => setShowRules(!showRules)}
          style={[styles.listRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Travel rules"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.listRowTitle}>Travel rules</ThemedText>
            <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>
              {profile.absoluteRules.length === 0
                ? 'No rules set'
                : `${profile.absoluteRules.length} ${profile.absoluteRules.length === 1 ? 'rule' : 'rules'}`}
            </ThemedText>
          </View>
          <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>{showRules ? '\u2212' : '+'}</ThemedText>
        </Pressable>
        {showRules && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.rulesSection}>
            {profile.absoluteRules.map((rule, i) => (
              <View key={i} style={[styles.ruleRow, { borderBottomColor: theme.border }]}>
                <ThemedText style={styles.ruleText}>{rule}</ThemedText>
                <Pressable onPress={() => removeRule(i)} style={styles.ruleRemoveBtn} accessibilityRole="button" accessibilityLabel="Remove rule">
                  <ThemedText style={[styles.ruleRemoveText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
                </Pressable>
              </View>
            ))}
            <View style={styles.addRuleRow}>
              <TextInput
                style={[styles.ruleInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
                value={newRule}
                onChangeText={setNewRule}
                placeholder="e.g., Never schedule before 9 AM"
                placeholderTextColor={theme.textSecondary}
                onSubmitEditing={addRule}
                returnKeyType="done"
              />
              <Pressable
                onPress={addRule}
                style={[styles.addRuleBtn, { backgroundColor: theme.primary, opacity: newRule.trim() ? 1 : 0.4 }]}
                disabled={!newRule.trim()}
                accessibilityRole="button"
                accessibilityLabel="Add travel rule"
              >
                <ThemedText style={[styles.addRuleBtnText, { color: theme.primaryText }]}>Add</ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* Settings */}
        <ThemedText type="eyebrow" style={[styles.sectionEyebrow, { color: theme.textSecondary }]}>
          Settings
        </ThemedText>
        <SettingRow
          label="Trip Pulse"
          sublabel={tripPulseLoaded ? "Get smart alerts about your itinerary" : "Loading\u2026"}
          value={tripPulseLoaded ? tripPulseEnabled : false}
          onToggle={tripPulseLoaded ? setTripPulseEnabled : () => {}}
          theme={theme}
        />
        <SettingRow
          label="Travel Memory"
          sublabel="Learn from your choices to improve suggestions"
          value={learningEnabled}
          onToggle={setLearningEnabled}
          theme={theme}
        />
        <Pressable
          onPress={() => openNotificationSettings()}
          style={[styles.listRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Open notification settings"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.listRowTitle}>Notifications</ThemedText>
            <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>
              {hasPermission() ? 'Enabled — tap to manage in Settings' : 'Disabled — tap to enable in Settings'}
            </ThemedText>
          </View>
          <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
        </Pressable>

        {/* Travel Memory */}
        <Pressable
          onPress={() => setShowMemoryEntries(!showMemoryEntries)}
          style={[styles.listRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Travel memory"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.listRowTitle}>Travel memory</ThemedText>
            <ThemedText style={[styles.listRowSubtitle, { color: theme.textSecondary }]}>
              {entries.length} {entries.length === 1 ? 'thing' : 'things'} learned
            </ThemedText>
          </View>
          <ThemedText style={[styles.chevron, { color: theme.textSecondary }]}>{showMemoryEntries ? '\u2212' : '+'}</ThemedText>
        </Pressable>

        {showMemoryEntries && entries.length > 0 && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.memoryList}>
            {entries.slice(-20).reverse().map((entry) => (
              <View
                key={entry.id}
                style={[styles.memoryCard, { borderBottomColor: theme.border }]}
              >
                <View style={styles.memoryCardContent}>
                  <ThemedText style={[styles.memoryType, { color: theme.textSecondary }]}>
                    {entry.type.replace(/_/g, ' ')}
                    {entry.isGlobal ? ' \u2022 Global' : ' \u2022 Trip-only'}
                  </ThemedText>
                  <ThemedText style={styles.memoryDetail}>{entry.detail}</ThemedText>
                </View>
                <Pressable
                  onPress={() => handleDeleteMemoryEntry(entry.id)}
                  style={styles.memoryDeleteBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Delete memory"
                >
                  <ThemedText style={[styles.memoryDeleteText, { color: theme.textSecondary }]}>{'\u2715'}</ThemedText>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={handleClearMemory} style={styles.clearMemoryBtn} accessibilityRole="button" accessibilityLabel="Clear all memory">
              <ThemedText style={[styles.clearMemoryText, { color: theme.danger }]}>Clear all memory</ThemedText>
            </Pressable>
          </Animated.View>
        )}

        {showMemoryEntries && entries.length === 0 && (
          <ThemedText style={[styles.emptyMemory, { color: theme.textSecondary }]}>
            No travel memories yet. Use the app and Travonal will learn from your choices.
          </ThemedText>
        )}

        {/* Account */}
        <ThemedText type="eyebrow" style={[styles.sectionEyebrow, { color: theme.textSecondary }]}>
          Account
        </ThemedText>
        <Pressable
          onPress={() => handleActionRowPress(() => router.push('/onboarding?edit=1' as any))}
          style={[styles.actionRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Edit travel profile"
        >
          <ThemedText style={styles.actionLabel}>Edit travel profile</ThemedText>
          <ThemedText style={[styles.actionChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
        </Pressable>
        <View style={[styles.actionRow, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.actionLabel}>Sign in</ThemedText>
            <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Coming soon</ThemedText>
          </View>
          <ThemedText style={[styles.actionChevron, { color: theme.textSecondary, opacity: 0.3 }]}>{'\u203A'}</ThemedText>
        </View>
        <View style={[styles.actionRow, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.actionLabel}>Travonal Pro</ThemedText>
            <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Coming soon</ThemedText>
          </View>
          <ThemedText style={[styles.actionChevron, { color: theme.textSecondary, opacity: 0.3 }]}>{'\u203A'}</ThemedText>
        </View>
        <Pressable
          onPress={() => handleActionRowPress(handleReset)}
          style={[styles.actionRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Reset travel profile"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.actionLabel, { color: theme.danger }]}>Reset travel profile</ThemedText>
            <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Clears preferences and memories, keeps trips</ThemedText>
          </View>
        </Pressable>
        <Pressable
          onPress={() => handleActionRowPress(handleResetEverything)}
          style={[styles.actionRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Reset everything"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.actionLabel, { color: theme.danger }]}>Reset everything</ThemedText>
            <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Deletes all data including trips, inbox, and settings</ThemedText>
          </View>
        </Pressable>

        {/* Privacy */}
        <ThemedText type="eyebrow" style={[styles.sectionEyebrow, { color: theme.textSecondary }]}>
          Privacy
        </ThemedText>
        <Pressable
          onPress={() => handleActionRowPress(() => setShowMemoryEntries(true))}
          style={[styles.actionRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Manage personalization"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.actionLabel}>Manage personalization</ThemedText>
            <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Control how Travonal uses your data</ThemedText>
          </View>
          <ThemedText style={[styles.actionChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => handleActionRowPress(handleResetExploreFeedback)}
          style={[styles.actionRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Reset recommendation feedback"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.actionLabel}>Reset recommendation feedback</ThemedText>
            <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Clear Explore likes, dislikes, and visited marks</ThemedText>
          </View>
          <ThemedText style={[styles.actionChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => handleActionRowPress(handleExport)}
          style={[styles.actionRow, { borderBottomColor: theme.border }]}
          accessibilityRole="button"
          accessibilityLabel="Export data"
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.actionLabel}>Export data</ThemedText>
            <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Share your trips and preferences</ThemedText>
          </View>
          <ThemedText style={[styles.actionChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
        </Pressable>

        {/* Legal */}
        <ThemedText type="eyebrow" style={[styles.sectionEyebrow, { color: theme.textSecondary }]}>
          Legal
        </ThemedText>
        {PRIVACY_POLICY_URL ? (
          <Pressable
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL!)}
            style={[styles.actionRow, { borderBottomColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Open Privacy Policy"
          >
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.actionLabel}>Privacy Policy</ThemedText>
            </View>
            <ThemedText style={[styles.actionChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
          </Pressable>
        ) : (
          <View style={[styles.actionRow, { borderBottomColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.actionLabel}>Privacy Policy</ThemedText>
              <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Coming soon</ThemedText>
            </View>
            <ThemedText style={[styles.actionChevron, { color: theme.textSecondary, opacity: 0.3 }]}>{'\u203A'}</ThemedText>
          </View>
        )}
        {TERMS_OF_USE_URL ? (
          <Pressable
            onPress={() => Linking.openURL(TERMS_OF_USE_URL!)}
            style={[styles.actionRow, { borderBottomColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Open Terms of Service"
          >
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.actionLabel}>Terms of Service</ThemedText>
            </View>
            <ThemedText style={[styles.actionChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
          </Pressable>
        ) : (
          <View style={[styles.actionRow, { borderBottomColor: theme.border }]}>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.actionLabel}>Terms of Service</ThemedText>
              <ThemedText style={[styles.actionSublabel, { color: theme.textSecondary }]}>Coming soon</ThemedText>
            </View>
            <ThemedText style={[styles.actionChevron, { color: theme.textSecondary, opacity: 0.3 }]}>{'\u203A'}</ThemedText>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four },
  titleSpacing: { marginBottom: Spacing.four },

  // Stats row
  statsRow: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 20, marginTop: 16 },
  statItem: { flex: 1, alignItems: 'center' },
  statNumber: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 12 },
  upcomingNote: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },

  // Section eyebrow
  sectionEyebrow: { marginTop: 32, marginBottom: 12 },

  // List rows
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  listRowTitle: { fontSize: 15, fontWeight: '600' },
  listRowSubtitle: { fontSize: 13, marginTop: 2 },
  chevron: { fontSize: 18, fontWeight: '300' },

  // Chips
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  chipText: { fontSize: 14, fontWeight: '500' },
  customInputRow: { flexDirection: 'row', gap: 8, width: '100%', marginTop: 4 },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
  },
  customAddBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: 'center',
  },
  customAddText: { fontSize: 14, fontWeight: '600' },

  // Rules
  rulesSection: { gap: 0, marginTop: 4 },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  ruleText: { fontSize: 14, fontWeight: '500', flex: 1 },
  ruleRemoveBtn: { padding: 4 },
  ruleRemoveText: { fontSize: 14 },
  addRuleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ruleInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  addRuleBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: 'center',
  },
  addRuleBtnText: { fontSize: 14, fontWeight: '600' },

  // Memory
  memoryList: { gap: 0, marginTop: 4 },
  memoryCard: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  memoryCardContent: { flex: 1, gap: 2 },
  memoryType: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  memoryDetail: { fontSize: 14, fontWeight: '500' },
  memoryDeleteBtn: { padding: 8 },
  memoryDeleteText: { fontSize: 12 },
  clearMemoryBtn: { alignItems: 'center', paddingVertical: 12 },
  clearMemoryText: { fontSize: 13, fontWeight: '600' },
  emptyMemory: { fontSize: 14, fontStyle: 'italic', marginTop: 8 },

  // Action rows
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: { fontSize: 15, fontWeight: '600', flex: 1 },
  actionSublabel: { fontSize: 13, marginTop: 2 },
  actionChevron: { fontSize: 20, fontWeight: '300' },
});
