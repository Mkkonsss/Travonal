import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Radius } from '@/constants/theme';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL, SUPPORT_EMAIL } from '@/constants/legal';
import { useProfile } from '@/context/profile';
import { useTrips } from '@/context/trips';
import { useMemory, type TravelMemoryEntry } from '@/context/memory';
import { useAuth } from '@/context/auth';
import { useInbox } from '@/context/inbox';
import { useTripPulse } from '@/context/trip-pulse';
import { usePulseHistory } from '@/context/pulse-history';
import { useTheme } from '@/hooks/use-theme';
import { useToast } from '@/context/toast';

import { clearOnboardingComplete, resetAllData, clearLastUserId, loadChatMessages, saveChatMessages, saveChatThreads, loadRecentSearches, loadDismissedPulse, loadSeenPulse, loadNotifDismissed, loadTripPulseEnabled, loadLearningEnabled } from '@/services/storage';
import { mergeUserSettings, pullUserSettings } from '@/services/sync';
import { hasPermission, requestNotificationPermission, onPermissionChange, openNotificationSettings } from '@/services/notifications';
import { deleteAccount } from '@/services/supabase';
import { verifyEntitlement, openSubscriptionManagement } from '@/services/subscription';
import { useSubscription } from '@/context/subscription';
import Constants from 'expo-constants';
import * as StoreReview from 'expo-store-review';



/** Format email prefix into a readable display name */
function formatDisplayName(email?: string): string {
  if (!email) return 'Traveler';
  const prefix = email.split('@')[0];
  return prefix
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\d+$/, '')
    .trim() || 'Traveler';
}

// ─── Sub-section components ───

