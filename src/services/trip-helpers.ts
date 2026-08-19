/**
 * Pure helper functions used by TripsProvider and Trip screen.
 * Exported for direct testing.
 */

import { Trip, ChangeRecord, Activity } from '@/context/trips';

/** Create a new trip record with an auto-generated id, empty activities, and owner member. */
export function createTripRecord(
  input: Omit<Trip, 'id' | 'activities'>,
): Trip {
  const id = String(Date.now());
  return {
    ...input,
    id,
    activities: [],
    status: input.status ?? 'draft',
    members: [
      { id: id + '-owner', name: 'You', role: 'owner', joinedAt: new Date().toISOString() },
    ],
  };
}

/** Find the most recent undoable change for a trip.
 * Only the NEWEST (most recently recorded) change is offered for undo.
 * After it is undone, no older change is automatically surfaced. */
export function findUndoableChange(
  history: ChangeRecord[],
  tripId: string,
): ChangeRecord | undefined {
  // History is stored newest-first (prepended via [record, ...prev]).
  // Return the newest non-undone record for this trip.
  return history.find((c) => c.tripId === tripId && !c.undone);
}

/** Compute a short, stable hash of the current itinerary state.
 * Used to scope pulse dismissals so they expire when activities change. */
export function computeItineraryHash(activities: Activity[]): string {
  const str = activities
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => `${a.id}:${a.day}:${a.time}`)
    .join('|');
  let h = 0;
  for (const ch of str) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
}

/** Create the composite key used to scope pulse dismissals by trip and itinerary revision.
 * For empty_day alerts, use a stable key based on the day number (no revision) so dismissals
 * persist as long as the day remains empty. For all other alerts, use the revision counter
 * so dismissals expire when activities change. */
export function makePulseDismissalKey(tripId: string, alertId: string, revision: number): string {
  // empty_day alerts have alertId like "empty-3" — use stable key without revision
  if (alertId.startsWith('empty-')) {
    return `${tripId}:${alertId}:stable`;
  }
  return `${tripId}:${alertId}:rev${revision}`;
}

/** Check whether a pulse alert has been dismissed for a specific trip and itinerary revision. */
export function isPulseDismissed(
  dismissed: Set<string>,
  tripId: string,
  alertId: string,
  revision: number,
): boolean {
  return dismissed.has(makePulseDismissalKey(tripId, alertId, revision));
}

/**
 * Sort trips for use in pickers (trip selector sheets).
 * Order: destination-match (if hint provided) → Active → Upcoming/Planned → Draft → Past/Completed.
 * Within each group, trips are sorted by startDate ascending (soonest first).
 */
export function sortTripsForPicker(trips: Trip[], destinationHint?: string): Trip[] {
  // Use local date (not UTC) so the boundary doesn't shift mid-evening for non-UTC timezones
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  function realState(trip: Trip): 'active' | 'upcoming' | 'past' | 'draft' {
    if (trip.startDate <= today && trip.endDate >= today) return 'active';
    if (trip.startDate > today) return 'upcoming';
    if (trip.endDate < today && trip.status !== 'draft') return 'past';
    return 'draft';
  }

  function groupRank(trip: Trip): number {
    const state = realState(trip);
    if (state === 'active') return 1;
    if (state === 'upcoming') return 2;
    if (state === 'draft') return 3;
    return 4; // past
  }

  return trips.slice().sort((a, b) => {
    const rankA = groupRank(a);
    const rankB = groupRank(b);

    // Destination hint floats matching trip to front WITHIN its group
    const hint = destinationHint?.toLowerCase();
    const aMatch = hint ? a.destination.toLowerCase().includes(hint) : false;
    const bMatch = hint ? b.destination.toLowerCase().includes(hint) : false;

    if (rankA !== rankB) return rankA - rankB;

    // Within same group, destination match floats first
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;

    // Past trips: sort by startDate descending (newest first)
    if (rankA === 4) return b.startDate.localeCompare(a.startDate);

    // Other groups: sort by startDate ascending
    return a.startDate.localeCompare(b.startDate);
  });
}

/** Serialize a TravelProfile for AsyncStorage (round-trip safe). */
export function serializeProfile<T>(profile: T): string {
  return JSON.stringify(profile);
}

