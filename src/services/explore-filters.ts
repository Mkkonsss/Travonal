/**
 * Exported pure functions for Explore search parsing, dietary filtering,
 * and feedback-based scoring/filtering. Used directly by the Explore screen
 * and imported by tests.
 */

import { TravelMemoryEntry } from '@/context/memory';

// ---------- Dietary search parsing ----------

const DIETARY_TERMS = ['vegan', 'vegetarian', 'gluten-free', 'gluten free', 'halal', 'kosher', 'dairy-free', 'dairy free'] as const;
const NOISE_WORDS = ['restaurant', 'restaurants', 'food', 'foods', 'options', 'option', 'places', 'place', 'near', 'me', 'best', 'good', 'great', 'the', 'a', 'an', 'in', 'for', 'and', 'or', 'with'];

/**
 * Normalize a dietary term for comparison.
 * Lowercases, collapses whitespace, and replaces hyphens with spaces
 * so "gluten-free", "gluten free", and "Gluten Free" all become "gluten free".
 */
export function normalizeDietaryTerm(term: string): string {
  return term.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface ParsedSearch {
  /** Cleaned text query with dietary/noise words removed */
  textQuery: string;
  /** NLP-derived filters */
  filters: Record<string, string>;
  /** Specific dietary terms found in the original query */
  dietaryTerms: string[];
}

/**
 * Parse a natural-language search query.
 * Extracts dietary intent and other filter hints, and strips dietary/generic
 * noise words from the text so the remaining query can be used for text search.
 */
export function parseSearchQuery(query: string): ParsedSearch {
  const lower = query.toLowerCase();
  const filters: Record<string, string> = {};

  if (/cheap|budget|affordable|free/.test(lower)) filters.budget = 'budget';
  if (/quiet|peaceful|calm/.test(lower)) filters.crowd = 'low';
  if (/near me|nearby|close/.test(lower)) filters.nearby = 'true';
  if (/outdoor|outside|terrace|patio/.test(lower)) filters.outdoor = 'true';
  if (/romantic|date night/.test(lower)) filters.atmosphere = 'Romantic';
  if (/family|kid/.test(lower)) filters.family = 'true';

  // Detect dietary intent — normalize the query so "gluten free" matches "gluten-free" etc.
  const normalizedQuery = normalizeDietaryTerm(query);
  const matchedDietary = DIETARY_TERMS.filter((t) => normalizedQuery.includes(normalizeDietaryTerm(t)));
  // Deduplicate: "gluten-free" and "gluten free" both normalize to "gluten free"
  const uniqueNormalized = [...new Set(matchedDietary.map(normalizeDietaryTerm))];
  if (uniqueNormalized.length > 0) {
    filters.dietary = 'true';
  }

  // Build cleaned text query: remove dietary terms and noise words
  let cleaned = lower;
  // Remove multi-word dietary terms first (before splitting)
  for (const term of matchedDietary) {
    cleaned = cleaned.replace(new RegExp(term.replace(/-/g, '[\\s-]'), 'gi'), ' ');
  }
  // Remove noise words
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0 && !NOISE_WORDS.includes(w));
  const textQuery = words.join(' ').trim();

  return { textQuery, filters, dietaryTerms: uniqueNormalized };
}

/**
 * Apply dietary filtering to a list of places.
 * Only keeps places whose dietaryOptions contain at least one of the matched terms.
 * Uses normalization so "gluten free" matches "Gluten-free options" etc.
 */
export function applyDietaryFilter<T extends { dietaryOptions?: string[] }>(
  places: T[],
  dietaryTerms: string[],
): T[] {
  if (dietaryTerms.length === 0) return places;
  const normalizedTerms = dietaryTerms.map(normalizeDietaryTerm);
  return places.filter((p) =>
    p.dietaryOptions?.some((d) => {
      const normalizedOption = normalizeDietaryTerm(d);
      return normalizedTerms.some((t) => normalizedOption.includes(t));
    })
  );
}

// ---------- Feedback filtering/scoring ----------

export interface FeedbackSummary {
  notInterestedTitles: Set<string>;
  likedCategories: string[];
  likedTags: string[];
  lessLikedCategories: string[];
  lessLikedTags: string[];
  tooExpensiveCount: number;
  visitedTitles: Set<string>;
}

/**
 * Summarise memory entries into a feedback summary for filtering/scoring.
 */
