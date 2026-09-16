import { supabase } from './supabase';
import type { Trip } from '@/context/trips';
import type { TravelProfile } from '@/context/profile';

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
