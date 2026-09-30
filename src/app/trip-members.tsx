import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTrips, type Invitation, type TripMember } from '@/context/trips';
import { useGate } from '@/hooks/use-gate';
import { useSubscription } from '@/context/subscription';

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', member: 'Can edit', viewer: 'View only' };

export default function TripMembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const { trips, addInvitation, removeInvitation, removeMember, updateMemberRole } = useTrips();
  const inviteGate = useGate('invite_member');
  const { isPlus } = useSubscription();

  const trip = trips.find((t) => t.id === tripId);
  if (!trip) return null;

  const members = trip.members ?? [];
  const invitations = (trip.invitations ?? []).filter((i) => i.status !== 'declined');
  // Find or create a pending invite code for sharing
  const pendingInvite = invitations.find((i) => i.status === 'pending');
  const inviteCode = pendingInvite?.inviteCode;

  function handleGenerateInvite() {
    if (!inviteGate.allowed) {
      inviteGate.showUpgrade();
      return;
    }
    addInvitation(tripId, { status: 'pending', role: 'member' });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleCopyCode() {
    if (!inviteCode) return;
    Clipboard.setStringAsync(inviteCode);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function handleShareInvite() {
    if (!inviteCode || !trip) return;
    const tripName = trip.title ?? trip.destination;
    Share.share({
      message: `Join my trip "${tripName}" on Tripseek!\n\nEnter this code in the app:\n${inviteCode}\n\nOr tap: toveli://join?code=${inviteCode}`,
    });
  }

  function handleRemoveMember(member: TripMember) {
    if (member.role === 'owner') return;
    Alert.alert(
      'Remove member?',
      `Remove ${member.name} from this trip?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeMember(tripId, member.id) },
      ],
    );
  }

  function handleRevokeInvite(inv: Invitation) {
    Alert.alert('Revoke invite?', 'This invite code will no longer work.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => removeInvitation(tripId, inv.id) },
    ]);
  }

  function handleToggleRole(member: TripMember) {
    if (member.role === 'owner') return;
    const newRole = member.role === 'member' ? 'viewer' : 'member';
    updateMemberRole(tripId, member.id, newRole);
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

        {/* Invite code section */}
        {isPlus ? (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <SymbolView name="link" size={16} tintColor={theme.primary} />
              <ThemedText style={styles.cardTitle}>Invite someone</ThemedText>
            </View>

            {inviteCode ? (
              <>
                <View style={[styles.codeBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <ThemedText style={[styles.codeText, { color: theme.text }]}>{inviteCode}</ThemedText>
                  <Pressable onPress={handleCopyCode} hitSlop={8} style={styles.copyBtn}>
                    <SymbolView name="doc.on.doc" size={16} tintColor={theme.primary} />
                  </Pressable>
                </View>
                <ThemedText style={[styles.codeHint, { color: theme.textSecondary }]}>
                  Share this code — anyone with it can join as a member
                </ThemedText>
                <View style={styles.inviteActions}>
                  <Pressable
                    onPress={handleShareInvite}
                    style={[styles.shareBtn, { backgroundColor: theme.primary }]}
                  >
                    <SymbolView name="square.and.arrow.up" size={15} tintColor="#fff" />
                    <ThemedText style={styles.shareBtnText}>Share invite</ThemedText>
                  </Pressable>
                  {pendingInvite && (
                    <Pressable onPress={() => handleRevokeInvite(pendingInvite)} style={styles.revokeBtn} hitSlop={8}>
                      <ThemedText style={[styles.revokeBtnText, { color: theme.danger ?? '#FF3B30' }]}>Revoke</ThemedText>
                    </Pressable>
                  )}
                </View>
              </>
            ) : (
              <Pressable
                onPress={handleGenerateInvite}
                style={[styles.generateBtn, { backgroundColor: theme.primary }]}
              >
                <SymbolView name="plus" size={15} tintColor="#fff" />
                <ThemedText style={styles.generateBtnText}>Generate invite code</ThemedText>
              </Pressable>
            )}
          </View>
        ) : (
          <Pressable
            onPress={() => inviteGate.showUpgrade()}
            style={[styles.card, styles.lockedCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          >
            <View style={[styles.plusBadge, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.plusBadgeText}>Plus</ThemedText>
            </View>
            <SymbolView name="person.2" size={28} tintColor={theme.textSecondary} />
            <ThemedText style={[styles.lockedTitle, { color: theme.text }]}>Invite travel companions</ThemedText>
            <ThemedText style={[styles.lockedDesc, { color: theme.textSecondary }]}>
              Share your trip and plan together. Upgrade to Tripseek+ to invite others.
            </ThemedText>
            <View style={[styles.upgradeBtn, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.upgradeBtnText}>Upgrade to Plus</ThemedText>
            </View>
          </Pressable>
        )}

        {/* Members list */}
        {members.length > 0 && (
          <View style={styles.section}>
            <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>Members</ThemedText>
            {members.map((member, i) => (
              <Animated.View key={member.id} entering={FadeInDown.delay(i * 40).springify()}>
                <View style={[styles.memberRow, { borderBottomColor: theme.border }]}>
                  <View style={[styles.memberAvatar, { backgroundColor: theme.primaryMuted }]}>
                    <ThemedText style={[styles.memberInitial, { color: theme.primary }]}>
                      {(member.name || '?')[0].toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.memberInfo}>
                    <ThemedText style={styles.memberName}>{member.name || 'Unnamed'}</ThemedText>
                    <ThemedText style={[styles.memberRole, { color: theme.textSecondary }]}>
                      {ROLE_LABELS[member.role] ?? member.role}
                    </ThemedText>
                  </View>
                  {member.role !== 'owner' && (
                    <View style={styles.memberActions}>
                      <Pressable onPress={() => handleToggleRole(member)} hitSlop={8} style={styles.memberActionBtn}>
                        <SymbolView name="arrow.left.arrow.right" size={14} tintColor={theme.textSecondary} />
                      </Pressable>
                      <Pressable onPress={() => handleRemoveMember(member)} hitSlop={8} style={styles.memberActionBtn}>
                        <SymbolView name="xmark" size={14} tintColor={theme.danger ?? '#FF3B30'} />
                      </Pressable>
                    </View>
                  )}
                </View>
              </Animated.View>
            ))}
          </View>
        )}

        {/* Pending invitations (if any beyond the active code) */}
        {invitations.filter((i) => i.status === 'pending' && i.inviteCode).length > 0 && members.length === 0 && (
          <ThemedText style={[styles.pendingHint, { color: theme.textSecondary }]}>
            Invite code generated — share it with your travel companions.
          </ThemedText>
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

  content: { padding: Spacing.four, gap: 20 },

  card: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700' },

  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  codeText: { fontSize: 20, fontWeight: '700', letterSpacing: 2, fontFamily: 'ui-monospace' },
  copyBtn: { padding: 4 },
  codeHint: { fontSize: 13, lineHeight: 18 },

  inviteActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  shareBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  revokeBtn: { paddingVertical: 8 },
  revokeBtnText: { fontSize: 14, fontWeight: '500' },

  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: Radius.sm,
  },
  generateBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Locked state (free users)
  lockedCard: { alignItems: 'center', paddingVertical: 28, gap: 10, position: 'relative' },
  plusBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  plusBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  lockedTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  lockedDesc: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 },
  upgradeBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: Radius.sm, marginTop: 4 },
  upgradeBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // Members list
  section: { gap: 0 },
  sectionLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: { fontSize: 16, fontWeight: '700' },
  memberInfo: { flex: 1, gap: 2 },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberRole: { fontSize: 13 },
  memberActions: { flexDirection: 'row', gap: 8 },
  memberActionBtn: { padding: 4 },

  pendingHint: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