export function summarizeFeedback(entries: TravelMemoryEntry[]): FeedbackSummary {
  const notInterestedTitles = new Set<string>();
  const likedCategories: string[] = [];
  const likedTags: string[] = [];
  const lessLikedCategories: string[] = [];
  const lessLikedTags: string[] = [];
  let tooExpensiveCount = 0;
  const visitedTitles = new Set<string>();

  for (const e of entries) {
    if (!e.enabled) continue;

    if (e.detail.startsWith('Not interested in:')) {
      const match = e.detail.match(/Not interested in: (.+?) \(/);
      if (match) notInterestedTitles.add(match[1]);
    } else if (e.detail.startsWith('Likes:')) {
      likedCategories.push(e.category);
      // Extract tags if present
      const tagMatch = e.detail.match(/tags:(.+)/);
      if (tagMatch) likedTags.push(...tagMatch[1].split(',').map((t) => t.trim()));
    } else if (e.detail.startsWith('Less like:')) {
      lessLikedCategories.push(e.category);
      const tagMatch = e.detail.match(/tags:(.+)/);
      if (tagMatch) lessLikedTags.push(...tagMatch[1].split(',').map((t) => t.trim()));
    } else if (e.detail.startsWith('Too expensive:')) {
      tooExpensiveCount++;
    } else if (e.detail.startsWith('Has visited:')) {
      const match = e.detail.match(/Has visited: (.+?) \(/);
      if (match) visitedTitles.add(match[1]);
    }
  }

  return { notInterestedTitles, likedCategories, likedTags, lessLikedCategories, lessLikedTags, tooExpensiveCount, visitedTitles };
}

/**
 * Apply feedback-based filtering and scoring to explore results.
 * This is the single source of truth used by the Explore screen.
 */
export function applyFeedbackToResults<T extends { title: string; category: string; cost: string; tags: string[] }>(
  results: T[],
  feedback: FeedbackSummary,
): T[] {
  let filtered = results;

  // 1. Remove not-interested places
  if (feedback.notInterestedTitles.size > 0) {
    filtered = filtered.filter((p) => !feedback.notInterestedTitles.has(p.title));
  }

  // 2. Remove visited places from discovery
  if (feedback.visitedTitles.size > 0) {
    filtered = filtered.filter((p) => !feedback.visitedTitles.has(p.title));
  }

  // 3. Score and sort
  const scored = filtered.map((p) => {
    let score = 0;

    // Boost liked categories
    if (feedback.likedCategories.includes(p.category)) score += 3;

    // Boost liked tags
    for (const tag of p.tags) {
      if (feedback.likedTags.includes(tag)) score += 2;
    }

    // Reduce less-liked categories (reduce score but don't filter out)
    if (feedback.lessLikedCategories.includes(p.category)) score -= 2;
    for (const tag of p.tags) {
      if (feedback.lessLikedTags.includes(tag)) score -= 1;
    }

    // Deprioritize premium after ANY too-expensive feedback (immediate, not 2+)
    if (feedback.tooExpensiveCount >= 1 && p.cost === 'premium') score -= 4;
    if (feedback.tooExpensiveCount >= 1 && p.cost === 'moderate') score -= 1;

    return { item: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

/**
 * Check if a feedback entry for a specific place and type already exists.
 */
export function hasDuplicateFeedback(
  entries: TravelMemoryEntry[],
  title: string,
  feedbackType: string,
): boolean {
  const prefix = feedbackType === 'more' ? 'Likes:'
    : feedbackType === 'less' ? 'Less like:'
    : feedbackType === 'not_interested' ? 'Not interested in:'
    : feedbackType === 'too_expensive' ? 'Too expensive:'
    : feedbackType === 'been_here' ? 'Has visited:'
    : '';
  if (!prefix) return false;
  return entries.some((e) => e.detail.startsWith(prefix) && e.detail.includes(title));
}

/**
 * Identify which memory entries are explore-feedback (as opposed to other travel memories).
 */
export function isExploreFeedbackEntry(entry: TravelMemoryEntry): boolean {
  return (
    entry.detail.startsWith('Likes:') ||
    entry.detail.startsWith('Less like:') ||
    entry.detail.startsWith('Not interested in:') ||
    entry.detail.startsWith('Too expensive:') ||
    entry.detail.startsWith('Has visited:')
  );
}