/** Deserialize a TravelProfile from AsyncStorage. */
export function deserializeProfile<T>(json: string): T {
  return JSON.parse(json);
}

const CITY_TO_COUNTRY: Record<string, string> = {
  'paris': 'France',
  'london': 'United Kingdom',
  'new york': 'United States',
  'nyc': 'United States',
  'tokyo': 'Japan',
  'rome': 'Italy',
  'barcelona': 'Spain',
  'madrid': 'Spain',
  'amsterdam': 'Netherlands',
  'berlin': 'Germany',
  'prague': 'Czech Republic',
  'vienna': 'Austria',
  'lisbon': 'Portugal',
  'dubai': 'United Arab Emirates',
  'sydney': 'Australia',
  'melbourne': 'Australia',
  'bangkok': 'Thailand',
  'bali': 'Indonesia',
  'singapore': 'Singapore',
  'hong kong': 'China',
  'seoul': 'South Korea',
  'istanbul': 'Turkey',
  'athens': 'Greece',
  'santorini': 'Greece',
  'mykonos': 'Greece',
  'florence': 'Italy',
  'venice': 'Italy',
  'milan': 'Italy',
  'naples': 'Italy',
  'amalfi': 'Italy',
  'zurich': 'Switzerland',
  'geneva': 'Switzerland',
  'oslo': 'Norway',
  'stockholm': 'Sweden',
  'copenhagen': 'Denmark',
  'helsinki': 'Finland',
  'reykjavik': 'Iceland',
  'edinburgh': 'United Kingdom',
  'dublin': 'Ireland',
  'brussels': 'Belgium',
  'budapest': 'Hungary',
  'warsaw': 'Poland',
  'cracow': 'Poland',
  'krakow': 'Poland',
  'bucharest': 'Romania',
  'sofia': 'Bulgaria',
  'zagreb': 'Croatia',
  'dubrovnik': 'Croatia',
  'split': 'Croatia',
  'cairo': 'Egypt',
  'marrakech': 'Morocco',
  'casablanca': 'Morocco',
  'nairobi': 'Kenya',
  'cape town': 'South Africa',
  'johannesburg': 'South Africa',
  'mumbai': 'India',
  'delhi': 'India',
  'new delhi': 'India',
  'jaipur': 'India',
  'goa': 'India',
  'beijing': 'China',
  'shanghai': 'China',
  'kyoto': 'Japan',
  'osaka': 'Japan',
  'phuket': 'Thailand',
  'chiang mai': 'Thailand',
  'hanoi': 'Vietnam',
  'ho chi minh': 'Vietnam',
  'saigon': 'Vietnam',
  'kuala lumpur': 'Malaysia',
  'manila': 'Philippines',
  'jakarta': 'Indonesia',
  'colombo': 'Sri Lanka',
  'kathmandu': 'Nepal',
  'los angeles': 'United States',
  'san francisco': 'United States',
  'chicago': 'United States',
  'miami': 'United States',
  'las vegas': 'United States',
  'hawaii': 'United States',
  'honolulu': 'United States',
  'boston': 'United States',
  'seattle': 'United States',
  'toronto': 'Canada',
  'vancouver': 'Canada',
  'montreal': 'Canada',
  'mexico city': 'Mexico',
  'cancun': 'Mexico',
  'rio de janeiro': 'Brazil',
  'são paulo': 'Brazil',
  'sao paulo': 'Brazil',
  'buenos aires': 'Argentina',
  'lima': 'Peru',
  'bogota': 'Colombia',
};

/**
 * Resolve a destination string to a country name.
 * Returns null if the destination is not recognised.
 */
export function resolveCountry(destination: string): string | null {
  if (!destination) return null;
  const lower = destination.toLowerCase().trim();
  // Exact match first
  if (CITY_TO_COUNTRY[lower]) return CITY_TO_COUNTRY[lower];
  // Word-boundary match — check if the destination contains any known city name
  // as a whole word (not a substring inside a longer word).
  for (const [city, country] of Object.entries(CITY_TO_COUNTRY)) {
    if (city.length >= 4) {
      const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`).test(lower)) return country;
    }
  }
  return null;
}
