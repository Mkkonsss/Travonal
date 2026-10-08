import { supabase } from './supabase';
import type { Trip } from '@/context/trips';
import type { TravelProfile } from '@/context/profile';
import type { TravelMemoryEntry } from '@/context/memory';
import type { Board } from '@/context/boards';
import type { InboxItem } from '@/context/inbox';
import type { Reservation } from '@/context/trips';
import type { PulseHistoryEntry } from '@/services/storage';

export interface ChatThread {
  id: string;
  title: string;
  messages: unknown[];
  updatedAt: number;
  pinned?: boolean;
}

// ─── Trips ────────────────────────────────────────────────────────────────────

export async function pushTrips(userId: string, trips: Trip[]): Promise<void> {
  if (!userId || trips.length === 0) return;
  const rows = trips.map((t) => ({
    id: t.id,
    user_id: userId,
    data: t,
    updated_at: new Date().toISOString(),
  }));
  console.log(`[sync] pushing ${trips.length} trip(s) for user ${userId}`);
  const { error } = await supabase.from('trips').upsert(rows, { onConflict: 'id' });
  if (error) console.warn('[sync] pushTrips failed:', error.message);
  else console.log('[sync] pushTrips ok');
}

export async function pullTrips(userId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('data')
    .eq('user_id', userId);
  if (error) {
    console.warn('[sync] pullTrips failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => row.data as Trip);
}

export async function deleteRemoteTrip(tripId: string): Promise<void> {
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  if (error) console.warn('[sync] deleteRemoteTrip failed:', error.message);
}

/**
 * Find a trip by its invite code.
 * Checks the trip_members table first, falls back to legacy JSONB scan.
 */
export async function findTripByInviteCode(inviteCode: string): Promise<Trip | null> {
  const code = inviteCode.toUpperCase().trim();

  // New path: look up in trip_members (works for codes registered via registerInviteCode)
  const { data: member } = await supabase
    .from('trip_members')
    .select('trip_id')
    .eq('invite_code', code)
    .maybeSingle();

  if (member?.trip_id) {
    const { data: tripRow, error: tripErr } = await supabase
      .from('trips')
      .select('data')
      .eq('id', member.trip_id)
      .single();
    if (!tripErr && tripRow) return tripRow.data as Trip;
  }

  // Legacy path: JSONB contains query (for codes not yet registered in trip_members)
  const { data, error } = await supabase
    .from('trips')
    .select('data')
    .filter('data->invitations', 'cs', JSON.stringify([{ inviteCode: code }]))
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    console.warn('[sync] findTripByInviteCode failed:', error?.message);
    return null;
  }
  return data.data as Trip;
}

/**
 * Register an invite code in Supabase so other users can look it up.
 * Called after a code is generated locally in trip-members screen.
 */
export async function registerInviteCode(
  tripId: string,
  code: string,
  role: 'member' | 'viewer' = 'member',
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('trip_members').upsert(
    { trip_id: tripId, role, invite_code: code.toUpperCase().trim(), invited_by: user.id },
    { onConflict: 'invite_code', ignoreDuplicates: true },
  );
  if (error) console.warn('[sync] registerInviteCode failed:', error.message);
}

/**
 * Claim an invite code — associates the current user with the trip membership row.
 * Call this when the user taps "Join" after previewing a trip.
 */
export async function claimInviteCode(code: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('trip_members')
    .update({ user_id: user.id, joined_at: new Date().toISOString() })
    .eq('invite_code', code.toUpperCase().trim())
    .is('user_id', null);
  if (error) console.warn('[sync] claimInviteCode failed:', error.message);
}

/**
 * Fetch trips shared with the current user (they are a member, not the owner).
 * Returns trips with the role the user has on each.
 */
export async function pullSharedTrips(userId: string): Promise<Array<{ trip: Trip; role: 'member' | 'viewer' }>> {
  const { data: memberships, error: memberErr } = await supabase
    .from('trip_members')
    .select('trip_id, role')
    .eq('user_id', userId);
  if (memberErr || !memberships?.length) return [];
  const roleMap = new Map(memberships.map((m: { trip_id: string; role: string }) => [m.trip_id, m.role as 'member' | 'viewer']));
  const tripIds = [...roleMap.keys()];
  const { data, error } = await supabase
    .from('trips')
    .select('data')
    .in('id', tripIds);
  if (error) {
    console.warn('[sync] pullSharedTrips failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const trip = row.data as Trip;
    return { trip, role: roleMap.get(trip.id) ?? 'member' };
  });
}

/**
 * Look up the role granted by an invite code.
 * Used in the join flow so the local trip copy stores the correct joinedAs role.
 */
export async function getRoleForInviteCode(code: string): Promise<'member' | 'viewer'> {
  const { data } = await supabase
    .from('trip_members')
    .select('role')
    .eq('invite_code', code.toUpperCase().trim())
    .maybeSingle();
  return (data?.role as 'member' | 'viewer') ?? 'member';
}

/**
 * Remove the current user from a shared trip's trip_members row.
 * Call this when a member wants to leave a trip they joined.
 */
export async function leaveSharedTrip(tripId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('trip_members')
    .delete()
    .eq('trip_id', tripId)
    .eq('user_id', user.id);
  if (error) console.warn('[sync] leaveSharedTrip failed:', error.message);
}

/**
 * Subscribe to real-time updates on a set of shared trip IDs.
 * Calls onUpdate whenever the owner pushes a new version.
 * Returns an unsubscribe function.
 */
export function subscribeToSharedTrips(
  tripIds: string[],
  onUpdate: (trip: Trip) => void,
): () => void {
  if (tripIds.length === 0) return () => {};
  const channel = supabase
    .channel('shared-trips-' + tripIds.slice(0, 3).join('-'))
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'trips',
        filter: `id=in.(${tripIds.join(',')})`,
      },
      (payload) => {
        const data = (payload.new as { data?: Trip }).data;
        if (data) onUpdate(data);
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/**
 * Push a member's edits to a shared trip's canonical Supabase row.
 * Uses UPDATE (not upsert) so the owner's user_id column is never overwritten.
 * Strips joinedAs before writing — it's a local-only annotation.
 */
export async function pushSharedTripData(tripId: string, trip: Trip): Promise<void> {
  const { joinedAs: _ja, ...tripData } = trip;
  const { error } = await supabase
    .from('trips')
    .update({ data: tripData, updated_at: new Date().toISOString() })
    .eq('id', tripId);
  if (error) console.warn('[sync] pushSharedTripData failed:', error.message);
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function pushProfile(userId: string, profile: TravelProfile): Promise<boolean> {
  console.log(`[sync] pushing profile for user ${userId}`);
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    travel_profile: profile,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('[sync] pushProfile failed:', error.message);
    return false;
  }
  console.log('[sync] pushProfile ok');
  return true;
}

export async function pullProfile(userId: string): Promise<{ profile: TravelProfile; updatedAt: string } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('travel_profile, updated_at')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return { profile: data.travel_profile as TravelProfile, updatedAt: data.updated_at as string };
}

// ─── User Identities ─────────────────────────────────────────────────────────

export interface UserIdentity {
  userId: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string; // https:// only — never a local file URI
}

/**
 * Upsert the current user's public identity (name, username, avatar).
 * Local file:// URIs are silently dropped — only https:// URLs are stored.
 */
export async function pushPublicIdentity(
  userId: string,
  identity: Pick<UserIdentity, 'displayName' | 'username' | 'avatarUrl'>,
): Promise<void> {
  const { error } = await supabase.from('user_identities').upsert(
    {
      user_id: userId,
      display_name: identity.displayName ?? null,
      username: identity.username ?? null,
      avatar_url: identity.avatarUrl?.startsWith('https://') ? identity.avatarUrl : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) console.warn('[sync] pushPublicIdentity failed:', error.message);
}

/** Fetch a single user's public identity by their user_id. */
export async function fetchUserIdentity(userId: string): Promise<UserIdentity | null> {
  const { data, error } = await supabase
    .from('user_identities')
    .select('user_id, display_name, username, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    userId: data.user_id as string,
    displayName: (data.display_name as string | null) ?? undefined,
    username: (data.username as string | null) ?? undefined,
    avatarUrl: (data.avatar_url as string | null) ?? undefined,
  };
}

/** Batch-fetch identities for multiple user_ids. Returns a map keyed by userId. */
export async function fetchUserIdentities(userIds: string[]): Promise<Map<string, UserIdentity>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('user_identities')
    .select('user_id, display_name, username, avatar_url')
    .in('user_id', userIds);
  if (error) {
    console.warn('[sync] fetchUserIdentities failed:', error.message);
    return new Map();
  }
  const map = new Map<string, UserIdentity>();
  for (const row of data ?? []) {
    map.set(row.user_id as string, {
      userId: row.user_id as string,
      displayName: (row.display_name as string | null) ?? undefined,
      username: (row.username as string | null) ?? undefined,
      avatarUrl: (row.avatar_url as string | null) ?? undefined,
    });
  }
  return map;
}

/**
 * Fetch all participants of a trip: the owner (from trips table) + joined members (from trip_members).
 * Owner is always first in the returned array.
 */
export async function fetchTripAllParticipants(
  tripId: string,
): Promise<Array<{ userId: string; role: string }>> {
  const [ownerResult, membersResult] = await Promise.all([
    supabase.from('trips').select('user_id').eq('id', tripId).maybeSingle(),
    supabase.from('trip_members').select('user_id, role').eq('trip_id', tripId).not('user_id', 'is', null),
  ]);
  const results: Array<{ userId: string; role: string }> = [];
  if (ownerResult.data?.user_id) {
    results.push({ userId: ownerResult.data.user_id as string, role: 'owner' });
  }
  for (const row of membersResult.data ?? []) {
    results.push({ userId: row.user_id as string, role: row.role as string });
  }
  return results;
}

/**
 * Fetch the identity of the user who created an invite code (the trip owner).
 * Returns null if the code doesn't exist or invited_by is not set.
 */
export async function fetchOwnerIdentityForCode(code: string): Promise<UserIdentity | null> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('invited_by')
    .eq('invite_code', code.toUpperCase().trim())
    .maybeSingle();
  if (error || !data?.invited_by) return null;
  return fetchUserIdentity(data.invited_by as string);
}

