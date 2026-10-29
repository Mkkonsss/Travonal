import { Activity } from '@/context/trips';

export interface PlaceReview {
  source: string;
  text: string;
  rating: number;
  date: string;
  theme?: 'food' | 'service' | 'atmosphere' | 'value' | 'view';
}

export interface PlaceOption {
  title: string;
  type: Activity['type'];
  category: string;
  cost: 'free' | 'budget' | 'moderate' | 'premium';
  description: string;
  tags: string[];
  crowdLevel: 'low' | 'medium' | 'high';
  energyLevel: 'low' | 'medium' | 'high';
  bestTime?: string;
  // Rich metadata
  rating?: number;
  reviewCount?: number;
  atmosphere?: string[];
  address?: string;
  neighborhood?: string;
  hours?: string;
  weeklyHours?: Record<string, string>;
  dietaryOptions?: string[];
  phone?: string;
  website?: string;
  accessibility?: string[];
  // Restaurant-specific
  cuisine?: string;
  pricePerPerson?: string;
  popularDishes?: string[];
  menuCategories?: string[];
  reservationsRecommended?: boolean;
  takeout?: boolean;
  delivery?: boolean;
  outdoorSeating?: boolean;
  rooftop?: boolean;
  waterfront?: boolean;
  scenicView?: boolean;
  noiseLevel?: 'quiet' | 'moderate' | 'lively';
  dressCode?: string;
  familyFriendly?: boolean;
  groupFriendly?: boolean;
  petFriendly?: boolean;
  wifi?: boolean;
  parking?: boolean;
  // Reviews
  reviews?: PlaceReview[];
  reviewSummary?: string;
  bestQualities?: string[];
  commonComplaints?: string[];
  // Photos
  photoCount?: number;
  photoCategories?: string[];
  // Coordinates for map
  lat?: number;
  lng?: number;
  // Status
  openNow?: boolean;
  closingTime?: string;
  busyLevel?: 'not busy' | 'moderate' | 'busy' | 'very busy';
  estimatedWait?: string;
  walkingTime?: string;
  // Personalization
  matchScore?: number;
  matchReasons?: string[];
  warnings?: string[];
  // Meta
  lastUpdated?: string;
  verified?: boolean;
}

