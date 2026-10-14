/**
 * Discovery feed algorithm — produces a personalized, diverse stream of places.
 *
 * Strategy:
 * 1. Fetch places from multiple categories in parallel
 * 2. Filter out seen/dismissed places
 * 3. Score by profile match + implicit preferences
 * 4. Interleave categories (never 10 restaurants in a row)
 * 5. Generate personalized reason strings
 * 6. Support infinite pagination with wider-radius fallback
 */

import { NormalizedPlace, osmCategoryLabel } from './place-model';
import { ExploreLocation, fetchExplorePlaces } from './explore-service';
import {
  loadTrackingData,
  isSeenOrDismissed,
  markSeen,
  getImplicitPreferences,
} from './discovery-tracking';
import { TravelProfile } from '@/context/profile';

// ── Types ──

export interface DiscoveryCard {
  place: NormalizedPlace;
  personalizedReason: string;
  categoryLabel: string;
  cityLabel: string;
}

// ── Category groups for diversity ──

const FEED_CATEGORIES = [
  'for_you',
  'restaurants',
  'cafes',
  'things_to_do',
  'nightlife',
  'shopping',
  'stays',
] as const;

// Group categories for interleaving (never 2+ from same group in a row)
function getCategoryGroup(category: string): string {
  if (category.startsWith('food/')) return 'food';
  if (category.startsWith('stay/')) return 'stay';
  if (category.startsWith('activity/')) return 'activity';
  if (category === 'shopping') return 'shopping';
  return 'other';
}

// ── Personalization scoring ──

const INTEREST_CATEGORIES: Record<string, string[]> = {
  food: ['food/restaurant', 'food/cafe', 'food/bakery', 'food/bar', 'food/other'],
  culture: ['activity/museum', 'activity/attraction'],
  history: ['activity/museum', 'activity/attraction'],
  art: ['activity/museum', 'activity/entertainment'],
  nature: ['activity/park'],
  outdoors: ['activity/park'],
  shopping: ['shopping'],
  nightlife: ['food/bar'],
  photography: ['activity/attraction', 'activity/park'],
  architecture: ['activity/attraction', 'activity/museum'],
  music: ['food/bar', 'activity/entertainment'],
  relaxation: ['activity/park', 'food/cafe'],
  adventure: ['activity/attraction', 'activity/park'],
};

function scorePlace(
  place: NormalizedPlace,
  profile: TravelProfile,
  implicitPrefs: Record<string, number>,
): number {
  let score = 0;

  // Interest match (+10 per matching interest)
  for (const interest of profile.interests) {
    const cats = INTEREST_CATEGORIES[interest.toLowerCase()] ?? [];
    if (cats.includes(place.category)) score += 10;
  }

  // Budget alignment
  if (profile.budget && place.priceLevel != null) {
    if (profile.budget === 'budget' && place.priceLevel <= 2) score += 5;
    if (profile.budget === 'premium' && place.priceLevel >= 3) score += 5;
    if (profile.budget === 'budget' && place.priceLevel >= 4) score -= 5;
  }

  // Food importance boost
  if (profile.foodImportance === 'big' && place.category.startsWith('food/')) {
    score += 5;
  }

  // Implicit preferences from past interactions
  const implicitScore = implicitPrefs[place.category] ?? 0;
  score += Math.min(implicitScore, 15); // Cap implicit boost

  // Distance bonus (closer = slight boost)
  if (place.distance != null) {
    if (place.distance < 500) score += 3;
    else if (place.distance < 2000) score += 1;
  }

  return score;
}

// ── Personalized reason generation ──

