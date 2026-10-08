import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Image } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTrips, type Invitation, type TripMember } from '@/context/trips';
import { registerInviteCode, fetchTripAllParticipants, fetchUserIdentities, type UserIdentity } from '@/services/sync';
import { useProfile } from '@/context/profile';
import { useAuth } from '@/context/auth';
import { useGate } from '@/hooks/use-gate';

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', member: 'Can edit', viewer: 'View only' };

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TripMembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const { trips, addInvitation, removeInvitation, removeMember, updateMemberRole, leaveSharedTrip } = useTrips();
  const { profile } = useProfile();
  const { user } = useAuth();
  const inviteGate = useGate('invite_member');

  const trip = trips.find((t) => t.id === tripId);
  const inviteCode = trip?.invitations?.find((i) => i.status === 'pending')?.inviteCode;

  const [participants, setParticipants] = useState<Array<{ userId: string; role: string }>>([]);
  const [identities, setIdentities] = useState<Map<string, UserIdentity>>(() => {
    // Seed with the current user's own identity immediately — no network needed
    const map = new Map<string, UserIdentity>();
    return map;
  });

  // Build current user's identity from local profile — used as instant fallback
  const authName = (user?.user_metadata?.full_name as string | undefined)
    ?? user?.email?.split('@')[0]?.replace(/[._-]+/g, ' ') ?? '';
  const selfIdentity: UserIdentity | null = user?.id ? {
    userId: user.id,
    displayName: profile.displayName || authName || undefined,
    username: profile.username || undefined,
    avatarUrl: profile.avatarUri || undefined, // local URI is fine on own device
  } : null;

  // Always include the current user as a participant immediately
  const currentUserRole = trip?.joinedAs ?? 'owner';
  const selfParticipant = user?.id ? { userId: user.id, role: currentUserRole } : null;

  useEffect(() => {
    if (inviteCode) {
      registerInviteCode(tripId, inviteCode, 'member').catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode]);

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    fetchTripAllParticipants(tripId).then(async (rows) => {
      if (cancelled) return;
      setParticipants(rows);
      const otherIds = rows.map((r) => r.userId).filter((id) => id !== user?.id);
      const map = await fetchUserIdentities(otherIds);
      // Always override current user's identity with local profile (includes local avatarUri)
      if (user?.id && selfIdentity) map.set(user.id, selfIdentity);
      if (!cancelled) setIdentities(map);
    }).catch(() => {
      // Even if fetch fails, show at least the current user
    });
    return () => { cancelled = true; };
  }, [tripId, user?.id]);

  if (!trip) return null;

  const members = trip.members ?? [];
  const invitations = (trip.invitations ?? []).filter((i) => i.status !== 'declined');
  const pendingInvite = invitations.find((i) => i.status === 'pending');

  const totalDays = (() => {
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  })();

  async function handleShareInvite() {
    if (!trip) return;
    if (!inviteGate.allowed) { inviteGate.showUpgrade(); return; }
    let code = inviteCode;
    if (!code) {
      code = addInvitation(tripId, { status: 'pending', role: 'member' });
      registerInviteCode(tripId, code, 'member').catch(() => {});
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const tripName = trip.title ?? trip.destination;
    Share.share({
      message: `Join my trip "${tripName}" on Tripseek!\n\nhttps://tripseekapp.com/join/${code}`,
    });
  }

  function handleRevokeInvite(inv: Invitation) {
    Alert.alert('Revoke invite?', 'This invite link will no longer work.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => removeInvitation(tripId, inv.id) },
    ]);
  }

  function handleRemoveMember(member: TripMember) {
    if (member.role === 'owner') return;
    Alert.alert('Remove member?', `Remove ${member.name} from this trip?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeMember(tripId, member.id) },
    ]);
  }

  function handleToggleRole(member: TripMember) {
    if (member.role === 'owner') return;
    updateMemberRole(tripId, member.id, member.role === 'member' ? 'viewer' : 'member');
  }

  function handleLeaveTrip() {
    Alert.alert(
      'Leave trip?',
      `You'll be removed from "${trip.title ?? trip.destination}". You can rejoin with a new invite link.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => { leaveSharedTrip(tripId).catch(() => {}); router.back(); } },
      ],
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <View style={styles.headerSpacer} />
        <ThemedText style={styles.headerTitle}>Trip members</ThemedText>
        <Pressable onPress={() => router.back()} style={[styles.headerSpacer, { alignItems: 'flex-end' }]} hitSlop={12}>
          <SymbolView name="xmark" size={18} tintColor={theme.textSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.tripInfo}>
          <ThemedText style={styles.tripTitle}>Share your trip and{'\n'}plan it together.</ThemedText>
          <ThemedText style={[styles.tripDesc, { color: theme.textSecondary }]}>
            Invite friends and family to view and edit this trip together.
          </ThemedText>
        </View>

        {/* Visual */}
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('@/assets/images/onboarding-slide-5.png')}
          style={styles.slideImage}
          contentFit="contain"
        />

        {/* Share button */}
        {!trip.joinedAs && (
          <View style={styles.shareSection}>
            <Pressable onPress={handleShareInvite} style={[styles.shareBtn, { backgroundColor: theme.primary }]}>
              <SymbolView name="square.and.arrow.up" size={16} tintColor="#fff" />
              <ThemedText style={styles.shareBtnText}>Share invite link</ThemedText>
            </Pressable>
            {pendingInvite && (
              <Pressable onPress={() => handleRevokeInvite(pendingInvite)} hitSlop={8}>
                <ThemedText style={[styles.revokeText, { color: theme.textSecondary }]}>Revoke invite link</ThemedText>
              </Pressable>
            )}
          </View>
        )}

        {/* Members — always shown, seeded with current user instantly */}
        {(() => {
          const allParticipants = selfParticipant
            ? [selfParticipant, ...participants.filter((p) => p.userId !== selfParticipant.userId)]
            : participants;
          const displayIdentities = new Map(identities);
          if (selfParticipant && selfIdentity) displayIdentities.set(selfParticipant.userId, selfIdentity);
          return (
            <View style={styles.section}>
              <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>Members</ThemedText>
              <View style={[styles.membersCard, { borderColor: theme.border }]}>
                {allParticipants.map((p, i) => {
                  const identity = displayIdentities.get(p.userId);
                  const displayName = identity?.displayName ?? (p.role === 'owner' ? 'Owner' : 'Member');
                  const username = identity?.username;
                  const avatarUrl = identity?.avatarUrl;
                  const initial = (displayName[0] ?? '?').toUpperCase();
                  const membersByRole = members.filter((m) => m.role === p.role);
                  const roleIndex = allParticipants.filter((x) => x.role === p.role).indexOf(p);
                  const tripMember = membersByRole[roleIndex];
                  return (
                    <Animated.View key={p.userId} entering={FadeInDown.delay(i * 40).springify()}>
                      <View style={[styles.memberRow, { borderBottomColor: theme.border }, i === allParticipants.length - 1 && { borderBottomWidth: 0 }]}>
                        {avatarUrl ? (
                          <Image source={{ uri: avatarUrl }} style={styles.memberAvatar} contentFit="cover" />
                        ) : (
                          <View style={[styles.memberAvatar, { backgroundColor: theme.primaryMuted, alignItems: 'center', justifyContent: 'center' }]}>
                            <ThemedText style={[styles.memberInitial, { color: theme.primary }]}>{initial}</ThemedText>
                          </View>
                        )}
                        <View style={styles.memberInfo}>
                          <ThemedText style={styles.memberName}>{displayName}</ThemedText>
                          <ThemedText style={[styles.memberRole, { color: theme.textSecondary }]}>
                            {username ? `@${username} · ` : ''}{ROLE_LABELS[p.role] ?? p.role}
                          </ThemedText>
                        </View>
                        {p.role !== 'owner' && tripMember && (
                          <View style={styles.memberActions}>
                            <Pressable onPress={() => handleToggleRole(tripMember)} hitSlop={8} style={styles.memberActionBtn}>
                              <SymbolView name="arrow.left.arrow.right" size={14} tintColor={theme.textSecondary} />
                            </Pressable>
                            <Pressable onPress={() => handleRemoveMember(tripMember)} hitSlop={8} style={styles.memberActionBtn}>
                              <SymbolView name="xmark" size={14} tintColor={theme.danger ?? '#FF3B30'} />
                            </Pressable>
                          </View>
                        )}
                      </View>
                    </Animated.View>
                  );
                })}
              </View>
            </View>
          );
        })()}

        {/* Leave trip */}
        {trip.joinedAs && (
          <Pressable onPress={handleLeaveTrip} style={[styles.leaveBtn, { borderColor: theme.danger ?? '#FF3B30' }]}>
            <SymbolView name="rectangle.portrait.and.arrow.right" size={16} tintColor={theme.danger ?? '#FF3B30'} />
            <ThemedText style={[styles.leaveBtnText, { color: theme.danger ?? '#FF3B30' }]}>Leave trip</ThemedText>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  headerSpacer: { width: 64 },

  content: { padding: Spacing.four, gap: 24 },

  tripInfo: { gap: 8, alignItems: 'center' },
  tripTitle: { fontSize: 24, fontWeight: '800', lineHeight: 30, textAlign: 'center' },
  tripDesc: { fontSize: 15, lineHeight: 22, textAlign: 'center' },

  slideImage: {
    width: '100%',
    height: 220,
  },

  shareSection: { gap: 10, alignItems: 'center' },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Radius.md,
    width: '100%',
  },
  shareBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  revokeText: { fontSize: 13 },

  section: { gap: 10 },
  sectionLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  membersCard: { borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontSize: 15, fontWeight: '700' },
  memberInfo: { flex: 1, gap: 2 },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberRole: { fontSize: 13 },
  memberActions: { flexDirection: 'row', gap: 8 },
  memberActionBtn: { padding: 4 },

  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: Radius.sm, borderWidth: 1,
  },
  leaveBtnText: { fontSize: 15, fontWeight: '600' },
});