// Generic activity ideas used by the quick trip edits (surprise me, make adventurous, etc.)
// when no AI is involved. These are deliberately generic — never add named venues, ratings,
// reviews, hours or other details that aren't real (Guidelines 2.1(a) and 1.1.6).
const ALTERNATIVES: Record<string, PlaceOption[]> = {
  _default: [
    { title: 'Walking city tour', type: 'activity', category: 'culture', cost: 'free', description: 'Explore the city on foot', tags: ['Culture', 'History'], crowdLevel: 'medium', energyLevel: 'high' },
    { title: 'Local market visit', type: 'food', category: 'food', cost: 'budget', description: 'Discover local flavors', tags: ['Food & Dining', 'Local Markets'], crowdLevel: 'medium', energyLevel: 'low' },
    { title: 'Museum visit', type: 'activity', category: 'art', cost: 'moderate', description: 'Visit a local museum', tags: ['Art & Museums', 'History'], crowdLevel: 'medium', energyLevel: 'low' },
    { title: 'Park or garden', type: 'activity', category: 'nature', cost: 'free', description: 'Relax in a green space', tags: ['Nature'], crowdLevel: 'low', energyLevel: 'low' },
    { title: 'Local dining experience', type: 'food', category: 'food', cost: 'moderate', description: 'Try a well-reviewed local restaurant', tags: ['Food & Dining'], crowdLevel: 'medium', energyLevel: 'low' },
    { title: 'Neighborhood walk', type: 'activity', category: 'culture', cost: 'free', description: 'Wander a charming neighborhood', tags: ['Culture', 'Photography'], crowdLevel: 'low', energyLevel: 'medium' },
    { title: 'Sunset viewpoint', type: 'activity', category: 'nature', cost: 'free', description: 'Find the best sunset spot', tags: ['Nature', 'Photography'], crowdLevel: 'low', energyLevel: 'low', bestTime: '18:00' },
    { title: 'Street food tour', type: 'food', category: 'food', cost: 'budget', description: 'Sample street food favorites', tags: ['Food & Dining', 'Adventure'], crowdLevel: 'medium', energyLevel: 'medium' },
  ],
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getAlternatives(destination: string): PlaceOption[] {
  return ALTERNATIVES._default;
}

export function findReplacement(
  destination: string,
  currentActivity: Activity,
  options?: {
    interests?: string[];
    dislikes?: string[];
    budget?: string;
    avoidCrowds?: boolean;
    preferAdventurous?: boolean;
    preferRelaxed?: boolean;
  }
): PlaceOption | null {
  const pool = getAlternatives(destination);

  // Filter out activities with the same title
  let candidates = pool.filter((p) => p.title !== currentActivity.title);

  // Prefer same type
  const sameType = candidates.filter((p) => p.type === currentActivity.type);
  if (sameType.length > 0) candidates = sameType;

  // Apply filters
  if (options?.avoidCrowds) {
    const lowCrowd = candidates.filter((p) => p.crowdLevel === 'low');
    if (lowCrowd.length > 0) candidates = lowCrowd;
  }

  if (options?.preferRelaxed) {
    const lowEnergy = candidates.filter((p) => p.energyLevel === 'low');
    if (lowEnergy.length > 0) candidates = lowEnergy;
  }

  if (options?.preferAdventurous) {
    const highEnergy = candidates.filter((p) => p.energyLevel === 'high' || p.energyLevel === 'medium');
    if (highEnergy.length > 0) candidates = highEnergy;
  }

  if (options?.budget) {
    const budgetMap: Record<string, string[]> = {
      budget: ['free', 'budget'],
      moderate: ['free', 'budget', 'moderate'],
      premium: ['free', 'budget', 'moderate', 'premium'],
    };
    const allowed = budgetMap[options.budget] ?? budgetMap.moderate;
    const budgetFiltered = candidates.filter((p) => allowed.includes(p.cost));
    if (budgetFiltered.length > 0) candidates = budgetFiltered;
  }

  // Score by interest match
  if (options?.interests && options.interests.length > 0) {
    candidates.sort((a, b) => {
      const aScore = a.tags.filter((t) => options.interests!.includes(t)).length;
      const bScore = b.tags.filter((t) => options.interests!.includes(t)).length;
      return bScore - aScore;
    });
  }

  // Filter out disliked tags
  if (options?.dislikes && options.dislikes.length > 0) {
    if (options.dislikes.includes('Crowds')) {
      candidates = candidates.filter((p) => p.crowdLevel !== 'high');
    }
  }

  return candidates[0] ?? null;
}

export function findSurprise(
  destination: string,
  existingTitles: string[],
  interests: string[],
  dislikes: string[],
  searchTerms?: string,
): PlaceOption | null {
  const pool = getAlternatives(destination);
  let candidates = pool.filter((p) => !existingTitles.includes(p.title));

  // Filter by search terms if provided (match title, description, tags, or category)
  if (searchTerms) {
    const terms = searchTerms.toLowerCase().split(/\s+/);
    const filtered = candidates.filter((p) => {
      const haystack = `${p.title} ${p.description} ${p.tags.join(' ')} ${p.category}`.toLowerCase();
      return terms.some((t) => haystack.includes(t));
    });
    if (filtered.length > 0) candidates = filtered;
  }

  // Boost by interest match
  candidates.sort((a, b) => {
    const aScore = a.tags.filter((t) => interests.includes(t)).length;
    const bScore = b.tags.filter((t) => interests.includes(t)).length;
    return bScore - aScore;
  });

  if (dislikes.includes('Crowds')) {
    candidates = candidates.filter((p) => p.crowdLevel !== 'high');
  }

  // Pick a random one from top 3 for surprise element
  const top = candidates.slice(0, Math.min(3, candidates.length));
  return top[Math.floor(Math.random() * top.length)] ?? null;
}
