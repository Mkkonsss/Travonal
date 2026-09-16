import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL, SUPPORT_EMAIL } from '@/constants/legal';
import { useProfile } from '@/context/profile';
import { useTrips } from '@/context/trips';
import { useMemory } from '@/context/memory';
import { useAuth } from '@/context/auth';
import { useInbox } from '@/context/inbox';
import { useTripPulse } from '@/context/trip-pulse';
import { usePulseHistory } from '@/context/pulse-history';
import { useTheme } from '@/hooks/use-theme';
import { useToast } from '@/context/toast';
import { TravelStyleCard } from '@/components/travel-style-card';

import { clearOnboardingComplete, resetAllData, loadChatMessages, loadRecentSearches, loadDismissedPulse, loadSeenPulse, loadNotifDismissed, loadTripPulseEnabled, loadLearningEnabled } from '@/services/storage';
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
}: {
  label: string;
  sublabel?: string;
  onPress: () => void;
  theme: any;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={[styles.navRow, { borderBottomColor: theme.border }]}
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

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const router = useRouter();
  const { profile, loaded: profileLoaded, resetProfile, setSyncErrorCallback } = useProfile();
  const { trips } = useTrips();
  const { entries, removeEntry, clearAll, learningEnabled, setLearningEnabled, resetAll: resetMemory } = useMemory();
  const { savedPlaces, resetAll: resetInbox } = useInbox();
  const { enabled: tripPulseEnabled, loaded: tripPulseLoaded, setEnabled: setTripPulseEnabled, resetAll: resetTripPulse } = useTripPulse();
  const { resetAll: resetPulseHistory } = usePulseHistory();
  const { resetAll: resetTrips } = useTrips();
  const { user, signOut } = useAuth();
  const { showToast } = useToast();

  const [notificationsEnabled, setNotificationsEnabled] = useState(hasPermission());
  const [showAllMemories, setShowAllMemories] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const { isPlus, usage } = useSubscription();

  // Expanded sub-sections
  const [showAccount, setShowAccount] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMemory, setShowMemory] = useState(false);

  useEffect(() => {
    verifyEntitlement().then(setIsSubscribed).catch(() => {});
  }, []);

  useEffect(() => {
    setSyncErrorCallback(() => showToast('Profile sync failed — changes saved locally', 'error'));
  }, [setSyncErrorCallback, showToast]);

  useEffect(() => {
    return onPermissionChange(() => setNotificationsEnabled(hasPermission()));
  }, []);

  // ─── Handlers ───

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
      savedPlaces,
      memoryEntries: entries,
      chatMessages,
      recentSearches,
      pulseState: { dismissedPulse, seenPulse },
      settings: { notifDismissed, pulseEnabled, memoryLearning },
    };
    try {
      const result = await Share.share({ message: JSON.stringify(data, null, 2), title: 'Travonal Data Export' });
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
          <View style={[styles.avatar, { backgroundColor: theme.primaryMuted }]}>
            <ThemedText style={[styles.avatarText, { color: theme.primary }]}>
              {(user?.email?.[0] ?? 'T').toUpperCase()}
            </ThemedText>
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.userName}>
              {formatDisplayName(user?.email)}
            </ThemedText>
            {user?.email && (
              <ThemedText style={[styles.userEmail, { color: theme.textSecondary }]}>{user.email}</ThemedText>
            )}
          </View>
        </View>

        {/* ── Travonal Plus ── */}
        <View style={styles.plusGlow}>
          <Pressable
            onPress={() => router.push('/travonal-plus' as any)}
            style={({ pressed }) => [styles.plusOuter, { backgroundColor: theme.background, opacity: pressed ? 0.8 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={isSubscribed ? 'Manage Travonal+' : 'Explore Travonal+'}
          >
            <View style={[styles.plusIcon, { backgroundColor: theme.primary }]}>
              <ThemedText style={[styles.plusIconText, { color: theme.primaryText }]}>T+</ThemedText>
            </View>
            <View style={styles.plusContent}>
              {isSubscribed || isPlus ? (
                <>
                  <ThemedText style={[styles.plusTitle, { color: theme.text }]}>Travonal+</ThemedText>
                  <ThemedText style={[styles.plusSub, { color: theme.textSecondary }]}>
                    {usage ? `${Math.max(0, (usage.limits.generations ?? 3) - usage.generations_used)} plans, ${Math.max(0, (usage.limits.assistance ?? 50) - usage.assistance_used)} messages left` : 'Your subscription is active.'}
                  </ThemedText>
                </>
              ) : (
                <>
                  <ThemedText style={[styles.plusTitle, { color: theme.text }]}>Travonal+</ThemedText>
                  <ThemedText style={[styles.plusSub, { color: theme.textSecondary }]}>Unlock AI trip editing, analysis & more</ThemedText>
                </>
              )}
            </View>
            <ThemedText style={[styles.plusChevron, { color: theme.textSecondary }]}>{'\u203A'}</ThemedText>
          </Pressable>
        </View>

        {/* ── Travel Style ── */}
        <View style={{ marginTop: 35 }} />
        <TravelStyleCard
          profile={profile}
          onPress={() => router.push('/edit-profile' as any)}
          compact
        />

        <View style={[styles.sectionDivider, { backgroundColor: theme.border }]} />

        {/* ── Your Travonal ── */}
        <ThemedText style={[styles.sectionLabel, { color: theme.text, marginTop: 0 }]}>Your Travonal</ThemedText>

        <View style={styles.sectionGroup}>
          <NavRow
            label="Your boards"
            sublabel={savedPlaces.length > 0 ? `${savedPlaces.length} ${savedPlaces.length === 1 ? 'place' : 'places'} saved` : 'None yet'}
            onPress={() => router.push('/inbox' as any)}
            theme={theme}
          />
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowMemory(!showMemory); }}
            style={[styles.navRow, { borderBottomWidth: 0 }]}
            accessibilityRole="button"
            accessibilityLabel="Trip memory"
          >
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.navLabel, { color: theme.textSecondary }]}>Trip memory</ThemedText>
              <ThemedText style={[styles.navSublabel, { color: theme.textSecondary }]}>
                {entries.length > 0
                  ? `${entries.length} ${entries.length === 1 ? 'thing' : 'things'} learned`
                  : 'What Travonal has learned'}
              </ThemedText>
            </View>
            <ThemedText style={[styles.navChevron, { color: theme.textSecondary }]}>{showMemory ? '\u2212' : '\u203A'}</ThemedText>
          </Pressable>
        </View>

        {/* Memory entries (expandable) */}
        {showMemory && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
            <View style={styles.memoryPanel}>
              {entries.length > 0 ? (
                <>
                  {(showAllMemories ? [...entries].reverse() : entries.slice(-5).reverse()).map((entry) => (
                    <View key={entry.id} style={[styles.memoryRow, { borderBottomColor: theme.border }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <ThemedText style={[styles.memoryType, { color: theme.textSecondary }]}>
                          {entry.type.replace(/_/g, ' ')}{entry.isGlobal ? ' \u00B7 Global' : ''}
                        </ThemedText>
                        <ThemedText style={styles.memoryDetail}>{entry.detail}</ThemedText>
                      </View>
                      <Pressable onPress={() => handleDeleteMemoryEntry(entry.id)} style={{ padding: 8 }} accessibilityRole="button" accessibilityLabel="Remove">
                        <SymbolView name="xmark" size={12} tintColor={theme.textSecondary} />
                      </Pressable>
                    </View>
                  ))}
                  {entries.length > 5 && (
                    <Pressable onPress={() => setShowAllMemories(!showAllMemories)} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel={showAllMemories ? 'Show less' : 'View all memories'}>
                      <ThemedText style={[styles.clearBtnText, { color: theme.primary }]}>
                        {showAllMemories ? 'Show less' : `View all ${entries.length} memories`}
                      </ThemedText>
                    </Pressable>
                  )}
                  <Pressable onPress={handleClearMemory} style={styles.clearBtn} accessibilityRole="button" accessibilityLabel="Clear all memory">
                    <ThemedText style={[styles.clearBtnText, { color: theme.textSecondary }]}>Clear all memory</ThemedText>
                  </Pressable>
                </>
              ) : (
                <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                  No memories yet. As you use Travonal, it will learn from your choices to give better recommendations.
                </ThemedText>
              )}
            </View>
          </Animated.View>
        )}

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
                        Alert.alert('Enable Notifications', 'Notifications are blocked. Open Settings to allow Travonal to send notifications.', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Open Settings', onPress: openNotificationSettings },
                        ]);
                      }
                      setNotificationsEnabled(granted);
                    } else {
                      openNotificationSettings();
                    }
                  }}
                  theme={theme}
                />
                <SettingToggle
                  label="Trip alerts"
                  sublabel="Smart alerts about your itinerary"
                  value={tripPulseLoaded ? tripPulseEnabled : false}
                  onToggle={tripPulseLoaded ? setTripPulseEnabled : () => {}}
                  theme={theme}
                />
              </View>
            </Animated.View>
          )}

          {/* Personalization & privacy */}
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowPrivacy(!showPrivacy); }}
            style={[styles.navRow, { borderBottomColor: theme.border }]}
            accessibilityRole="button"
          >
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.navLabel, { color: theme.textSecondary }]}>Personalization & privacy</ThemedText>
            </View>
            <ThemedText style={[styles.navChevron, { color: theme.textSecondary }]}>{showPrivacy ? '\u2212' : '\u203A'}</ThemedText>
          </Pressable>

          {showPrivacy && (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
              <View style={styles.subSection}>
                <SettingToggle
                  label="Personalization"
                  sublabel="Learn from your choices to improve suggestions"
                  value={learningEnabled}
                  onToggle={setLearningEnabled}
                  theme={theme}
                />
                <NavRow
                  label="Export my data"
                  sublabel="Share your trips and preferences"
                  onPress={handleExport}
                  theme={theme}
                />
                <NavRow
                  label="Reset preferences"
                  sublabel="Clear your travel profile and start over"
                  onPress={handleReset}
                  theme={theme}
                  destructive
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
                    <NavRow
                      label="Sign out"
                      onPress={() => {
                        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Sign Out', style: 'destructive', onPress: signOut },
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
                  <NavRow
                    label="Sign in"
                    sublabel="Sync your trips across devices"
                    onPress={() => router.push('/sign-in' as any)}
                    theme={theme}
                  />
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
            sublabel="Enjoying Travonal? Let us know!"
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
          Travonal v{Constants.expoConfig?.version ?? '1.0.0'}
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
    alignItems: 'center',
    gap: 14,
    marginBottom: 0,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  userEmail: {
    fontSize: 14,
    marginTop: 1,
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

  // Memory panel
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

  // Travonal Plus card
  plusGlow: {
    marginTop: 30,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.30,
    shadowRadius: 21,
    elevation: 11,
  },
  plusOuter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#1a1a1a',
    padding: 14,
    gap: 14,
  },
  plusIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIconText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  plusContent: {
    flex: 1,
    gap: 2,
  },
  plusTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  plusSub: {
    fontSize: 13,
    lineHeight: 18,
  },
  plusChevron: {
    fontSize: 24,
    fontWeight: '300',
    marginLeft: 4,
  },

  // About
  versionText: {
    fontSize: 13,
  },
});