// ─── Memory ─────────────────────────────────────────────────────────────────

export async function pushMemory(userId: string, entries: TravelMemoryEntry[]): Promise<boolean> {
  console.log(`[sync] pushing ${entries.length} memory entries for user ${userId}`);
  const { error } = await supabase.from('memory').upsert({
    id: userId,
    entries,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.warn('[sync] pushMemory failed:', error.message);
    return false;
  }
  console.log('[sync] pushMemory ok');
  return true;
}

export async function pullMemory(userId: string): Promise<TravelMemoryEntry[] | null> {
  const { data, error } = await supabase
    .from('memory')
    .select('entries')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return (data.entries as TravelMemoryEntry[]) ?? [];
}

// ─── Boards ──────────────────────────────────────────────────────────────────

export async function pushBoards(userId: string, boards: Board[]): Promise<void> {
  const { error } = await supabase.from('user_boards').upsert({
    user_id: userId,
    data: boards,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) console.warn('[sync] pushBoards failed:', error.message);
}

export async function pullBoards(userId: string): Promise<Board[] | null> {
  const { data, error } = await supabase
    .from('user_boards')
    .select('data')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return (data.data as Board[]) ?? [];
}

// ─── Saved Places (Inbox) ────────────────────────────────────────────────────

export async function pushSavedPlaces(userId: string, items: InboxItem[]): Promise<void> {
  const { error } = await supabase.from('user_saved_places').upsert({
    user_id: userId,
    data: items,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) console.warn('[sync] pushSavedPlaces failed:', error.message);
}

export async function pullSavedPlaces(userId: string): Promise<InboxItem[] | null> {
  const { data, error } = await supabase
    .from('user_saved_places')
    .select('data')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return (data.data as InboxItem[]) ?? [];
}

// ─── Standalone Bookings ─────────────────────────────────────────────────────

export async function pushStandaloneBookings(userId: string, bookings: Reservation[]): Promise<void> {
  const { error } = await supabase.from('user_standalone_bookings').upsert({
    user_id: userId,
    data: bookings,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) console.warn('[sync] pushStandaloneBookings failed:', error.message);
}

export async function pullStandaloneBookings(userId: string): Promise<Reservation[] | null> {
  const { data, error } = await supabase
    .from('user_standalone_bookings')
    .select('data')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return (data.data as Reservation[]) ?? [];
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export async function pushChatThreads(userId: string, threads: ChatThread[]): Promise<void> {
  const { error } = await supabase.from('user_chat').upsert({
    user_id: userId,
    threads,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) console.warn('[sync] pushChatThreads failed:', error.message);
}

export async function pullChatThreads(userId: string): Promise<ChatThread[] | null> {
  const { data, error } = await supabase
    .from('user_chat')
    .select('threads')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return (data.threads as ChatThread[]) ?? [];
}

// ─── User Settings (merge-patch JSONB) ───────────────────────────────────────

export async function mergeUserSettings(userId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc('merge_user_settings', {
    p_user_id: userId,
    p_patch: patch,
  });
  if (error) console.warn('[sync] mergeUserSettings failed:', error.message);
}

export async function pullUserSettings(userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('data')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return data.data as Record<string, unknown>;
}

// ─── Pulse History ────────────────────────────────────────────────────────────

export async function pushPulseHistory(userId: string, entries: PulseHistoryEntry[]): Promise<void> {
  const { error } = await supabase.from('user_pulse_history').upsert({
    user_id: userId,
    data: entries,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) console.warn('[sync] pushPulseHistory failed:', error.message);
}

export async function pullPulseHistory(userId: string): Promise<PulseHistoryEntry[] | null> {
  const { data, error } = await supabase
    .from('user_pulse_history')
    .select('data')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return (data.data as PulseHistoryEntry[]) ?? [];
}

// ─── Trip Edit Chats ──────────────────────────────────────────────────────────

export async function mergeTripChat(userId: string, tripId: string, threads: unknown[]): Promise<void> {
  const { error } = await supabase.rpc('merge_user_trip_chat', {
    p_user_id: userId,
    p_trip_id: tripId,
    p_threads: threads,
  });
  if (error) console.warn('[sync] mergeTripChat failed:', error.message);
}

export async function pullTripChats(userId: string): Promise<Record<string, unknown[]> | null> {
  const { data, error } = await supabase
    .from('user_trip_chats')
    .select('chats')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return data.chats as Record<string, unknown[]>;
}
