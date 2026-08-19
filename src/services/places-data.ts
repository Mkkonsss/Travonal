import { PlaceOption, getAlternatives, getAllPoolDestinations } from './alternatives-pool';

export interface PlaceWithDestination extends PlaceOption {
  destination: string;
}

export interface BrowseCategory {
  id: string;
  label: string;
  icon: string;
}

export const BROWSE_CATEGORIES: BrowseCategory[] = [
  { id: 'all', label: 'All', icon: '\u{1F30D}' },
  { id: 'food', label: 'Food & Dining', icon: '\u{1F37D}\uFE0F' },
  { id: 'hotel', label: 'Stays', icon: '\u{1F3E8}' },
  { id: 'culture', label: 'Culture', icon: '\u{1F3DB}\uFE0F' },
  { id: 'nature', label: 'Nature', icon: '\u{1F33F}' },
  { id: 'art', label: 'Art', icon: '\u{1F3A8}' },
  { id: 'adventure', label: 'Adventure', icon: '\u{26F0}\uFE0F' },
  { id: 'shopping', label: 'Shopping', icon: '\u{1F6CD}\uFE0F' },
  { id: 'nightlife', label: 'Nightlife', icon: '\u{1F378}' },
];

export function searchPlaces(
  destination: string,
  query: string,
  category: string,
): PlaceOption[] {
  let places = getAlternatives(destination);

  if (category && category !== 'all') {
    places = places.filter((p) =>
      p.category === category || p.tags.some((t) => t.toLowerCase().includes(category))
    );
  }

  if (query.trim()) {
    const q = query.toLowerCase();
    places = places.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  return places;
}

/** Search across ALL destinations, returning places tagged with their destination. */
export function searchAllPlaces(
  query: string,
  category: string,
): PlaceWithDestination[] {
  const destinations = getAllPoolDestinations();
  const results: PlaceWithDestination[] = [];

  for (const dest of destinations) {
    const places = getAlternatives(dest);
    for (const place of places) {
      results.push({ ...place, destination: dest });
    }
  }

  let filtered = results;

  if (category && category !== 'all') {
    filtered = filtered.filter((p) =>
      p.category === category || p.tags.some((t) => t.toLowerCase().includes(category))
    );
  }

  if (query.trim()) {
    const q = query.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.destination.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  return filtered;
}

/** Score and sort places based on user profile preferences. */
export function personalizeResults(
  places: PlaceWithDestination[],
  profile: {
    interests: string[];
    dislikes: string[];
    budget: string;
    pace: string;
  },
): PlaceWithDestination[] {
  const scored = places.map((place) => {
    let score = 0;

    // Interest match: +3 per matching tag
    for (const interest of profile.interests) {
      if (place.tags.some((t) => t.toLowerCase().includes(interest.toLowerCase()))) {
        score += 3;
      }
      if (place.category.toLowerCase().includes(interest.toLowerCase())) {
        score += 2;
      }
    }

    // Dislike penalty: -5 for crowd-averse users seeing crowded places
    if (profile.dislikes.includes('Crowds') && place.crowdLevel === 'high') {
      score -= 5;
    }
    if (profile.dislikes.includes('Long walks') && place.energyLevel === 'high') {
      score -= 3;
    }
    if (profile.dislikes.includes('Early mornings') && place.bestTime && place.bestTime < '09:00') {
      score -= 3;
    }
    if (profile.dislikes.includes('Late nights') && place.bestTime && place.bestTime >= '21:00') {
      score -= 3;
    }

    // Budget alignment: +2 if within budget
    const budgetOrder = ['free', 'budget', 'moderate', 'premium'];
    const userBudgetIdx = budgetOrder.indexOf(profile.budget);
    const placeCostIdx = budgetOrder.indexOf(place.cost);
    if (placeCostIdx <= userBudgetIdx) {
      score += 2;
    } else {
      score -= 2;
    }

    // Pace alignment
    if (profile.pace === 'relaxed' && place.energyLevel === 'low') score += 2;
    if (profile.pace === 'active' && place.energyLevel === 'high') score += 2;

    return { place, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.place);
}

export function getAllDestinations(): string[] {
  return getAllPoolDestinations();
}
