/**
 * Explore service — fetches places for the Explore tab using Google Places API.
 *
 * All Google API calls go through the Supabase Edge Function (ai-travonal)
 * so the API key stays server-side. Results include ratings, photos, hours,
 * and editorial summaries.
 */

import { NormalizedPlace, normalizeGooglePlace, mapGoogleTypeToCategory } from './place-model';
import { searchPlace as photonSearch } from './geocoder';

export type ExploreLocation =
  | { type: 'current'; lat: number; lng: number; label: string }
  | { type: 'trip'; tripId: string; destination: string; label: string; lat?: number; lng?: number }
  | { type: 'custom'; query: string; label: string; lat?: number; lng?: number };

export const CATEGORY_QUERIES: Record<string, { label: string; keyword: string; multiQuery?: string[] }> = {
  'for_you': { label: 'For You', keyword: 'best places to visit', multiQuery: ['best places to visit', 'popular cafes', 'top attractions', 'boutique hotels'] },
  'stays': { label: 'Stays', keyword: 'best rated hotels', multiQuery: ['best rated hotels', 'boutique hotels', 'resorts', 'bed and breakfast guest house', 'vacation rentals villas'] },
  'restaurants': { label: 'Restaurants', keyword: 'restaurants' },
  'cafes': { label: 'Cafes', keyword: 'cafes' },
  'things_to_do': { label: 'Things to do', keyword: 'things to do' },
  'nightlife': { label: 'Nightlife', keyword: 'bars nightlife' },
  'shopping': { label: 'Shopping', keyword: 'shopping' },
};

/** Deduplicate places by placeId */
export function dedupeByPlaceId(places: NormalizedPlace[]): NormalizedPlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (!p.placeId) return true;
    if (seen.has(p.placeId)) return false;
    seen.add(p.placeId);
    return true;
  });
}

// ── Stay-specific ranking ──

const CHAIN_KEYWORDS = [
  'marriott', 'hilton', 'hyatt', 'ihg', 'holiday inn', 'best western',
  'radisson', 'wyndham', 'ramada', 'comfort inn', 'comfort suites',
  'hampton inn', 'courtyard', 'fairfield', 'springhill', 'residence inn',
  'homewood', 'doubletree', 'embassy suites', 'crowne plaza',
  'days inn', 'super 8', 'motel 6', 'la quinta', 'travelodge',
  'sheraton', 'westin', 'st. regis', 'w hotel', 'aloft',
  'four points', 'ibis', 'novotel', 'mercure', 'accor',
  'premier inn',
];

function isChainHotel(name: string): boolean {
  const lower = name.toLowerCase();
  return CHAIN_KEYWORDS.some((chain) => lower.includes(chain));
}

/** Rank stay results: filter low quality, deprioritize chains, sort by rating */
export function rankStayResults(places: NormalizedPlace[]): NormalizedPlace[] {
  // 1. Filter: drop places below 4.0 stars or with < 50 reviews
  const quality = places.filter((p) => {
    if (p.rating != null && p.rating < 4.0) return false;
    if (p.reviewCount != null && p.reviewCount < 50) return false;
    return true;
  });
  // Fall back to unfiltered if too aggressive
  const pool = quality.length >= 3 ? quality : places;

  // 2. Separate chains from independents
  const independents = pool.filter((p) => !isChainHotel(p.name));
  const chains = pool.filter((p) => isChainHotel(p.name));

  // 3. Sort each group by rating (desc), then distance (asc)
  const byRatingThenDistance = (a: NormalizedPlace, b: NormalizedPlace) => {
    const rA = a.rating ?? 0;
    const rB = b.rating ?? 0;
    if (rB !== rA) return rB - rA;
    return (a.distance ?? Infinity) - (b.distance ?? Infinity);
  };
  independents.sort(byRatingThenDistance);
  chains.sort(byRatingThenDistance);

  // 4. Independents first, chains at the end
  return [...independents, ...chains];
}

/** Calculate distance between two lat/lng points in metres */
export function calcDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Geocode cache for destination names ──

const geocodeCache = new Map<string, { lat: number; lng: number }>();

/** Resolve a destination name to coordinates using Photon */
async function resolveCoordinates(
  location: ExploreLocation,
): Promise<{ lat: number; lng: number } | null> {
  if (location.type === 'current') {
    return { lat: location.lat, lng: location.lng };
  }

  if (location.lat != null && location.lng != null) {
    return { lat: location.lat, lng: location.lng };
  }

  const query = location.type === 'trip' ? location.destination : location.query;
  const cached = geocodeCache.get(query);
  if (cached) return cached;

  try {
    const results = await photonSearch(query, { limit: 1 });
    if (results.length > 0) {
      const coords = { lat: results[0].lat, lng: results[0].lng };
      geocodeCache.set(query, coords);
      return coords;
    }
  } catch (e) {
    console.error('[Explore] Geocoding failed for:', query, e);
  }

  return null;
}

// ── Edge function caller ──

import { supabase } from './supabase';