function NavRow({
  label,
  sublabel,
  onPress,
  theme,
  destructive,
  last,
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  theme: any;
  destructive?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={[styles.navRow, { borderBottomColor: theme.border }, last && { borderBottomWidth: 0 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={{ flex: 1 }}>
        <ThemedText style={[styles.navLabel, { color: destructive ? theme.danger : theme.textSecondary }]}>{label}</ThemedText>
        {sublabel ? <ThemedText style={[styles.navSublabel, { color: theme.textSecondary }]}>{sublabel}</ThemedText> : null}
      </View>
      <ThemedText style={[styles.navChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
    </Pressable>
  );
}

function InfoRow({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: any;
}) {
  return (
    <View style={[styles.navRow, { borderBottomColor: theme.border }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={[styles.navLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
        <ThemedText style={[styles.navSublabel, { color: theme.textSecondary }]}>{value}</ThemedText>
      </View>
    </View>
  );
}

function SettingToggle({
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
  return (
    <View style={[styles.navRow, { borderBottomColor: theme.border }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={styles.navLabel}>{label}</ThemedText>
        <ThemedText style={[styles.navSublabel, { color: theme.textSecondary }]}>{sublabel}</ThemedText>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggle(v); }}
        trackColor={{ false: 'rgba(128,128,128,0.2)', true: '#10B981' }}
        thumbColor="#fff"
        ios_backgroundColor="rgba(128,128,128,0.2)"
        accessibilityLabel={label}
        accessibilityRole="switch"
      />
    </View>
  );
}

// ─── Memory insight components ───

const CATEGORY_LABELS: Record<string, string> = {
  crowds: 'crowded places',
  budget: 'price',
  food: 'food experiences',
  preference: 'personal taste',
  logistics: 'logistics & timing',
  discovery: 'hidden gems',
  quality: 'quality',
  activity_type: 'activity types',
  destination: 'destinations visited',
};

function MemoryInsights({ entries, theme }: { entries: TravelMemoryEntry[]; theme: any }) {
  const active = entries.filter((e) => e.enabled);
  if (active.length < 2) return null;

  // Count by category + sentiment
  const negCounts = new Map<string, number>();
  const posCounts = new Map<string, number>();
  for (const e of active) {
    const isNeg = e.sentiment === 'negative' || e.type === 'activity_skipped' || e.type === 'recommendation_rejected';
    const map = isNeg ? negCounts : posCounts;
    map.set(e.category, (map.get(e.category) ?? 0) + 1);
  }

  const insights: string[] = [];

  // Top negative pattern
  const topNeg = [...negCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topNeg && topNeg[1] >= 2) {
    insights.push(`You tend to avoid ${CATEGORY_LABELS[topNeg[0]] ?? topNeg[0]} (${topNeg[1]} signals)`);
  }

  // Top positive pattern
  const topPos = [...posCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topPos && topPos[1] >= 2) {
    insights.push(`You love ${CATEGORY_LABELS[topPos[0]] ?? topPos[0]} (${topPos[1]} signals)`);
  }

  // Destination count
  const destinations = new Set(active.filter((e) => e.destination).map((e) => e.destination));
  if (destinations.size >= 2) {
    insights.push(`Learned from ${destinations.size} destinations`);
  }

  if (insights.length === 0) return null;

  return (
    <View style={styles.insightsContainer}>
      {insights.map((text, i) => (
        <ThemedText key={i} style={[styles.insightText, { color: theme.textSecondary }]}>
          {text}
        </ThemedText>
      ))}
    </View>
  );
}

function MemoryGroup({
  label,
  entries,
  showAll,
  theme,
  onDelete,
}: {
  label: string;
  entries: TravelMemoryEntry[];
  showAll: boolean;
  theme: any;
  onDelete: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  const visible = showAll ? [...entries].reverse() : entries.slice(-3).reverse();

  return (
    <View style={styles.memoryGroupContainer}>
      <ThemedText style={[styles.memoryGroupLabel, { color: theme.text }]}>
        {label} ({entries.length})
      </ThemedText>
      {visible.map((entry) => (
        <View key={entry.id} style={[styles.memoryRow, { borderBottomColor: theme.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText style={styles.memoryDetail}>{entry.detail}</ThemedText>
            {entry.destination && (
              <ThemedText style={[styles.memoryMeta, { color: theme.textSecondary }]}>
                {entry.destination}
              </ThemedText>
            )}
          </View>
          <Pressable onPress={() => onDelete(entry.id)} style={{ padding: 8 }} accessibilityRole="button" accessibilityLabel="Remove">
            <SymbolView name="xmark" size={12} tintColor={theme.textSecondary} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const { profile, loaded: profileLoaded, updateProfile, resetProfile, setSyncErrorCallback } = useProfile();
  const { trips } = useTrips();
  const { entries, removeEntry, clearAll, learningEnabled, setLearningEnabled, resetAll: resetMemory } = useMemory();
  const { savedPlaces, resetAll: resetInbox } = useInbox();
  const { enabled: tripPulseEnabled, loaded: tripPulseLoaded, setEnabled: setTripPulseEnabled, resetAll: resetTripPulse } = useTripPulse();
  const { resetAll: resetPulseHistory } = usePulseHistory();
  const { resetAll: resetTrips } = useTrips();
  const { user, signOut, resetPassword } = useAuth();

  const displayName =
    profile.displayName?.trim() ||
    (user?.user_metadata?.full_name as string | undefined) ||
    formatDisplayName(user?.email);

  const derivedUsername = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
  const visibleUsername = profile.username || derivedUsername;

  const tripCount = trips.length;
  const destinationCount = new Set(trips.map((t) => t.destination).filter(Boolean)).size;
  const { showToast } = useToast();

  const [notificationsEnabled, setNotificationsEnabled] = useState(hasPermission());
  const [mediaPermissionGranted, setMediaPermissionGranted] = useState(false);
  const [showMemorySheet, setShowMemorySheet] = useState(false);
  const [chatMessageCount, setChatMessageCount] = useState(0);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { isPlus, usage, plan } = useSubscription();
  const planLabel = isPlus
    ? `Tripseek+ (${plan === 'annual' ? 'Annual' : 'Monthly'})`
    : 'Free plan';

  // Expanded sub-sections
  const [showAccount, setShowAccount] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    verifyEntitlement().then(setIsSubscribed).catch(() => {});
    loadChatMessages<unknown[]>([]).then((msgs) => setChatMessageCount(msgs.length));
    // Pre-check media permission so the picker opens instantly on tap
    ImagePicker.getMediaLibraryPermissionsAsync().then(({ status }) => {
      setMediaPermissionGranted(status === 'granted');
    });
  }, []);

  // Pull notification settings from cloud on sign-in
  useEffect(() => {
    if (!user?.id) return;
    pullUserSettings(user.id).then((remote) => {
      if (!remote) return;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    setSyncErrorCallback(() => showToast('Profile sync failed — changes saved locally', 'error'));
  }, [setSyncErrorCallback, showToast]);

  useEffect(() => {
    return onPermissionChange(() => setNotificationsEnabled(hasPermission()));
  }, []);

  // ─── Helpers ───

  // ─── Handlers ───

  async function handlePickAvatar() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!mediaPermissionGranted) {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Photo Access Required', 'Allow Tripseek to access your photos.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: openNotificationSettings },
        ]);
        return;
      }
      setMediaPermissionGranted(true);
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    updateProfile({ avatarUri: result.assets[0].uri });
  }


  function handleClearMemory() {
    Alert.alert(
      'Clear Travel Memory',
      'This will remove all learned preferences. Tripseek will start learning from scratch.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearAll },
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



  function handleResetPassword() {
    if (!user?.email) return;
    Alert.alert(
      'Reset Password',
      `Send a password reset link to ${user.email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Link',
          onPress: async () => {
            const { error } = await resetPassword(user.email!);
            if (error) {
              showToast('Could not send reset link. Try again later.', 'error');
            } else {
              showToast('Reset link sent to ' + user.email, 'success');
            }
          },
        },
      ],
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
      exportVersion: 3,
      exportedAt: new Date().toISOString(),
      summary: {
        tripCount: trips.length,
        memoryCount: entries.length,
        chatMessageCount: (chatMessages as unknown[]).length,
        savedPlaceCount: savedPlaces.length,
      },
      profile,
      trips: trips.map((t) => ({
        ...t,
        activities: t.activities,
        reservations: t.reservations,
        prepItems: t.prepItems,
        expenses: t.expenses,
        invitations: t.invitations,
      })),
      savedPlaces,
      memoryEntries: entries,
      chatMessages,
      recentSearches,
      pulseState: { dismissedPulse, seenPulse },
      settings: { notifDismissed, pulseEnabled, memoryLearning },
    };
    try {
      const result = await Share.share({ message: JSON.stringify(data, null, 2), title: 'Tripseek Data Export' });
      if (result.action === Share.sharedAction) {
        showToast('Data exported successfully', 'success');
      }
    } catch {
      showToast('Export failed — please try again', 'error');
    }
  }

  // ─── Render ───

  if (!profileLoaded) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ThemedText style={{ color: theme.textSecondary, fontSize: 14 }}>Loading...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identity header ── */}
        <View style={styles.identityHeader}>
          {/* Avatar */}
          <Pressable onPress={handlePickAvatar} style={styles.avatarWrap} accessibilityRole="button" accessibilityLabel="Change profile photo">
            {profile.avatarUri ? (
              <ExpoImage source={{ uri: profile.avatarUri }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, { backgroundColor: theme.primaryMuted, alignItems: 'center', justifyContent: 'center' }]}>
                <ThemedText style={[styles.avatarText, { color: theme.primary }]}>
                  {(displayName[0] ?? 'T').toUpperCase()}
                </ThemedText>
              </View>
            )}
            <View style={[styles.cameraBadge, { backgroundColor: theme.backgroundElement, borderColor: theme.background }]}>
              <SymbolView name="camera.fill" size={11} tintColor={theme.textSecondary} />
            </View>
          </Pressable>

          {/* Name / username / stats */}
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText style={styles.userName}>{displayName}</ThemedText>
            {visibleUsername ? (
              <ThemedText style={[styles.userUsername, { color: theme.textSecondary }]}>@{visibleUsername}</ThemedText>
            ) : null}
            <ThemedText style={[styles.userStats, { color: theme.textSecondary }]}>
              {tripCount} {tripCount === 1 ? 'trip' : 'trips'}
            </ThemedText>
          </View>
        </View>

        {/* Edit Profile pill button */}
        <Pressable
          onPress={() => router.push('/edit-profile' as any)}
          style={({ pressed }) => [styles.editProfileBtn, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <ThemedText style={[styles.editProfileBtnText, { color: theme.text }]}>Edit Profile</ThemedText>
        </Pressable>

        {/* ── Interests chips (inline, combined with profile) ── */}
        {profile.interests.length > 0 && (
          <View style={styles.interestsRow}>
            {profile.interests.map((i) => (
              <View key={i} style={[styles.interestChip, { borderColor: theme.border }]}>
                <ThemedText style={[styles.interestChipText, { color: theme.textSecondary }]}>{i.trim()}</ThemedText>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.sectionDivider, { backgroundColor: theme.border }]} />

        {/* ── Tripseek Plus ── */}
        <View style={styles.plusGlow}>
          <Pressable
            onPress={() => router.push('/toveli-plus' as any)}
            style={({ pressed }) => [styles.plusOuter, { backgroundColor: theme.background, opacity: pressed ? 0.85 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={isSubscribed ? 'Manage Tripseek+' : 'Explore Tripseek+'}
          >
            <Image
              source={theme.background === '#FFFFFF'
                ? require('@/assets/images/tripseek-plus-dark.png')
                : require('@/assets/images/tripseek-plus-light.png')}
              style={styles.plusLogo}
              resizeMode="contain"
            />
            <ThemedText style={[styles.plusSub, { color: theme.textSecondary }]}>
              {isSubscribed || isPlus
                ? (usage ? `${Math.max(0, (usage.limits.generations ?? 3) - usage.generations_used)} plans, ${Math.max(0, (usage.limits.assistance ?? 50) - usage.assistance_used)} messages left` : 'Your subscription is active.')
                : 'Your trips taken to the next level'}
            </ThemedText>
          </Pressable>
        </View>

        {/* ── Your Tripseek ── */}
        <ThemedText style={[styles.sectionLabel, { color: theme.text, marginTop: 4 }]}>Your Tripseek</ThemedText>

        <View style={styles.sectionGroup}>
          <NavRow
            label="Your trips"
            onPress={() => router.push('/(tabs)/' as any)}
            theme={theme}
          />
          <NavRow
            label="Your bookings"
            onPress={() => router.push('/bookings' as any)}
            theme={theme}
          />
          <NavRow
            label="Your boards"
            onPress={() => router.push('/inbox' as any)}
            theme={theme}
          />
          <NavRow
            label="Trip memory"
            onPress={() => setShowMemorySheet(true)}
            theme={theme}
            last
          />
        </View>

        {/* Trip Memory bottom sheet */}
        <Modal visible={showMemorySheet} transparent animationType="slide" onRequestClose={() => setShowMemorySheet(false)}>
          <Pressable style={styles.memorySheetBackdrop} onPress={() => setShowMemorySheet(false)}>
            <Pressable onPress={(e) => e.stopPropagation()} style={[styles.memorySheetContainer, { backgroundColor: theme.background }]}>
              <View style={styles.memorySheetHandle} />
              <View style={styles.memorySheetHeader}>
                <ThemedText style={styles.memorySheetTitle}>Trip Memory</ThemedText>
                <Pressable onPress={() => setShowMemorySheet(false)} hitSlop={12}>
                  <SymbolView name="xmark" size={16} tintColor={theme.textSecondary} />
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.memorySheetScroll}>
                <SettingToggle
                  label="Learn from my choices"
                  sublabel={learningEnabled ? 'Tripseek remembers your preferences' : 'Paused — existing memories are kept'}
                  value={learningEnabled}
                  onToggle={setLearningEnabled}
                  theme={theme}
                />
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: 16 }} />
                {entries.length > 0 ? (
                  <>
                    <MemoryInsights entries={entries} theme={theme} />
                    <MemoryGroup
                      label="What you love"
                      entries={entries.filter((e) => e.sentiment === 'positive' || e.type === 'recommendation_accepted' || e.type === 'preference_saved')}
                      showAll
                      theme={theme}
                      onDelete={handleDeleteMemoryEntry}
                    />
                    <MemoryGroup
                      label="What to avoid"
                      entries={entries.filter((e) => e.sentiment === 'negative' || e.type === 'activity_skipped' || e.type === 'recommendation_rejected')}
                      showAll
                      theme={theme}
                      onDelete={handleDeleteMemoryEntry}
                    />
                    <MemoryGroup
                      label="Choices made"
                      entries={entries.filter((e) => e.type === 'activity_replaced')}
                      showAll
                      theme={theme}
                      onDelete={handleDeleteMemoryEntry}
                    />
                    <Pressable onPress={() => { setShowMemorySheet(false); setTimeout(handleClearMemory, 300); }} style={styles.clearBtn}>
                      <ThemedText style={[styles.clearBtnText, { color: theme.textSecondary }]}>Clear all memory</ThemedText>
                    </Pressable>
                  </>
                ) : (
                  <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                    No memories yet. As you use Tripseek, it will learn from your choices to give better recommendations.
                  </ThemedText>
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        <View style={[styles.sectionDivider, { backgroundColor: theme.border }]} />

        {/* ── Settings ── */}
        <ThemedText style={[styles.sectionLabel, { color: theme.text, marginTop: 0 }]}>Settings</ThemedText>

        <View style={styles.sectionGroup}>
          {/* Notifications */}
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowNotifications(!showNotifications); }}
            style={[styles.navRow, { borderBottomColor: theme.border }]}
            accessibilityRole="button"
          >
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.navLabel, { color: theme.textSecondary }]}>Notifications</ThemedText>
            </View>
            <ThemedText style={[styles.navChevron, { color: theme.textSecondary }]}>{showNotifications ? '\u2212' : '\u203A'}</ThemedText>
          </Pressable>

          {showNotifications && (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
              <View style={styles.subSection}>
                <SettingToggle
                  label="Push notifications"
                  sublabel={notificationsEnabled ? 'Enabled — manage in Settings' : 'Disabled — tap to enable'}
                  value={notificationsEnabled}
                  onToggle={async (val) => {
                    if (val) {
                      const granted = await requestNotificationPermission();
                      if (!granted) {
                        Alert.alert('Enable Notifications', 'Notifications are blocked. Open Settings to allow Tripseek to send notifications.', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Open Settings', onPress: openNotificationSettings },
                        ]);
                      }
                      setNotificationsEnabled(granted);
                      if (tripPulseLoaded) setTripPulseEnabled(granted);
                    } else {
                      openNotificationSettings();
                    }
                  }}
                  theme={theme}
                />

              </View>
            </Animated.View>
          )}


          {/* Account */}
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowAccount(!showAccount); }}
            style={[styles.navRow, { borderBottomColor: theme.border }]}
            accessibilityRole="button"
          >
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.navLabel, { color: theme.textSecondary }]}>Account</ThemedText>
            </View>
            <ThemedText style={[styles.navChevron, { color: theme.textSecondary }]}>{showAccount ? '\u2212' : '\u203A'}</ThemedText>
          </Pressable>

          {showAccount && (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
              <View style={styles.subSection}>
                {user ? (
                  <>
                    <InfoRow label="Email" value={user.email ?? 'Unknown'} theme={theme} />
                    {isPlus ? (
                      <NavRow
                        label="Plan"
                        sublabel={planLabel}
                        onPress={() => openSubscriptionManagement()}
                        theme={theme}
                      />
                    ) : (
                      <InfoRow label="Plan" value={planLabel} theme={theme} />
                    )}
                    <NavRow
                      label="Reset password"
                      sublabel="Send a reset link to your email"
                      onPress={handleResetPassword}
                      theme={theme}
                    />
                    <NavRow
                      label="Export my data"
                      sublabel="Share your trips and preferences as JSON"
                      onPress={handleExport}
                      theme={theme}
                    />
                    <NavRow
                      label="Sign out"
                      onPress={() => {
                        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Sign Out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/onboarding' as any); } },
                        ]);
                      }}
                      theme={theme}
                    />
                    <NavRow
                      label="Delete account"
                      sublabel="Permanently delete your account and all data"
                      onPress={() => {
                        Alert.alert(
                          'Delete Account',
                          'This will permanently delete your account and all cloud data. Local data will also be cleared. This cannot be undone.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete Account',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  const { error } = await deleteAccount();
                                  if (error) {
                                    Alert.alert('Delete Failed', 'Your account could not be deleted right now. ' + error.message);
                                    return;
                                  }
                                  await resetAllData();
                                  await clearLastUserId();
                                  resetProfile();
                                  resetMemory();
                                  resetTrips();
                                  resetInbox();
                                  resetTripPulse();
                                  resetPulseHistory();
                                  await signOut();
                                  router.replace('/onboarding' as any);
                                } catch {
                                  Alert.alert('Error', 'Could not delete account. Please try again.');
                                }
                              },
                            },
                          ],
                        );
                      }}
                      theme={theme}
                      destructive
                    />
                  </>
                ) : (
                  <>
                    <NavRow
                      label="Sign in"
                      sublabel="Sync your trips and preferences across devices"
                      onPress={() => router.push('/sign-in' as any)}
                      theme={theme}
                    />
                    <NavRow
                      label="Create account"
                      sublabel="Free — keeps your trips backed up"
                      onPress={() => router.push('/sign-up' as any)}
                      theme={theme}
                    />
                  </>
                )}
              </View>
            </Animated.View>
          )}

          {/* Help & support — flat row */}
          {SUPPORT_EMAIL && (
            <NavRow
              label="Help & support"
              sublabel={SUPPORT_EMAIL}
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
              theme={theme}
            />
          )}
          <NavRow
            label="Leave a review"
            sublabel="Enjoying Tripseek? Let us know!"
            onPress={async () => {
              if (await StoreReview.hasAction()) {
                await StoreReview.requestReview();
              }
            }}
            theme={theme}
          />
        </View>

        <View style={[styles.sectionDivider, { backgroundColor: theme.border }]} />

        {/* ── Legal ── */}
        <ThemedText style={[styles.sectionLabel, { color: theme.text, marginTop: 0 }]}>Legal</ThemedText>

        <View style={styles.sectionGroup}>
          {PRIVACY_POLICY_URL ? (
            <NavRow label="Privacy Policy" onPress={() => Linking.openURL(PRIVACY_POLICY_URL!)} theme={theme} />
          ) : (
            <View style={[styles.navRow, { borderBottomColor: theme.border }]}>
              <ThemedText style={[styles.navLabel, { color: theme.textSecondary }]}>Privacy Policy</ThemedText>
              <ThemedText style={[styles.navSublabel, { color: theme.textSecondary }]}>Coming soon</ThemedText>
            </View>
          )}
          {TERMS_OF_USE_URL ? (
            <NavRow label="Terms of Service" onPress={() => Linking.openURL(TERMS_OF_USE_URL!)} theme={theme} />
          ) : (
            <View style={[styles.navRow, { borderBottomColor: theme.border }]}>
              <ThemedText style={[styles.navLabel, { color: theme.textSecondary }]}>Terms of Service</ThemedText>
              <ThemedText style={[styles.navSublabel, { color: theme.textSecondary }]}>Coming soon</ThemedText>
            </View>
          )}
        </View>

        <ThemedText style={[styles.versionText, { color: theme.textSecondary, textAlign: 'center', marginTop: 20, marginBottom: 8 }]}>
          Tripseek v{Constants.expoConfig?.version ?? '1.0.0'}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.four },

  // Identity header
  identityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 0,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 42,
    includeFontPadding: false,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  userUsername: {
    fontSize: 14,
    fontWeight: '500',
  },
  userBio: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  userStats: {
    fontSize: 13,
    marginTop: 4,
  },
  interestsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  interestChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  interestChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  editProfileBtn: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: Radius.xl,
    paddingVertical: 9,
    alignItems: 'center',
    marginTop: 16,
  },
  editProfileBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Section labels
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 10,
  },

  // Section groups
  sectionGroup: {
    marginBottom: 8,
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },

  // Nav rows
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  navSublabel: {
    fontSize: 13,
    marginTop: 1,
    opacity: 0.55,
  },
  navChevron: {
    fontSize: 22,
    fontWeight: '300',
    marginLeft: 8,
  },

  // Sub-sections (expanded content)
  subSection: {
    paddingLeft: 12,
  },

  // Memory bottom sheet
  memorySheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  memorySheetContainer: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  memorySheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.3)',
    alignSelf: 'center', marginTop: 10, marginBottom: 16,
  },
  memorySheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.four, marginBottom: 16,
  },
  memorySheetTitle: { fontSize: 17, fontWeight: '700' },
  memorySheetScroll: { paddingHorizontal: Spacing.four, paddingBottom: 8 },

  // Memory panel (legacy — keep for existing styles)
  memoryPanel: {
    paddingHorizontal: 4,
    marginTop: 4,
  },
  memoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  memoryType: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  memoryDetail: {
    fontSize: 14,
    fontWeight: '500',
  },
  memoryMeta: {
    fontSize: 11,
    fontWeight: '500',
  },
  memoryGroupContainer: {
    marginBottom: 12,
  },
  memoryGroupLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  insightsContainer: {
    marginBottom: 14,
    gap: 3,
  },
  insightText: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  clearBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    padding: 4,
  },

  // Tripseek Plus card
  plusGlow: {
    marginTop: 16,
    marginBottom: 40,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  plusOuter: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(128,128,128,0.15)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
  },
  plusLogo: {
    height: 32,
    width: 128,
  },
  plusSub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  // About
  versionText: {
    fontSize: 13,
  },
});