function generateReason(place: NormalizedPlace, profile: TravelProfile): string {
  // Check interest match
  for (const interest of profile.interests) {
    const cats = INTEREST_CATEGORIES[interest.toLowerCase()] ?? [];
    if (cats.includes(place.category)) {
      const templates = [
        `Matches your love of ${interest}`,
        `Picked for your ${interest} interest`,
        `Right up your alley — ${interest}`,
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    }
  }

  // Budget match
  if (profile.budget === 'budget' && (place.priceLevel ?? 2) <= 2) {
    return 'Within your budget';
  }
  if (profile.budget === 'premium' && (place.priceLevel ?? 2) >= 3) {
    return 'A premium pick for you';
  }

  // Food importance
  if (profile.foodImportance === 'big' && place.category.startsWith('food/')) {
    return 'For the food lover in you';
  }

  // Pace match
  if (profile.pace === 'relaxed' && (place.category === 'food/cafe' || place.category === 'activity/park')) {
    return 'Fits your relaxed travel pace';
  }

  // Distance
  if (place.distance != null && place.distance < 500) {
    return 'Just a short walk away';
  }

  // Crowd tolerance
  if (profile.crowdTolerance === 'avoid' && place.category === 'activity/park') {
    return 'A quieter spot to enjoy';
  }

  // Rating
  if (place.rating != null && place.rating >= 4.5) {
    return 'Highly rated by visitors';
  }

  // Fallback
  const fallbacks = [
    'Popular nearby',
    'Worth a visit',
    'A local favourite',
    'Recommended for you',
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// ── Category interleaving ──

function interleaveByCategory(places: NormalizedPlace[]): NormalizedPlace[] {
  // Group by category group
  const buckets = new Map<string, NormalizedPlace[]>();
  for (const p of places) {
    const group = getCategoryGroup(p.category);
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group)!.push(p);
  }

  // Round-robin pick from each bucket
  const result: NormalizedPlace[] = [];
  const groups = [...buckets.keys()];
  let groupIdx = 0;

  while (result.length < places.length) {
    let found = false;
    for (let attempt = 0; attempt < groups.length; attempt++) {
      const group = groups[(groupIdx + attempt) % groups.length];
      const bucket = buckets.get(group)!;
      if (bucket.length > 0) {
        result.push(bucket.shift()!);
        groupIdx = (groupIdx + attempt + 1) % groups.length;
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  return result;
}

// ── Feed state ──

let feedBuffer: DiscoveryCard[] = [];
let feedLocation: ExploreLocation | null = null;
let feedProfile: TravelProfile | null = null;
let fetchedCategories = new Set<string>();
let currentRadiusTier = 0;
const RADIUS_TIERS = [10000, 15000, 25000];

/** Initialize/reset the discovery feed for a location. */
export async function initDiscoveryFeed(
  location: ExploreLocation,
  profile: TravelProfile,
): Promise<void> {
  await loadTrackingData();
  feedLocation = location;
  feedProfile = profile;
  feedBuffer = [];
  fetchedCategories = new Set();
  currentRadiusTier = 0;
}

/** Fetch and process the next batch of discovery cards. */
export async function getNextCards(count: number): Promise<DiscoveryCard[]> {
  if (!feedLocation || !feedProfile) return [];

  // If buffer has enough, return from it
  if (feedBuffer.length >= count) {
    const batch = feedBuffer.splice(0, count);
    markSeen(batch.map((c) => c.place.placeId!).filter(Boolean));
    return batch;
  }

  // Need to fetch more places
  await fetchMorePlaces();

  const batch = feedBuffer.splice(0, count);
  markSeen(batch.map((c) => c.place.placeId!).filter(Boolean));
  return batch;
}

async function fetchMorePlaces(): Promise<void> {
  if (!feedLocation || !feedProfile) return;

  const implicitPrefs = getImplicitPreferences();
  const cityLabel = feedLocation.label;

  // Determine which categories to fetch
  const categoriesToFetch = FEED_CATEGORIES.filter((c) => !fetchedCategories.has(c));

  if (categoriesToFetch.length === 0) {
    // All categories fetched at current radius — try wider
    currentRadiusTier++;
    if (currentRadiusTier >= RADIUS_TIERS.length) return; // Exhausted
    fetchedCategories.clear();
    return fetchMorePlaces();
  }

  // Fetch up to 3 categories at a time (sequential to avoid rate limits)
  const batch = categoriesToFetch.slice(0, 3);

  const allPlaces: NormalizedPlace[] = [];

  for (const category of batch) {
    fetchedCategories.add(category);
    try {
      const places = await fetchExplorePlaces(
        feedLocation,
        category,
        { interests: feedProfile.interests },
      );
      allPlaces.push(...places);
    } catch (e) {
      if (__DEV__) console.warn('[DiscoveryFeed] Failed to fetch', category, e);
    }
  }

  // Filter out seen/dismissed places
  const fresh = allPlaces.filter(
    (p) => p.placeId && !isSeenOrDismissed(p.placeId),
  );

  // Score and sort
  const scored = fresh.map((p) => ({
    place: p,
    score: scorePlace(p, feedProfile!, implicitPrefs),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Interleave by category for diversity
  const interleaved = interleaveByCategory(scored.map((s) => s.place));

  // Build cards — photos are resolved lazily by the UI component (not here)
  // to avoid burning Google API budget on places the user never scrolls to.
  const cards: DiscoveryCard[] = interleaved.map((place) => {
    const osmTags = (place as any)._osmTags as Record<string, string> | undefined;
    return {
      place,
      personalizedReason: generateReason(place, feedProfile!),
      categoryLabel: osmCategoryLabel(osmTags ?? {}) || formatCategory(place.category),
      cityLabel,
    };
  });

  feedBuffer.push(...cards);
}

/** Reset the feed (e.g., on location change). */
export function resetDiscoveryFeed(): void {
  feedBuffer = [];
  fetchedCategories.clear();
  currentRadiusTier = 0;
}

/** Simple category formatter for display. */
function formatCategory(category: string): string {
  const LABELS: Record<string, string> = {
    'food/restaurant': 'Restaurant',
    'food/cafe': 'Café',
    'food/bar': 'Bar',
    'food/bakery': 'Bakery',
    'food/other': 'Food',
    'stay/hotel': 'Hotel',
    'stay/hostel': 'Hostel',
    'stay/other': 'Accommodation',
    'activity/museum': 'Museum',
    'activity/park': 'Park',
    'activity/attraction': 'Attraction',
    'activity/entertainment': 'Entertainment',
    'shopping': 'Shopping',
  };
  return LABELS[category] ?? 'Place';
}