const EDGE_FN_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/ai-travonal`;

async function callExploreEdge<T>(action: string, payload: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

  const response = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ action, payload }),
  });

  const json = await response.json().catch(() => null);

  if (!response.ok || !json?.success) {
    const msg = json?.error ?? `Edge function error: ${response.status}`;
    console.error('[Explore] Edge function failed:', msg);
    throw new Error(msg);
  }
  return json.data as T;
}

// ── In-memory results cache ──

const resultsCache = new Map<string, { data: NormalizedPlace[]; ts: number }>();
const RESULTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function resultsCacheKey(lat: number, lng: number, keyword: string): string {
  const rLat = Math.round(lat * 1000) / 1000;
  const rLng = Math.round(lng * 1000) / 1000;
  return `${rLat},${rLng},${keyword}`;
}

/** Fetch places for the explore location and category */
export async function fetchExplorePlaces(
  location: ExploreLocation,
  category: string,
  _options?: { interests?: string[] },
): Promise<NormalizedPlace[]> {
  const coords = await resolveCoordinates(location);
  if (!coords) return [];

  const { lat, lng } = coords;
  const catQuery = CATEGORY_QUERIES[category] ?? CATEGORY_QUERIES.for_you;

  // Check cache
  const cKey = resultsCacheKey(lat, lng, catQuery.keyword);
  const cached = resultsCache.get(cKey);
  if (cached && Date.now() - cached.ts < RESULTS_CACHE_TTL) {
    return cached.data;
  }

  const initialRadius = location.type === 'current' ? 15000 : 20000;
  const keywords = catQuery.multiQuery ?? [catQuery.keyword];

  // Fetch all keywords in parallel, with radius expansion for rural areas
  async function fetchWithExpansion(keyword: string): Promise<Record<string, unknown>[]> {
    for (const radius of [initialRadius, initialRadius * 3, initialRadius * 6]) {
      const result = await callExploreEdge<{ places: Record<string, unknown>[] }>(
        'places_nearby',
        { lat, lng, radius, keyword },
      );
      const raw = result.places ?? [];
      if (raw.length > 0) return raw;
    }
    return [];
  }

  const allResults = await Promise.all(keywords.map(fetchWithExpansion));
  const rawPlaces = allResults.flat();

  let places = rawPlaces.map(normalizeGooglePlace);

  // Calculate distances
  places.forEach((p) => {
    if (p.lat != null && p.lng != null) {
      p.distance = calcDistance(lat, lng, p.lat, p.lng);
    }
  });

  // Sort by distance
  places.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  places = dedupeByPlaceId(places);

  // Filter stays to only actual lodging places, then rank by quality
  if (category === 'stays') {
    places = places.filter((p) =>
      p.category.startsWith('stay/') ||
      p.googleTypes?.some((t) => ['lodging', 'hotel', 'hostel', 'motel', 'resort_hotel', 'extended_stay_hotel', 'bed_and_breakfast', 'guest_house'].includes(t)),
    );
    places = rankStayResults(places);
  }

  resultsCache.set(cKey, { data: places, ts: Date.now() });
  return places;
}

/** Text search within a location using Google Places Text Search */
export async function searchExplorePlaces(
  query: string,
  location: ExploreLocation,
): Promise<NormalizedPlace[]> {
  const coords = await resolveCoordinates(location);
  if (!coords) return [];

  const { lat, lng } = coords;

  let rawPlaces: Record<string, unknown>[] = [];
  for (const radius of [20000, 60000, 120000]) {
    const result = await callExploreEdge<{ places: Record<string, unknown>[] }>(
      'places_nearby',
      { lat, lng, radius, keyword: query },
    );
    rawPlaces = result.places ?? [];
    if (rawPlaces.length > 0) break;
  }

  const places = rawPlaces.map(normalizeGooglePlace);

  places.forEach((p) => {
    if (p.lat != null && p.lng != null) {
      p.distance = calcDistance(lat, lng, p.lat, p.lng);
    }
  });
  places.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  const deduped = dedupeByPlaceId(places);
  // Apply stay ranking for hotel-like searches
  const isHotelSearch = /hotel|stay|accommodation|lodge|hostel/i.test(query);
  return isHotelSearch ? rankStayResults(deduped) : deduped;
}

/** In-memory cache for place details — avoids duplicate fetches when
 *  board-detail pre-fetches and place-detail reads the same placeId. */
const detailsCache = new Map<string, Record<string, unknown>>();

/** Synchronous read from the details cache. Returns data or null. */
export function getCachedPlaceDetails(placeId: string): Record<string, unknown> | null {
  return detailsCache.get(placeId) ?? null;
}

/** Fetch full details for a single place by its Google Place ID.
 *  Returns raw Google Places data including reviews, generativeSummary, etc. */
export async function fetchPlaceDetails(
  placeId: string,
): Promise<Record<string, unknown> | null> {
  const cached = detailsCache.get(placeId);
  if (cached) return cached;
  try {
    const result = await callExploreEdge<Record<string, unknown>>(
      'place_details',
      { placeId },
    );
    detailsCache.set(placeId, result);
    return result;
  } catch (e) {
    console.error('[Explore] Place details fetch failed:', e);
    return null;
  }
}
