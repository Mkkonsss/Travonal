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
 * Searches across all trips (relies on Supabase RLS allowing code-based access).
 */
export async function findTripByInviteCode(inviteCode: string): Promise<Trip | null> {
  const code = inviteCode.toUpperCase().trim();
  // JSONB contains query: find trips whose invitations array has an entry with this code
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
